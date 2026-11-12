import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type BrowserContext } from '@playwright/test'

import { verificationLink } from './mailpit.ts'
import { EDGE_URL } from './stack.ts'

// Accounts are fresh per spec, created through the API — register, verify,
// sign in — so a spec can be rerun alone or picked with --grep, and no two
// specs share an Alert list. Nothing deletes them: the stack's database is
// disposable, and no user-deletion endpoint exists to serve the tests.

export type Account = { username: string; email: string; password: string }

// example.com, not .test: email-validator refuses the special-use TLDs
// outright, so a .test address is a 422 at registration. example.com is
// RFC 2606-reserved too and publishes a null MX.
export function newAccount(): Account {
  const id = randomUUID().slice(0, 8)
  return {
    // 3 to 32 of [A-Za-z0-9_-] — the API's own rule
    username: `e2e_${id}`,
    email: `e2e-${id}@example.com`,
    password: `e2e-password-${id}`,
  }
}

export async function register(api: APIRequestContext, account: Account): Promise<void> {
  const response = await api.post('/api/v1/auth/register', { data: account })
  expect(response.status(), await response.text()).toBe(201)
}

// The token from the letter the worker sent, posted the way the
// Verification screen posts it.
export async function verify(api: APIRequestContext, account: Account): Promise<void> {
  const token = new URL(await verificationLink(account.email)).searchParams.get('token')
  const response = await api.post('/api/v1/auth/verify', {
    data: { verification_token: token },
  })
  expect(response.status(), await response.text()).toBe(200)
}

// The refresh cookie as the API sets it (backend/src/backend/api/v1/routes/
// auth.py). If the browser holds anything else it does not send the cookie
// to /api/v1/auth/refresh, the boot lands anonymous, and the failure looks
// like an application bug — so it is asserted here, where it reads as what
// it is.
export const REFRESH_COOKIE = {
  name: 'refresh_token',
  path: '/api/v1/auth',
  httpOnly: true,
  // Hard-coded on the server. Chromium accepts a Secure cookie over plain
  // http only because 127.0.0.1 is a loopback address, which it treats as a
  // secure context — the edge must stay on 127.0.0.1 or localhost.
  secure: true,
  sameSite: 'Strict',
} as const

export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60

// Sign in through the browser context's own request client. It shares the
// cookie jar with the browser, so the refresh cookie is the one the server
// set with its own Set-Cookie — nothing is forged or copied by hand. The
// access token in the answer is thrown away: the session in the page is the
// one the application's boot refresh produces from that cookie.
export async function signInThroughApi(context: BrowserContext, account: Account): Promise<void> {
  const response = await context.request.post('/api/v1/auth/login', {
    form: { username: account.email, password: account.password },
  })
  expect(response.status(), await response.text()).toBe(200)
  await expectRefreshCookie(context)
}

export async function expectRefreshCookie(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies()
  const cookie = cookies.find((candidate) => candidate.name === REFRESH_COOKIE.name)
  expect(cookie, 'the browser holds no refresh cookie after sign-in').toBeDefined()
  expect(cookie).toMatchObject({
    ...REFRESH_COOKIE,
    // Host-only: no Domain attribute, so the cookie belongs to the edge's
    // host exactly.
    domain: new URL(EDGE_URL).hostname,
  })
  // Max-Age, not a session cookie: a browser restart keeps the session.
  const ttl = cookie!.expires - Date.now() / 1000
  expect(ttl).toBeGreaterThan(REFRESH_TTL_SECONDS - 120)
  expect(ttl).toBeLessThanOrEqual(REFRESH_TTL_SECONDS)
}
