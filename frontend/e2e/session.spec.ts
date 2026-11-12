import { request, type Page } from '@playwright/test'

import { expect, test } from './fixtures.ts'
import { expectRefreshCookie, REFRESH_COOKIE } from './support/accounts.ts'
import { EDGE_URL } from './support/stack.ts'

// Journey 3: the authentication model, against the real server. The refresh
// cookie carries the session across a reload, and a sign-out ends it — here
// and on the server, with the User's other sockets closed while it answers.
//
// Why two tabs: the tab that signs out closes its own socket first (signOut()
// in src/api/auth.ts), so the server's 1008 can only be heard by another tab
// of the same User. That close is issued by the logout request's task onto a
// socket another task serves — under Granian such a close once hung forever
// (impl 07) while every in-process test was green. This is the only test
// that runs a logout against the real server.

const LOGOUT_ANSWERS_WITHIN_MS = 2_000

// The socket of `page`, passed through to the real server, with the two
// facts this journey needs: that the server has registered it, and the code
// it was closed with.
async function watchSocket(page: Page) {
  let registered!: () => void
  let closed!: (code: number | undefined) => void
  const result = {
    registered: new Promise<void>((resolve) => (registered = resolve)),
    closed: new Promise<number | undefined>((resolve) => (closed = resolve)),
  }
  await page.routeWebSocket(/\/api\/v1\/ws$/, (socket) => {
    const server = socket.connectToServer()
    server.onMessage((message) => {
      // The server says nothing after auth; its first `watching` is the
      // first proof the connection is registered with the manager — which is
      // what a logout closes.
      if (typeof message === 'string' && JSON.parse(message).type === 'watching') registered()
      socket.send(message)
    })
    server.onClose((code, reason) => {
      closed(code)
      socket.close({ code, reason })
    })
  })
  return result
}

test('the cookie keeps the session across a reload, and a sign-out ends it everywhere', async ({
  context,
  page,
  account: _account,
}) => {
  await page.goto('/alerts')
  const userMenu = page.getByRole('button', { name: 'Account menu' })
  await expect(userMenu).toBeVisible()
  // The boot refresh has rotated the cookie; the new one is set the same way.
  await expectRefreshCookie(context)

  await page.reload()
  await expect(page).toHaveURL(/\/alerts$/)
  await expect(userMenu).toBeVisible()

  // The second tab, with a live socket the sign-out must close. The Landing
  // watches every Symbol, so the server answers with `watching`.
  const other = await context.newPage()
  const otherSocket = await watchSocket(other)
  await other.goto('/')
  await otherSocket.registered

  const revoked = (await context.cookies()).find((c) => c.name === REFRESH_COOKIE.name)!.value

  const logout = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/logout'))
  const startedAt = Date.now()
  await userMenu.click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  const answer = await logout
  expect(answer.status()).toBe(204)
  expect(Date.now() - startedAt).toBeLessThan(LOGOUT_ANSWERS_WITHIN_MS)

  // Policy violation: the session this socket was opened for is over.
  expect(await otherSocket.closed).toBe(1008)

  // Gone from the browser…
  expect((await context.cookies()).map((c) => c.name)).not.toContain(REFRESH_COOKIE.name)
  await page.goto('/alerts')
  await expect(page).toHaveURL(/\/login/)

  // …and on the server: the cookie the browser held is refused, so a copy
  // of it taken before the sign-out is worth nothing.
  const outsider = await request.newContext({ baseURL: EDGE_URL })
  try {
    const refresh = await outsider.post('/api/v1/auth/refresh', {
      headers: { cookie: `${REFRESH_COOKIE.name}=${revoked}` },
    })
    expect(refresh.status()).toBe(401)
  } finally {
    await outsider.dispose()
  }
})
