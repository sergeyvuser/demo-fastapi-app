import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession, startSession } from './api/session'
import { createAppRouter, safeRedirect } from './router'
import { renderWithProviders } from './testing/render'

// A boot the test settles by hand: the router is given it through context,
// which is what lets "the Landing does not wait" be observed at all.
function controlledBoot() {
  let settle: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { boot: () => promise, settle }
}

function renderAt(path: string, boot: () => Promise<void>) {
  const router = createAppRouter(
    { session: { boot, current: getSession } },
    createMemoryHistory({ initialEntries: [path] }),
  )
  return { router, ...renderWithProviders(<RouterProvider router={router} />) }
}

afterEach(() => {
  // the real session module is shared by every test in this file
  endSession()
  vi.unstubAllGlobals()
})

describe('the router', () => {
  it('renders the Landing while the boot refresh is still in the air', async () => {
    const { i18n } = renderAt('/', () => new Promise(() => {}))

    expect(
      await screen.findByRole('heading', { name: i18n.t('common.productName') }),
    ).toBeInTheDocument()
  })

  it('shows the content skeleton on a signed-in route until the boot settles', async () => {
    const { boot } = controlledBoot()
    const { i18n } = renderAt('/alerts', boot)

    expect(await screen.findByTestId('content-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: i18n.t('shell.alerts') })).toBeNull()
  })

  it('opens the signed-in route once the boot finds a session', async () => {
    // /me is asked for by the user menu; its answer is not this test's subject
    vi.stubGlobal('fetch', () => new Promise(() => {}))
    const { boot, settle } = controlledBoot()
    const { i18n } = renderAt('/alerts', boot)

    startSession('access', 900)
    act(() => settle())

    expect(await screen.findByRole('heading', { name: i18n.t('shell.alerts') })).toBeInTheDocument()
  })

  it('sends a person with no session to sign in, remembering where they were going', async () => {
    const { boot, settle } = controlledBoot()
    const { router, i18n } = renderAt('/history?x=1', boot)

    endSession()
    act(() => settle())

    expect(
      await screen.findByRole('heading', { name: i18n.t('auth.signIn.title') }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: '/history?x=1' })
    // a first visit is not an expired session, so nothing is explained
    expect(screen.queryByText(i18n.t('auth.signIn.expired'))).toBeNull()
  })

  it('states the reason when the session was lost rather than never there', async () => {
    const { boot, settle } = controlledBoot()
    const { router, i18n } = renderAt('/alerts', boot)

    endSession(true)
    act(() => settle())

    expect(await screen.findByText(i18n.t('auth.signIn.expired'))).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ redirect: '/alerts', expired: true })
  })

  it('renders its own NotFound for an unknown address', async () => {
    const { i18n } = renderAt('/no-such-page', () => new Promise(() => {}))

    expect(await screen.findByText(i18n.t('notFound.title'))).toBeInTheDocument()
  })
})

describe('safeRedirect', () => {
  it.each(['/alerts', '/alerts/42?from=1', '/history#top'])('keeps a path: %s', (path) => {
    expect(safeRedirect(path)).toBe(path)
  })

  it.each([
    ['another host, scheme-relative', '//evil.example/alerts'],
    ['another host, backslash', '/\\evil.example'],
    ['an absolute URL', 'https://evil.example'],
    ['a script', 'javascript:alert(1)'],
    ['not a string', 42],
  ])('drops %s', (_case, value) => {
    expect(safeRedirect(value)).toBeUndefined()
  })
})
