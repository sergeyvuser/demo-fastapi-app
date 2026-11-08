import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteAlert, setAlertStatus } from '../alerts/actions'
import { signIn } from '../api/auth'
import { endSession, startSession } from '../api/session'
import { ACTIONS, installTracing, reportError, traced, uninstallTracing } from './tracing'

const USER = '7f0c2a4e-3b1d-4c55-9e1a-2d8f6b0c9a11'
const EMAIL = 'someone@example.com'
const PASSWORD = 'correct horse battery staple'

// A token shaped like the server's: only its `sub` is ever read.
function tokenFor(sub: string): string {
  const part = (value: object) =>
    btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `${part({ alg: 'HS256' })}.${part({ sub, exp: 4102444800 })}.signature`
}
const TOKEN = tokenFor(USER)

let spans: InMemorySpanExporter
let requests: Request[]

beforeEach(() => {
  spans = new InMemorySpanExporter()
  installTracing(new SimpleSpanProcessor({ exporter: spans }))
  requests = []
  vi.stubGlobal('fetch', (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input
    requests.push(request)
    const { pathname } = new URL(request.url)
    if (pathname === '/api/v1/auth/login') {
      return Promise.resolve(
        Response.json({ access_token: TOKEN, token_type: 'bearer', expires_in: 900 }),
      )
    }
    if (pathname === '/api/v1/auth/refresh') {
      return Promise.resolve(new Response(null, { status: 401 }))
    }
    return Promise.resolve(new Response(null, { status: 204 }))
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  endSession()
  await uninstallTracing()
})

function finished() {
  return spans.getFinishedSpans()
}

function apiRequests() {
  return requests.filter((request) => !request.url.endsWith('/auth/refresh'))
}

describe('the traced actions', () => {
  it('are a closed list of five names, and nothing else makes a span', () => {
    // pause and resume are the one switch; together with sign in, create and
    // delete they are the four buttons the ticket names
    expect(ACTIONS).toEqual([
      'auth.sign_in',
      'alert.create',
      'alert.pause',
      'alert.resume',
      'alert.delete',
    ])
  })

  it('put their trace on the request, so the API’s span joins it', async () => {
    startSession(TOKEN, 900)
    await setAlertStatus('a', 'paused')
    await setAlertStatus('a', 'active')
    await deleteAlert('a')

    expect(finished().map((span) => span.name)).toEqual([
      'alert.pause',
      'alert.resume',
      'alert.delete',
    ])
    finished().forEach((span, index) => {
      const { traceId, spanId } = span.spanContext()
      expect(apiRequests()[index].headers.get('traceparent')).toBe(`00-${traceId}-${spanId}-01`)
    })
  })

  it('never send a correlation id of their own', async () => {
    startSession(TOKEN, 900)
    await deleteAlert('a')
    expect(apiRequests()[0].headers.has('x-request-id')).toBe(false)
  })

  it('tag the sign-in with the User it signed in', async () => {
    await signIn(EMAIL, PASSWORD)
    const [span] = finished()
    expect(span.name).toBe('auth.sign_in')
    expect(span.attributes).toEqual({ 'user.id': USER })
  })

  it('carry the User’s id and nothing else: no address, password, token or body', async () => {
    await signIn(EMAIL, PASSWORD)
    await deleteAlert('a')

    for (const span of finished()) {
      expect(Object.keys(span.attributes)).toEqual(['user.id'])
      const everything = JSON.stringify({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        resource: span.resource.attributes,
      })
      for (const secret of [EMAIL, 'someone', PASSWORD, TOKEN, 'http://', 'https://']) {
        expect(everything).not.toContain(secret)
      }
    }
  })

  it('are the same on the demo account: no branch, its id is just one more id', async () => {
    const demo = tokenFor('00000000-0000-4000-8000-00000000de30')
    startSession(demo, 900)
    await deleteAlert('a')
    expect(finished()[0].attributes).toEqual({ 'user.id': '00000000-0000-4000-8000-00000000de30' })
  })

  it('go without an id when nobody is signed in', async () => {
    await expect(
      traced('alert.delete', () => Promise.reject(new TypeError('Failed to fetch'))),
    ).rejects.toThrow()
    expect(finished()[0].attributes).toEqual({})
  })
})

describe('errors', () => {
  it('inside an action become an event on its span', async () => {
    startSession(TOKEN, 900)
    vi.stubGlobal('fetch', () =>
      Promise.resolve(Response.json({ detail: `No such user ${EMAIL}` }, { status: 500 })),
    )
    await expect(deleteAlert('a')).rejects.toThrow()

    const [span] = finished()
    expect(span.status.code).toBe(2) // ERROR
    expect(span.events.map((event) => event.name)).toEqual(['exception'])
    // reduced to the status: the server's sentence can echo what was typed
    expect(span.events[0].attributes).toEqual({
      'exception.type': 'ApiError',
      'exception.message': 'HTTP 500',
    })
  })

  it('settled inside the action are not errors: a 404 on delete is a success', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({}, { status: 404 })))
    await deleteAlert('a')
    expect(finished()[0].status.code).toBe(0) // UNSET
    expect(finished()[0].events).toEqual([])
  })

  it('outside every action become a span of their own, with no parent', async () => {
    startSession(TOKEN, 900)
    await deleteAlert('a')
    reportError(new RangeError('render crashed'))

    const [action, error] = finished()
    expect(error.name).toBe('uncaught error')
    expect(error.parentSpanContext).toBeUndefined()
    expect(error.spanContext().traceId).not.toBe(action.spanContext().traceId)
    expect(error.events[0].attributes).toMatchObject({
      'exception.type': 'RangeError',
      'exception.message': 'render crashed',
    })
    expect(error.attributes).toEqual({ 'user.id': USER })
  })

  it('already on an action’s span are not reported a second time', async () => {
    const failure = new TypeError('Failed to fetch')
    await expect(traced('alert.delete', () => Promise.reject(failure))).rejects.toBe(failure)
    // the same rejection, surfacing again as unhandled
    reportError(failure)
    expect(finished().map((span) => span.name)).toEqual(['alert.delete'])
  })
})
