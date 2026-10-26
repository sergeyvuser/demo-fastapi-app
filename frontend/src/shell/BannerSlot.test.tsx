import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession, startSession } from '../api/session'
import { createAppRouter } from '../router'
import { renderWithProviders } from '../testing/render'

const ME = '/api/v1/users/me'
const RESEND = '/api/v1/auth/resend-verification'
const DEMO = '/api/v1/demo'

const HOUR = 3_600_000

let answers: Record<string, () => Response>
let me: { is_verified: boolean; is_demo: boolean }

function publishedDemo(resetsIn: number) {
  return () =>
    Response.json({
      enabled: true,
      email: 'demo@example.com',
      password: 'demo-password',
      resets_at: new Date(Date.now() + resetsIn).toISOString(),
    })
}

beforeEach(() => {
  me = { is_verified: false, is_demo: false }
  answers = {
    [ME]: () =>
      Response.json({
        id: '00000000-0000-0000-0000-000000000001',
        username: 'newcomer',
        email: 'newcomer@example.com',
        is_active: true,
        ...me,
      }),
  }
  vi.stubGlobal('fetch', (input: Request) => {
    const answer = answers[new URL(input.url).pathname]
    return answer ? Promise.resolve(answer()) : new Promise(() => {})
  })
  startSession('access', 900)
})

afterEach(() => {
  vi.unstubAllGlobals()
  endSession()
})

function renderAt(path: string) {
  const router = createAppRouter(
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: [path] }),
  )
  return renderWithProviders(<RouterProvider router={router} />)
}

describe('the banner slot', () => {
  // Not a lock-out: every signed-in screen opens, the banner rides above it.
  it.each([
    ['/alerts', 'shell.alerts'],
    ['/history', 'shell.history'],
    ['/account', 'shell.account'],
  ] as const)('shows an unverified User %s under the banner', async (path, title) => {
    const { i18n } = renderAt(path)

    expect(await screen.findByText(i18n.t('verification.banner.title'))).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('verification.banner.body', { email: 'newcomer@example.com' })),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: i18n.t(title) })).toBeInTheDocument()
  })

  it('stays empty for a verified User', async () => {
    me = { is_verified: true, is_demo: false }
    const { i18n } = renderAt('/alerts')

    await screen.findByRole('heading', { name: i18n.t('shell.alerts') })
    // the menu reads the same /me; once its e-mail is there, so is the answer
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shell.userMenu') }))
    await screen.findByText('newcomer@example.com')
    expect(screen.queryByText(i18n.t('verification.banner.title'))).toBeNull()
  })

  it('resends from the banner', async () => {
    answers[RESEND] = () => Response.json({ status: 'verification_resent' })
    const { i18n } = renderAt('/alerts')

    fireEvent.click(
      await screen.findByRole('button', { name: i18n.t('verification.resend.action') }),
    )

    expect(await screen.findByText(i18n.t('verification.resend.sent'))).toBeInTheDocument()
  })

  it('states the rate limit as a sentence with the wait in it', async () => {
    answers[RESEND] = () =>
      Response.json(
        { type: 'about:blank', status: 429, detail: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '181' } },
      )
    const { i18n } = renderAt('/alerts')

    fireEvent.click(
      await screen.findByRole('button', { name: i18n.t('verification.resend.action') }),
    )

    // 181 s rounds up: "in 3 minutes" would send the person back too early
    const sentence = await screen.findByText(i18n.t('verification.resend.limited', { count: 4 }))
    // announced politely, and not the red failure line
    expect(sentence).toHaveAttribute('role', 'status')
    expect(screen.queryByText(i18n.t('verification.resend.failed'))).toBeNull()
  })

  it('takes the banner down when the address turns out to be confirmed already', async () => {
    answers[RESEND] = () => {
      me = { is_verified: true, is_demo: false }
      return Response.json({ type: 'about:blank', status: 409, detail: 'x' }, { status: 409 })
    }
    const { i18n } = renderAt('/alerts')

    fireEvent.click(
      await screen.findByRole('button', { name: i18n.t('verification.resend.action') }),
    )

    await vi.waitFor(() =>
      expect(screen.queryByText(i18n.t('verification.banner.title'))).toBeNull(),
    )
  })
})

// The banner's sentence is asserted as literal English, not through the
// catalogue: what the shared account says about itself is the decision.
describe('the banner slot on the Demo account', () => {
  beforeEach(() => {
    me = { is_verified: true, is_demo: true }
  })

  it('says the account is shared and when it resets', async () => {
    // a minute short of five hours still reads as five
    answers[DEMO] = publishedDemo(5 * HOUR - 60_000)
    renderAt('/alerts')

    expect(
      await screen.findByText(
        'This is the shared demo account: every Alert on it belongs to everyone who signs in, ' +
          'and it resets in 5 hours.',
      ),
    ).toBeInTheDocument()
  })

  it('leaves the time out while the reset is unknown', async () => {
    // no answer from /demo: the account is still shared, and says so
    renderAt('/alerts')

    expect(
      await screen.findByText(
        'This is the shared demo account: every Alert on it belongs to everyone who signs in.',
      ),
    ).toBeInTheDocument()
  })

  it('keeps the rest behind a disclosure', async () => {
    answers[DEMO] = publishedDemo(2 * HOUR)
    const { i18n } = renderAt('/alerts')

    const toggle = await screen.findByRole('button', { name: i18n.t('demo.banner.more') })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(i18n.t('demo.banner.own'))).toBeNull()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await vi.waitFor(() => expect(screen.getByText(i18n.t('demo.banner.own'))).toBeVisible())
    expect(screen.getByText(i18n.t('demo.banner.others'))).toBeVisible()
  })

  // Impossible today — the Demo account is permanently verified — and the
  // slot must not depend on that staying true: one banner, never two.
  it('never shows the verification banner beside it', async () => {
    me = { is_verified: false, is_demo: true }
    answers[DEMO] = publishedDemo(HOUR)
    const { i18n } = renderAt('/alerts')

    await screen.findByText(/This is the shared demo account/)
    expect(screen.queryByText(i18n.t('verification.banner.title'))).toBeNull()
    expect(screen.queryByRole('button', { name: i18n.t('verification.resend.action') })).toBeNull()
  })
})
