import { useSyncExternalStore } from 'react'

import { reconnectDelay } from '../realtime/backoff'
import type { components, paths } from './generated/http'

type AccessToken = components['schemas']['AccessToken']

// Typed against the schema, so renaming the route on the backend breaks the
// build here rather than the session in production.
const REFRESH: keyof paths = '/api/v1/auth/refresh'

// One name for the whole origin: every tab asks for the same lock, so only
// one of them holds the refresh cookie in flight at a time.
const REFRESH_LOCK = 'alerts.refresh'

// Three values, not two. Until the boot refresh answers, "no session" and "not
// known yet" look the same — and a guard that cannot tell them apart flashes
// the sign-in screen on every reload of a deep link.
export type SessionStatus = 'pending' | 'authenticated' | 'anonymous'

export type Session = {
  status: SessionStatus
  // True only when a session that existed was lost — a refresh refused while
  // signed in. That is what the sign-in screen explains; a first visit, or a
  // reload with no cookie, has nothing to explain.
  expired: boolean
}

// The access token lives here and nowhere else: not in storage, not in the
// query cache. A reload loses it, and the refresh cookie buys a new one.
let accessToken: string | null = null
// How long the current token was issued for, in seconds — `expires_in`, as
// the server answered. Relative on purpose: an absolute instant would be
// compared with this machine's clock, which need not agree with the server's.
let lifetime: number | null = null

let session: Session = { status: 'pending', expired: false }
const listeners = new Set<() => void>()

let inFlight: Promise<string | null> | null = null
let boot: Promise<void> | null = null

// Whether the last refresh got no answer — the network failed, or the edge
// answered for an `api` that was restarting — and another is on its way. The
// session's status is left as it was meanwhile: only the server can end a
// session, by refusing it.
let unanswered = false
const unansweredListeners = new Set<() => void>()
let attempt = 0
let retry: ReturnType<typeof setTimeout> | undefined

// Bumped by every sign-in and sign-out. A refresh that left before one of
// them answers a question nobody is asking any more, and its answer is
// dropped: a retry landing after a sign-out must not sign the person back in.
let epoch = 0

export function getAccessToken(): string | null {
  return accessToken
}

// Read it when the session announces a new token: that is the moment the
// lifetime starts counting from.
export function getTokenLifetime(): number | null {
  return lifetime
}

export function getSession(): Session {
  return session
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession(): Session {
  return useSyncExternalStore(subscribeToSession, getSession)
}

// True while the boot screen should say the server is not answering rather
// than keep drawing the outline of content that is not coming.
export function isRefreshUnanswered(): boolean {
  return unanswered
}

export function subscribeToRefreshUnanswered(listener: () => void): () => void {
  unansweredListeners.add(listener)
  return () => unansweredListeners.delete(listener)
}

export function useRefreshUnanswered(): boolean {
  return useSyncExternalStore(subscribeToRefreshUnanswered, isRefreshUnanswered)
}

export function startSession(token: string, expiresIn: number): void {
  epoch += 1
  grant(token, expiresIn)
}

export function endSession(expired = false): void {
  epoch += 1
  revoke(expired)
}

function grant(token: string, expiresIn: number): void {
  answered()
  accessToken = token
  lifetime = expiresIn
  publish({ status: 'authenticated', expired: false })
}

function revoke(expired: boolean): void {
  answered()
  accessToken = null
  lifetime = null
  publish({ status: 'anonymous', expired })
}

function publish(next: Session): void {
  // A new object on every change and the same one otherwise:
  // useSyncExternalStore compares snapshots by identity.
  session = next
  for (const listener of listeners) listener()
}

// The first thing every page load does. The refresh cookie is httpOnly, so
// the only way to learn whether a session exists is to ask. Started once and
// shared: the guard of every signed-in route awaits this same promise. It
// settles on an answer, not on an attempt — a boot into a restarting `api`
// keeps retrying, and the guard keeps waiting, until the server says yes or no.
export function bootSession(): Promise<void> {
  boot ??= refreshSession().then(leftPending)
  return boot
}

// Whatever refresh is in the air, landed — but not the boot's answer. Sign-in
// waits for this: a boot refresh whose 401 lands after the sign-in would end
// the session just started, while waiting for an answer from a server that
// is not giving one would keep the sign-in button spinning with it.
export async function refreshLanded(): Promise<void> {
  void bootSession()
  await inFlight
}

function leftPending(): Promise<void> {
  return new Promise((resolve) => {
    const settled = () => session.status !== 'pending'
    if (settled()) return resolve()
    const unsubscribe = subscribeToSession(() => {
      if (!settled()) return
      unsubscribe()
      resolve()
    })
  })
}

// Single-flight: however many requests discover an expired token at once,
// one refresh is sent and they all await it. Two would be worse than waste —
// the second presents a refresh token the first has already rotated, and the
// server answers reuse by revoking the whole token family.
export function refreshSession(): Promise<string | null> {
  inFlight ??= acrossTabs(requestToken).finally(() => {
    inFlight = null
  })
  return inFlight
}

// The same race, one level up: two tabs share one cookie but not this module.
// Under the lock the loser runs its own refresh after the winner's has landed,
// so it presents the new cookie, which is legal, not the rotated one.
function acrossTabs<T>(task: () => Promise<T>): Promise<T> {
  // Every browser this application supports has Web Locks, but only in a
  // secure context — and jsdom has none at all. Without it the tab is still
  // single-flight; only the cross-tab guarantee is lost.
  if (!('locks' in navigator)) return task()
  return navigator.locks.request(REFRESH_LOCK, task)
}

// Resolves to the new token, or to null when there is none: the refresh was
// refused (the session is over) or got no answer (the session stands, and a
// retry is on its way). The status tells the two apart.
async function requestToken(): Promise<string | null> {
  const asked = epoch
  const answer = await askForToken()
  // signed in or out meanwhile: whatever is current now is the answer
  if (asked !== epoch) return accessToken

  if (answer === 'refused') {
    // `expired` only for a session that existed: a first visit with no
    // cookie is refused too, and has nothing to explain.
    revoke(session.status === 'authenticated')
  } else if (answer === 'unanswered') {
    // Not a sign-out. The old token stays — it may still be good for a
    // minute, and it is the session's, not this refresh's — but it is not
    // handed out as if it were new.
    stall()
    return null
  } else {
    grant(answer.access_token, answer.expires_in)
  }
  return accessToken
}

// Plain fetch, not the API client: the refresh must not pass through the
// middleware that calls it. Only a 401 is a refusal (RFC 6749 §5.2 gives it
// its own error, `invalid_grant`); anything else — a network error, a 502
// from the edge while `api` restarts, a 429 — says nothing about the session.
async function askForToken(): Promise<AccessToken | 'refused' | 'unanswered'> {
  try {
    // no body and no header: the httpOnly cookie is the credential
    const response = await fetch(REFRESH, { method: 'POST' })
    if (response.status === 401) return 'refused'
    if (!response.ok) return 'unanswered'
    return (await response.json()) as AccessToken
  } catch {
    return 'unanswered'
  }
}

// Ask again later, with the socket's backoff: a deploy leaves every open tab
// unanswered at once, and full jitter spreads them over the seconds after.
// The network coming back, or the person looking at the tab, cuts the wait
// short. Every retry is an ordinary refreshSession(): single-flight, and under
// the cross-tab lock.
function stall(): void {
  clearTimeout(retry)
  retry = setTimeout(retryNow, reconnectDelay(attempt))
  attempt += 1
  if (unanswered) return
  window.addEventListener('online', retryNow)
  document.addEventListener('visibilitychange', retryIfVisible)
  setUnanswered(true)
}

// The server spoke — yes or no — or a sign-in or sign-out made the question
// moot. Either way nothing is retried any more.
function answered(): void {
  clearTimeout(retry)
  retry = undefined
  attempt = 0
  if (!unanswered) return
  window.removeEventListener('online', retryNow)
  document.removeEventListener('visibilitychange', retryIfVisible)
  setUnanswered(false)
}

function retryNow(): void {
  clearTimeout(retry)
  void refreshSession()
}

function retryIfVisible(): void {
  if (!document.hidden) retryNow()
}

function setUnanswered(value: boolean): void {
  unanswered = value
  for (const listener of unansweredListeners) listener()
}
