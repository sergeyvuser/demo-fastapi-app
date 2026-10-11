import type { components, paths } from './generated/http'

type AccessToken = components['schemas']['AccessToken']

// Typed against the schema, so renaming the route on the backend breaks the
// build here rather than the session in production.
const REFRESH: keyof paths = '/api/v1/auth/refresh'

// The access token lives here and nowhere else: not in storage, not in the
// query cache. A reload loses it, and the refresh cookie buys a new one.
let accessToken: string | null = null

let inFlight: Promise<string | null> | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

// Single-flight: however many requests discover an expired token at once,
// one refresh is sent and they all await it. Two would be worse than waste —
// the second presents a refresh token the first has already rotated, and the
// server answers reuse by revoking the whole token family.
export function refreshSession(): Promise<string | null> {
  inFlight ??= requestToken().finally(() => {
    inFlight = null
  })
  return inFlight
}

// Plain fetch, not the API client: the refresh must not pass through the
// middleware that calls it.
async function requestToken(): Promise<string | null> {
  try {
    // no body and no header: the httpOnly cookie is the credential
    const response = await fetch(REFRESH, { method: 'POST' })
    accessToken = response.ok ? ((await response.json()) as AccessToken).access_token : null
  } catch {
    // the network failed; whoever asked gets their 401 back
    accessToken = null
  }
  return accessToken
}
