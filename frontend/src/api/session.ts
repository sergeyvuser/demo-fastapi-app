import { useSyncExternalStore } from 'react'

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

export function startSession(token: string, expiresIn: number): void {
  accessToken = token
  lifetime = expiresIn
  publish({ status: 'authenticated', expired: false })
}

export function endSession(expired = false): void {
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
// shared: the guard of every signed-in route awaits this same promise.
export function bootSession(): Promise<void> {
  boot ??= refreshSession().then(() => undefined)
  return boot
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

// Plain fetch, not the API client: the refresh must not pass through the
// middleware that calls it.
async function requestToken(): Promise<string | null> {
  const wasSignedIn = session.status === 'authenticated'
  try {
    // no body and no header: the httpOnly cookie is the credential
    const response = await fetch(REFRESH, { method: 'POST' })
    if (response.ok) {
      const token = (await response.json()) as AccessToken
      startSession(token.access_token, token.expires_in)
    } else {
      endSession(wasSignedIn)
    }
  } catch {
    // The network failed. Signed out all the same: a session that cannot be
    // renewed cannot be used, and whoever asked gets their 401 back.
    endSession(wasSignedIn)
  }
  return accessToken
}
