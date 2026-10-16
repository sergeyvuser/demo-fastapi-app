import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession, startSession } from '../api/session'
import { createAppRouter } from '../router'
import { renderWithProviders } from '../testing/render'

const ME = '/api/v1/users/me'
const RESEND = '/api/v1/auth/resend-verification'

let answers: Record<string, () => Response>
let me: { is_verified: boolean }

beforeEach(() => {
  me = { is_verified: false }
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
    me = { is_verified: true }
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
      me = { is_verified: true }
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
