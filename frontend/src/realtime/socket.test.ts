import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { queryClient } from '../api/client'
import { endSession, getSession, startSession } from '../api/session'
import type { ClientFrame, ServerMessage } from '../api/socket'
import { getQuote, resetPrices, seedPrices } from '../prices/store'
import {
  HIDDEN_RELEASE_MS,
  holdRealtime,
  RENEW_AHEAD_MS,
  startRealtime,
  WATCHDOG_MS,
} from './socket'
import { getRealtimeStatus } from './status'

// The browser's WebSocket as this client uses it, with the server's half
// driven by the test: `open`, `say` and `drop` are what the server does.
class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: FakeSocket[] = []

  readyState = FakeSocket.CONNECTING
  sent: ClientFrame[] = []
  closedByClient = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null

  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientFrame)
  }

  close(): void {
    this.closedByClient = true
    this.readyState = FakeSocket.CLOSED
  }

  open(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  say(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  drop(code: number): void {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.({ code })
  }
}

const BTC = { symbol: 'BTCUSDT', price: '81794.5', reference_price: '80000', precision: 1 }
const ETH = { symbol: 'ETHUSDT', price: '2427.91', reference_price: '2514.57', precision: 2 }

const ABNORMAL = 1006

function tick(symbol: string, price: string): ServerMessage {
  return { type: 'tick', symbol, price, reference_price: '80000', ts: '2026-10-15T12:00:00Z' }
}

function sockets(): number {
  return FakeSocket.all.length
}

function latest(): FakeSocket {
  return FakeSocket.all.at(-1)!
}

// A socket that opened and was answered: the server speaks only to an
// authenticated connection, so that is a socket that authenticated.
function goLive(symbols = ['BTCUSDT', 'ETHUSDT']): FakeSocket {
  const socket = latest()
  socket.open()
  socket.say({ type: 'watching', symbols })
  return socket
}

// Time passing on a healthy socket: the server's heartbeat after every 20 s
// of silence, so only what the test is about can close it.
function elapse(ms: number, socket: FakeSocket): void {
  for (let left = ms; left > 0; left -= 20_000) {
    vi.advanceTimersByTime(Math.min(left, 20_000))
    if (left >= 20_000 && !socket.closedByClient) socket.say({ type: 'heartbeat' })
  }
}

let hidden = false

function setHidden(value: boolean): void {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

// The refresh endpoint, answering with the next token or refusing.
function refreshAnswers(ok: boolean): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      ok
        ? Response.json({ access_token: 'access-2', token_type: 'bearer', expires_in: 900 })
        : new Response(null, { status: 401 }),
    ),
  )
}

let stop: () => void = () => {}
let invalidate: MockInstance<typeof queryClient.invalidateQueries>

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  // the middle of the jitter range, so every delay is exactly half its ceiling
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  seedPrices([BTC, ETH])
  stop = startRealtime()
})

afterEach(() => {
  stop()
  endSession()
  resetPrices()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('opening the socket', () => {
  it('opens only for a signed-in tab, and says who it is before anything else', () => {
    expect(sockets()).toBe(0)

    startSession('access-1', 900)
    const socket = latest()
    expect(socket.url).toBe('ws://localhost:3000/api/v1/ws')
    socket.open()

    expect(socket.sent).toEqual([
      { action: 'auth', token: 'access-1' },
      { action: 'watch', symbols: ['BTCUSDT', 'ETHUSDT'] },
    ])
  })

  it('draws nothing from a connection that has not been answered', () => {
    startSession('access-1', 900)
    const socket = latest()
    socket.open()

    expect(getRealtimeStatus()).toBe('connecting')
    // a Tick before the server has said what this connection watches
    socket.say(tick('BTCUSDT', '90000.0'))
    expect(getQuote('BTCUSDT')?.price).toBe('81794.5')

    socket.say({ type: 'watching', symbols: ['BTCUSDT'] })
    socket.say(tick('BTCUSDT', '90000.0'))
    expect(getQuote('BTCUSDT')?.price).toBe('90000.0')
    expect(getRealtimeStatus()).toBe('live')
  })

  it('refetches the symbols list once the socket is back', () => {
    startSession('access-1', 900)
    goLive()

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['get', '/api/v1/symbols'],
    })
  })
})

describe('what the socket watches', () => {
  it('believes the server over its own request when fewer were accepted', () => {
    startSession('access-1', 900)
    const socket = latest()
    socket.open()
    // ETHUSDT left the Subscription while this tab held an older list
    socket.say({ type: 'error', code: 'unknown_symbols', symbols: ['ETHUSDT'] })
    socket.say({ type: 'watching', symbols: ['BTCUSDT'] })

    // not asked for again: it would be refused again, round and round
    expect(socket.sent).toHaveLength(2)
    // and nothing for it is drawn, should anything arrive
    socket.say(tick('ETHUSDT', '9.99'))
    expect(getQuote('ETHUSDT')?.price).toBe('2427.91')
    socket.say(tick('BTCUSDT', '90000.0'))
    expect(getQuote('BTCUSDT')?.price).toBe('90000.0')
  })

  it('asks for what the server says it lacks, not for what it asked for', () => {
    startSession('access-1', 900)
    const socket = latest()
    socket.open()
    // no error, and still one short: the answer is what counts
    socket.say({ type: 'watching', symbols: ['BTCUSDT'] })

    expect(socket.sent.at(-1)).toEqual({ action: 'watch', symbols: ['ETHUSDT'] })
  })

  it('follows the symbols list as it changes', () => {
    startSession('access-1', 900)
    const socket = goLive()

    seedPrices([BTC])
    expect(socket.sent.at(-1)).toEqual({ action: 'unwatch', symbols: ['ETHUSDT'] })
    socket.say({ type: 'watching', symbols: ['BTCUSDT'] })

    // a Tick republishes the store; it is not a new list
    socket.say(tick('BTCUSDT', '90000.0'))
    expect(socket.sent).toHaveLength(3)
  })
})

describe('liveness', () => {
  it('declares a silent socket dead after 45 seconds, any message resetting the clock', () => {
    startSession('access-1', 900)
    const socket = goLive()

    vi.advanceTimersByTime(WATCHDOG_MS - 1_000)
    socket.say({ type: 'heartbeat' })
    vi.advanceTimersByTime(WATCHDOG_MS - 1_000)
    socket.say(tick('BTCUSDT', '90000.0'))
    vi.advanceTimersByTime(WATCHDOG_MS - 1_000)
    expect(socket.closedByClient).toBe(false)

    vi.advanceTimersByTime(1_000)
    expect(socket.closedByClient).toBe(true)
    expect(getRealtimeStatus()).toBe('down')
    // and it reconnects through the backoff, like any other loss
    vi.advanceTimersByTime(500)
    expect(sockets()).toBe(2)
  })
})

describe('reconnecting', () => {
  it('backs off exponentially, and only a successful auth resets the count', () => {
    startSession('access-1', 900)

    // refused at the handshake: half of 1 s, then half of 2 s
    latest().drop(ABNORMAL)
    vi.advanceTimersByTime(499)
    expect(sockets()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(sockets()).toBe(2)

    // opened, then closed before a word: an open is not progress
    latest().open()
    latest().drop(ABNORMAL)
    vi.advanceTimersByTime(999)
    expect(sockets()).toBe(2)
    vi.advanceTimersByTime(1)
    expect(sockets()).toBe(3)

    // answered, then lost: the count starts over
    goLive()
    latest().drop(ABNORMAL)
    vi.advanceTimersByTime(500)
    expect(sockets()).toBe(4)
  })

  it('does not wait out the backoff when the network comes back', () => {
    startSession('access-1', 900)
    latest().drop(ABNORMAL)

    window.dispatchEvent(new Event('online'))
    expect(sockets()).toBe(2)
    // and the timer it skipped does not fire a third
    vi.advanceTimersByTime(30_000)
    expect(sockets()).toBe(2)
  })

  it('does not wait out the backoff when the tab is looked at', () => {
    startSession('access-1', 900)
    latest().drop(ABNORMAL)

    setHidden(false)
    expect(sockets()).toBe(2)
  })

  it('volunteers a fresh auth frame after every refresh', () => {
    startSession('access-1', 900)
    const socket = goLive()

    startSession('access-2', 900)

    expect(socket.sent.at(-1)).toEqual({ action: 'auth', token: 'access-2' })
    expect(sockets()).toBe(1)
  })
})

describe('a tab nobody looks at', () => {
  it('gives its socket back after a minute, and wakes through the reconnect path', () => {
    startSession('access-1', 900)
    const socket = goLive()

    setHidden(true)
    elapse(HIDDEN_RELEASE_MS - 1, socket)
    expect(socket.closedByClient).toBe(false)
    vi.advanceTimersByTime(1)
    expect(socket.closedByClient).toBe(true)
    vi.advanceTimersByTime(10 * 60_000)
    expect(sockets()).toBe(1)

    setHidden(false)
    expect(sockets()).toBe(2)
    latest().open()
    expect(latest().sent[0]).toEqual({ action: 'auth', token: 'access-1' })
  })

  it('keeps its socket through a quick look elsewhere', () => {
    startSession('access-1', 900)
    const socket = goLive()

    setHidden(true)
    elapse(HIDDEN_RELEASE_MS - 1, socket)
    setHidden(false)
    elapse(HIDDEN_RELEASE_MS, socket)

    expect(socket.closedByClient).toBe(false)
    expect(sockets()).toBe(1)
  })
})

describe('close codes', () => {
  it('waits for the tab to be looked at after a newer tab replaced it (4000)', () => {
    startSession('access-1', 900)
    goLive().drop(4000)

    vi.advanceTimersByTime(10 * 60_000)
    expect(sockets()).toBe(1)

    setHidden(true)
    setHidden(false)
    expect(sockets()).toBe(2)
  })

  // A sign-out on the phone closes the laptop's socket with 1008 too; the
  // laptop's own cookie is still good.
  it('refreshes and reconnects after 1008, and the person stays signed in', async () => {
    refreshAnswers(true)
    startSession('access-1', 900)
    goLive().drop(1008)

    await vi.advanceTimersByTimeAsync(500)

    expect(getSession()).toEqual({ status: 'authenticated', expired: false })
    expect(sockets()).toBe(2)
    latest().open()
    expect(latest().sent[0]).toEqual({ action: 'auth', token: 'access-2' })
  })

  it('signs out after 1008 only when the refresh fails', async () => {
    refreshAnswers(false)
    startSession('access-1', 900)
    goLive().drop(1008)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(getSession()).toEqual({ status: 'anonymous', expired: true })
    expect(sockets()).toBe(1)
    expect(getRealtimeStatus()).toBe('off')
  })
})

describe('signing out', () => {
  it('closes the socket from this side and keeps it closed until the session ends', () => {
    startSession('access-1', 900)
    const socket = goLive()

    holdRealtime()
    expect(socket.closedByClient).toBe(true)
    // the logout call refreshing its token on the way
    startSession('access-2', 900)
    expect(sockets()).toBe(1)

    endSession()
    startSession('access-3', 900)
    expect(sockets()).toBe(2)
  })

  it('closes the socket when the session ends, and does not reconnect', () => {
    startSession('access-1', 900)
    const socket = goLive()

    endSession()
    vi.advanceTimersByTime(10 * 60_000)

    expect(socket.closedByClient).toBe(true)
    expect(sockets()).toBe(1)
    expect(getRealtimeStatus()).toBe('off')
  })
})

describe('what the prices are said to be', () => {
  it('is not stale while the first attempt is in the air, and is once one failed', () => {
    startSession('access-1', 900)
    expect(getRealtimeStatus()).toBe('connecting')

    latest().drop(ABNORMAL)
    expect(getRealtimeStatus()).toBe('down')
    vi.advanceTimersByTime(500)
    // still down while the next one connects: something already went wrong
    expect(getRealtimeStatus()).toBe('down')
  })
})

// The server closes a socket the moment its token lapses, and a live socket
// makes no request that would meet a 401 and refresh on the way.
describe('a token about to lapse', () => {
  const LIFETIME_MS = 900 * 1000

  it('is renewed a minute ahead, and the open socket is handed the new one', async () => {
    const refreshes = vi.fn()
    vi.stubGlobal('fetch', () => {
      refreshes()
      return Promise.resolve(
        Response.json({ access_token: 'access-2', token_type: 'bearer', expires_in: 900 }),
      )
    })
    startSession('access-1', 900)
    const socket = goLive()

    elapse(LIFETIME_MS - RENEW_AHEAD_MS - 1, socket)
    expect(refreshes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(refreshes).toHaveBeenCalledOnce()
    expect(socket.sent.at(-1)).toEqual({ action: 'auth', token: 'access-2' })
    // the same socket, never closed: nothing for the server to cut off
    expect(socket.closedByClient).toBe(false)
    expect(sockets()).toBe(1)

    // and the new token is renewed in its turn
    elapse(LIFETIME_MS - RENEW_AHEAD_MS, socket)
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshes).toHaveBeenCalledTimes(2)
  })

  it('is not renewed for a tab that has given its socket back', async () => {
    const refreshes = vi.fn()
    vi.stubGlobal('fetch', () => {
      refreshes()
      return Promise.resolve(new Response(null, { status: 401 }))
    })
    startSession('access-1', 900)
    goLive()

    setHidden(true)
    await vi.advanceTimersByTimeAsync(LIFETIME_MS)

    expect(refreshes).not.toHaveBeenCalled()
    expect(getSession().status).toBe('authenticated')
  })
})
