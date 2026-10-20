import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession, startSession } from '../api/session'
import { createAppRouter } from '../router'
import { renderWithProviders } from '../testing/render'

const TOKEN = 'k'.repeat(43)
const VERIFY = '/api/v1/auth/verify'
const RESEND = '/api/v1/auth/resend-verification'

// What the API answers, per path; anything unlisted hangs, so a request this
// file did not expect shows up as a missing screen rather than a wrong one.
let answers: Record<string, () => Response>
let requests: Request[]

beforeEach(() => {
  requests = []
  answers = {}
  vi.stubGlobal('fetch', (input: Request) => {
    requests.push(input.clone())
    const answer = answers[new URL(input.url).pathname]
    return answer ? Promise.resolve(answer()) : new Promise(() => {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  endSession()
})

const problem = (status: number, headers: Record<string, string> = {}) =>
  Response.json({ type: 'about:blank', status, detail: 'refused' }, { status, headers })

function renderVerify(path = `/verify?token=${TOKEN}`) {
  const router = createAppRouter(
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: [path] }),
  )
  // StrictMode, as in main.tsx: it mounts twice in development, which is
  // exactly what would spend the token twice if the call were not deduplicated
  return {
    router,
    ...renderWithProviders(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    ),
  }
}

const sent = (path: string) => requests.filter((request) => new URL(request.url).pathname === path)

// The three titles are asserted as literal English, not through the
// catalogue: their wording is the decision this screen exists to make.
describe('the Verification landing', () => {
  it('confirms the address, sending the token in the body and once only', async () => {
    answers[VERIFY] = () => Response.json({ status: 'verified' })
    renderVerify()

    expect(await screen.findByText('Your address is confirmed')).toBeInTheDocument()
    expect(sent(VERIFY)).toHaveLength(1)
    expect(new URL(sent(VERIFY)[0].url).search).toBe('')
    expect(await sent(VERIFY)[0].json()).toEqual({ verification_token: TOKEN })
  })

  it('takes the token out of the address bar once it is read', async () => {
    answers[VERIFY] = () => Response.json({ status: 'verified' })
    const { router } = renderVerify()

    await screen.findByText('Your address is confirmed')
    expect(router.state.location.href).toBe('/verify')
    // replaced, not pushed: no entry behind this one still carries it
    expect(router.history.length).toBe(1)
  })

  it('offers sign-in to a visitor with no session, and returns them to the Alerts', async () => {
    answers[VERIFY] = () => Response.json({ status: 'verified' })
    const { i18n } = renderVerify()

    await screen.findByText('Your address is confirmed')
    // the header has a "Sign in" of its own; this one is the screen's
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: i18n.t('verification.signIn') }),
    ).toHaveAttribute('href', '/login?redirect=%2Falerts')
  })

  it('offers the Alerts to a person already signed in', async () => {
    startSession('access', 900)
    answers[VERIFY] = () => Response.json({ status: 'verified' })
    const { i18n } = renderVerify()

    expect(
      await screen.findByRole('link', { name: i18n.t('verification.toAlerts') }),
    ).toHaveAttribute('href', '/alerts')
  })

  it('says a spent link is spent, and does not offer another letter', async () => {
    startSession('access', 900)
    answers[VERIFY] = () => problem(409)
    const { i18n } = renderVerify()

    expect(await screen.findByText('This link has already been used')).toBeInTheDocument()
    expect(
      screen.getByText('Your address is already confirmed, so there is nothing more to do here.'),
    ).toBeInTheDocument()
    // even with a session, where sending one would be possible
    expect(screen.queryByRole('button', { name: i18n.t('verification.resend.action') })).toBeNull()
  })

  it('sends a visitor with an expired link to sign in, where the banner can resend', async () => {
    answers[VERIFY] = () => problem(410)
    const { i18n } = renderVerify()

    expect(await screen.findByText('This link has expired')).toBeInTheDocument()
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: i18n.t('verification.signIn') }),
    ).toHaveAttribute('href', '/login?redirect=%2Falerts')
    expect(screen.queryByRole('button', { name: i18n.t('verification.resend.action') })).toBeNull()
  })

  it('treats a link with no token as expired, without asking the API', async () => {
    renderVerify('/verify')

    expect(await screen.findByText('This link has expired')).toBeInTheDocument()
    expect(sent(VERIFY)).toHaveLength(0)
  })

  it('resends from the landing for a person who is signed in', async () => {
    startSession('access', 900)
    answers[VERIFY] = () => problem(410)
    answers[RESEND] = () => Response.json({ status: 'verification_resent' })
    const { i18n } = renderVerify()

    fireEvent.click(
      await screen.findByRole('button', { name: i18n.t('verification.resend.action') }),
    )

    expect(await screen.findByText(i18n.t('verification.resend.sent'))).toBeInTheDocument()
    expect(sent(RESEND)).toHaveLength(1)
  })

  it('does not offer another letter on an old link to an address confirmed since', async () => {
    startSession('access', 900)
    answers[VERIFY] = () => problem(410)
    answers['/api/v1/users/me'] = () =>
      Response.json({
        id: '00000000-0000-0000-0000-000000000001',
        username: 'settled',
        email: 'settled@example.com',
        is_active: true,
        is_verified: true,
      })
    const { i18n } = renderVerify()

    // one message, not "expired" beside "confirmed"
    expect(await screen.findByText('Your address is already confirmed')).toBeInTheDocument()
    expect(screen.queryByText('This link has expired')).toBeNull()
    expect(screen.queryByRole('button', { name: i18n.t('verification.resend.action') })).toBeNull()
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: i18n.t('verification.toAlerts') }),
    ).toHaveAttribute('href', '/alerts')
  })

  it('says a failed request is a failed request, not an answer about the link', async () => {
    answers[VERIFY] = () => problem(503)
    const { i18n } = renderVerify()

    expect(await screen.findByText(i18n.t('verification.failed'))).toBeInTheDocument()

    answers[VERIFY] = () => Response.json({ status: 'verified' })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('verification.retry') }))

    // the token was held, so trying again works after the URL lost it
    expect(await screen.findByText('Your address is confirmed')).toBeInTheDocument()
    expect(await sent(VERIFY)[1].json()).toEqual({ verification_token: TOKEN })
  })
})
