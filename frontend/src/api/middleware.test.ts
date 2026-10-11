import createFetchClient from 'openapi-fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { paths } from './generated/http'
import { authMiddleware } from './middleware'
import { ApiError } from './problem'
import { getAccessToken, setAccessToken } from './session'

// Node has no page to resolve a relative URL against, so this client gets a
// base; the middleware under test is the same object the application uses.
const api = createFetchClient<paths>({
  baseUrl: 'http://api.test',
  // openapi-fetch keeps the fetch it saw when the client was created; this
  // looks the global up on every call, so each test's stub is the one used
  fetch: (request) => fetch(request),
})
api.use(authMiddleware)

const REFRESH = '/api/v1/auth/refresh'

type Handler = (request: Request) => Response | Promise<Response>

// Stands in for the network: records every request, answers from `handler`.
function network(handler: Handler) {
  const seen: Request[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    // the refresh is a bare relative path, which only a browser can resolve
    const request =
      input instanceof Request ? input : new Request(new URL(input, 'http://api.test'), init)
    seen.push(request.clone())
    // a real network reads the body, after which the request cannot be resent
    await request.arrayBuffer()
    return handler(request)
  })
  return seen
}

const json = (status: number, body: unknown) => Response.json(body, { status })
const pathOf = (request: Request) => new URL(request.url).pathname
const unauthorized = () =>
  json(401, { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Token expired' })

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

describe('authMiddleware', () => {
  it('attaches the bearer token', async () => {
    setAccessToken('t1')
    const seen = network(() => json(200, { items: [] }))

    await api.GET('/api/v1/symbols')

    expect(seen[0].headers.get('Authorization')).toBe('Bearer t1')
  })

  it('answers a 401 with one refresh and repeats the request, body included', async () => {
    setAccessToken('old')
    const seen = network((request) => {
      if (pathOf(request) === REFRESH) return json(200, { access_token: 'new', token_type: 'bearer' })
      return request.headers.get('Authorization') === 'Bearer new'
        ? json(200, { status: 'verified' })
        : unauthorized()
    })

    const { data } = await api.POST('/api/v1/auth/verify', {
      body: { verification_token: 'a'.repeat(43) },
    })

    expect(data).toEqual({ status: 'verified' })
    expect(seen.map(pathOf)).toEqual(['/api/v1/auth/verify', REFRESH, '/api/v1/auth/verify'])
    expect(await seen[2].json()).toEqual({ verification_token: 'a'.repeat(43) })
    expect(getAccessToken()).toBe('new')
  })

  it('sends a single refresh for requests that fail together', async () => {
    setAccessToken('old')
    const seen = network(async (request) => {
      if (pathOf(request) === REFRESH) {
        // long enough for every 401 to arrive while it is in flight
        await new Promise((resolve) => setTimeout(resolve, 20))
        return json(200, { access_token: 'new', token_type: 'bearer' })
      }
      return request.headers.get('Authorization') === 'Bearer new'
        ? json(200, { items: [] })
        : unauthorized()
    })

    await Promise.all([
      api.GET('/api/v1/symbols'),
      api.GET('/api/v1/symbols'),
      api.GET('/api/v1/symbols'),
    ])

    expect(seen.filter((request) => pathOf(request) === REFRESH)).toHaveLength(1)
  })

  it('gives up after one retry instead of looping', async () => {
    setAccessToken('old')
    const seen = network((request) =>
      pathOf(request) === REFRESH
        ? json(200, { access_token: 'new', token_type: 'bearer' })
        : unauthorized(),
    )

    await expect(api.GET('/api/v1/symbols')).rejects.toMatchObject({ status: 401 })
    expect(seen.map(pathOf)).toEqual(['/api/v1/symbols', REFRESH, '/api/v1/symbols'])
  })

  it('drops the token when the refresh itself is refused', async () => {
    setAccessToken('old')
    network(() => unauthorized())

    await expect(api.GET('/api/v1/symbols')).rejects.toBeInstanceOf(ApiError)
    expect(getAccessToken()).toBeNull()
  })

  it('does not refresh for a request that carried no token', async () => {
    const seen = network(() => unauthorized())

    // signing in with a wrong password is a 401 too
    await expect(api.GET('/api/v1/symbols')).rejects.toMatchObject({
      status: 401,
      detail: 'Token expired',
    })
    expect(seen).toHaveLength(1)
  })
})