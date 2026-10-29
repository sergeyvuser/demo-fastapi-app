import { queryClient } from '../api/client'
import {
  getAccessToken,
  getSession,
  getTokenLifetime,
  refreshSession,
  subscribeToSession,
} from '../api/session'
import type { ClientFrame, ServerMessage } from '../api/socket'
import { applyTrigger, recoverTriggers } from '../history/live'
import { applyTick, getSymbols, subscribeToPrices } from '../prices/store'
import { reconnectDelay } from './backoff'
import { setRealtimeStatus } from './status'

// The socket is a latency optimisation, never a source of truth: every screen
// is correct without it, from the symbols poll. What this module adds is
// speed — and the obligation never to pass a dead socket off as a live one.

export const SOCKET_PATH = '/api/v1/ws'
// The server speaks after 20 s of silence at the latest, so 45 s without a
// word is two heartbeats missed. The browser shows JavaScript neither ping nor
// pong; a message is the only proof of life a client can have, and a phone
// that changed networks may never deliver `close` at all.
export const WATCHDOG_MS = 45_000
// A tab nobody looks at gives its socket back after this long. Shorter, and a
// quick look at another tab churns a connection; never, and a background tab
// spends a phone's battery on Ticks it does not draw.
export const HIDDEN_RELEASE_MS = 60_000
// The token is renewed this long before it lapses. The server closes a socket
// with 1008 the moment its token's `exp` passes, and a live socket makes no
// HTTP request that would meet a 401 and refresh on the way — so without this
// every open tab would drop its socket every fifteen minutes. A minute is
// room for the refresh and the auth frame after it, on a slow network too.
export const RENEW_AHEAD_MS = 60_000

// Close codes from the contract (backend/api/ws/messages.py).
const CLOSE_AUTH = 1008
const CLOSE_REPLACED = 4000

// What this tab's socket is doing. One socket per tab, and no election
// between tabs: the server's sampler made a connection cheap, and a hidden
// tab releases its own.
type Phase =
  | 'stopped' // nobody is signed in, or this tab is signing out
  | 'connecting' // a socket exists and has not been heard from yet
  | 'live' // the server has spoken, so the auth frame was accepted
  | 'waiting' // backing off before the next attempt
  | 'refreshing' // closed with 1008; a refresh decides what comes next
  | 'released' // hidden for a minute; reopens on visibility
  | 'replaced' // closed with 4000 by a newer tab; reopens on visibility

// The full symbols-list key as openapi-react-query builds it, minus the
// options: invalidation matches by prefix.
const SYMBOLS_QUERY = ['get', '/api/v1/symbols'] as const

function socketUrl(): string {
  // The same origin as the page, in the socket's own scheme.
  const url = new URL(SOCKET_PATH, location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

class RealtimeClient {
  private phase: Phase = 'stopped'
  private socket: WebSocket | null = null
  // Reset on a successful auth, not on `open`: a server that accepts the
  // handshake and refuses the token would otherwise be retried every second
  // forever, since every attempt "succeeds" at opening.
  private attempt = 0
  // Whether anything has gone wrong since sign-in. Until it has, a socket
  // still connecting is the normal start of a page and is not called stale.
  private failed = false
  // Set by a sign-out in progress: the logout call may refresh its token on
  // the way, and that must not reopen the socket being given up.
  private held = false

  // What the server says this connection watches — never what was asked
  // for. `null` until it has said anything.
  private watching: ReadonlySet<string> | null = null
  // Names the server refused as unknown. Asked for again they would be
  // refused again, round and round; a reconnect forgets them, because the
  // list it refetches may have changed.
  private rejected = new Set<string>()
  // watch / unwatch frames sent and not yet answered by a `watching`. Until
  // they are, the server's last answer is out of date and nothing is diffed
  // against it.
  private unanswered = 0
  // The symbols list last diffed against: Ticks republish the store but keep
  // the list's identity, so this tells a new Subscription from a price move.
  private intent: readonly string[] | null = null

  private watchdog: ReturnType<typeof setTimeout> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private hiding: ReturnType<typeof setTimeout> | undefined
  private renewal: ReturnType<typeof setTimeout> | undefined

  private readonly teardown: (() => void)[] = []

  install(): () => void {
    const onVisibility = () => this.onVisibility()
    const onOnline = () => this.onOnline()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    this.teardown.push(
      subscribeToSession(() => this.onSession()),
      subscribeToPrices(() => this.onPrices()),
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('online', onOnline),
    )
    this.onSession()
    return () => {
      for (const undo of this.teardown.splice(0)) undo()
      this.stop()
    }
  }

  // Close this tab's socket ahead of a sign-out, and keep it closed until the
  // session is gone. Otherwise the server's own 1008 — logout closes every
  // socket of the User — reaches this tab first, and the refresh it answers
  // with finds a cookie the logout already revoked: "your session expired"
  // instead of an ordinary sign-out.
  hold(): void {
    this.held = true
    this.stop()
  }

  // -- the outside world -----------------------------------------------------

  private onSession(): void {
    const { status } = getSession()
    if (status === 'anonymous') {
      this.held = false
      this.stop()
      return
    }
    if (status !== 'authenticated' || this.held) return

    // Every new token restarts the clock, whichever way it was obtained.
    this.armRenewal()

    if (this.phase === 'stopped') {
      this.attempt = 0
      this.failed = false
      this.connect()
      if (document.hidden) this.onVisibility()
      return
    }
    // A new token. On an open socket it is volunteered at once, so the server
    // never has to close a connection whose token quietly expired; a socket
    // not open yet will send the current one when it opens.
    const token = getAccessToken()
    if (token !== null) this.send({ action: 'auth', token })
  }

  private onPrices(): void {
    const symbols = getSymbols()
    if (symbols === this.intent) return
    this.intent = symbols
    this.reconcile()
  }

  private onVisibility(): void {
    if (this.phase === 'stopped') return
    if (document.hidden) {
      this.hiding ??= setTimeout(() => this.release(), HIDDEN_RELEASE_MS)
      return
    }
    clearTimeout(this.hiding)
    this.hiding = undefined
    // Waking up and reconnecting are the same path, and coming back to the
    // tab does not wait out a backoff. A tab pushed out by a newer one comes
    // back here too: now it is the one being looked at.
    if (this.phase === 'released' || this.phase === 'replaced' || this.phase === 'waiting') {
      this.connect()
    }
  }

  private onOnline(): void {
    // The network is back: whatever the backoff was waiting for is over.
    if (this.phase === 'waiting') this.connect()
  }

  // -- the socket ------------------------------------------------------------

  private connect(): void {
    clearTimeout(this.retry)
    this.abandon()

    const socket = new WebSocket(socketUrl())
    this.socket = socket
    this.watching = null
    this.rejected.clear()
    this.unanswered = 0
    this.enter('connecting')
    this.armWatchdog()

    socket.onopen = () => {
      const token = getAccessToken()
      if (token === null) return
      // The first frame, within the server's five seconds; nothing is served
      // before it. Then the whole set in one frame: the server remembers
      // nothing across connections. Sent even when empty, because its answer
      // is the only sign the auth frame was accepted — the server sends no
      // reply to auth itself.
      this.send({ action: 'auth', token })
      this.intent = getSymbols()
      this.sendWatch('watch', this.intent ?? [])
    }
    socket.onmessage = (event: MessageEvent<string>) => this.receive(event.data)
    socket.onclose = (event) => this.lost(event.code)
    // `error` is always followed by `close`, which is where it is handled.
  }

  private receive(data: string): void {
    // Any message at all is proof of life.
    this.armWatchdog()

    let message: ServerMessage
    try {
      message = JSON.parse(data) as ServerMessage
    } catch {
      return
    }

    if (this.phase === 'connecting') {
      // The server speaks to an authenticated connection only, so its first
      // word is the acceptance of the token.
      this.attempt = 0
      this.enter('live')
      // The gap, closed by asking: the server kept nothing for this tab while
      // it was away, and replays nothing now. Both sides of it — whatever
      // moved, with the Subscription as it is now (a Symbol that has not
      // ticked since would otherwise stay at its price from before), and
      // whatever went off.
      void queryClient.invalidateQueries({ queryKey: SYMBOLS_QUERY })
      recoverTriggers()
    }

    switch (message.type) {
      case 'tick':
        // Only for what the server confirms this connection watches: before
        // its first `watching` the set is null, and nothing is drawn.
        if (this.watching?.has(message.symbol)) {
          applyTick(message.symbol, message.price, message.reference_price)
        }
        break
      case 'watching':
        this.unanswered = Math.max(0, this.unanswered - 1)
        this.watching = new Set(message.symbols)
        this.reconcile()
        break
      case 'error':
        if (message.code === 'unknown_symbols') {
          for (const symbol of message.symbols) this.rejected.add(symbol)
        }
        // invalid_frame is a bug on this side, and the socket stays open:
        // there is nothing to do here that a reload would not do better.
        break
      case 'trigger':
        // Every socket of the User hears it, whatever it watches: a Trigger
        // is the User's, not the Symbol's.
        applyTrigger(message)
        break
      case 'heartbeat':
        break
    }
  }

  // The client's intent against the server's last answer: watch what is
  // wanted and not watched, unwatch what is watched and not wanted.
  private reconcile(): void {
    if (this.phase !== 'live' || this.watching === null || this.unanswered > 0) return
    const watching = this.watching
    const wanted = new Set(this.intent ?? [])
    const add = [...wanted].filter((s) => !watching.has(s) && !this.rejected.has(s))
    const drop = [...watching].filter((s) => !wanted.has(s))
    if (add.length > 0) this.sendWatch('watch', add)
    if (drop.length > 0) this.sendWatch('unwatch', drop)
  }

  private sendWatch(action: 'watch' | 'unwatch', symbols: readonly string[]): void {
    if (this.send({ action, symbols: [...symbols] })) this.unanswered += 1
  }

  private send(frame: ClientFrame): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(frame))
    return true
  }

  private lost(code: number): void {
    this.abandon()
    this.failed = true

    if (code === CLOSE_REPLACED) {
      // A sixth tab of the same User pushed this one out. Reconnecting now
      // would push out the next oldest, and so on round the tabs; this one
      // waits until somebody looks at it.
      this.enter('replaced')
      return
    }
    if (code === CLOSE_AUTH) {
      // Never a sign-out by itself: logout is per User, so a sign-out on the
      // phone closes this laptop's socket too, and the laptop's own cookie is
      // still good. Only a refresh that fails ends the session — and
      // session.ts does that, not this module.
      this.enter('refreshing')
      void refreshSession().then((token) => {
        if (this.phase === 'refreshing' && token !== null) this.backOff()
      })
      return
    }
    this.backOff()
  }

  private backOff(): void {
    this.enter('waiting')
    this.retry = setTimeout(() => this.connect(), reconnectDelay(this.attempt))
    this.attempt += 1
  }

  private armWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      // Declared dead from this side: the close handshake may never finish,
      // so the socket is dropped rather than waited for.
      this.abandon()
      this.failed = true
      this.backOff()
    }, WATCHDOG_MS)
  }

  // Renew ahead of the token's expiry, for as long as a socket depends on it.
  // The refresh announces a new token, and onSession volunteers it to the
  // socket and arms this again. Not live — connecting, backing off, released
  // — there is no socket to keep, and the next connect sends whatever token
  // is current; one that has lapsed meets 1008 and the refresh it answers with.
  private armRenewal(): void {
    clearTimeout(this.renewal)
    const lifetime = getTokenLifetime()
    if (lifetime === null) return
    // half the lifetime for a token too short for the margin, or the renewal
    // would follow itself with no wait at all
    const delay = Math.max(lifetime * 1000 - RENEW_AHEAD_MS, (lifetime * 1000) / 2)
    this.renewal = setTimeout(() => {
      if (this.phase === 'live') void refreshSession()
    }, delay)
  }

  private release(): void {
    this.hiding = undefined
    clearTimeout(this.retry)
    this.abandon()
    this.failed = true
    this.enter('released')
  }

  private stop(): void {
    clearTimeout(this.retry)
    clearTimeout(this.renewal)
    clearTimeout(this.hiding)
    this.hiding = undefined
    this.abandon()
    this.enter('stopped')
  }

  // Let go of the current socket, if any. Its handlers are detached first: a
  // `close` that arrives later belongs to a socket this client has already
  // forgotten, and must not start a second reconnection.
  private abandon(): void {
    clearTimeout(this.watchdog)
    const socket = this.socket
    this.socket = null
    this.watching = null
    if (socket === null) return
    socket.onopen = socket.onmessage = socket.onclose = null
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close()
    }
  }

  private enter(phase: Phase): void {
    this.phase = phase
    setRealtimeStatus(
      phase === 'stopped'
        ? 'off'
        : phase === 'live'
          ? 'live'
          : phase === 'connecting' && !this.failed
            ? 'connecting'
            : 'down',
    )
  }
}

let current: RealtimeClient | null = null

// Once per page load, beside the boot refresh. It follows the session from
// then on: a sign-in opens the socket, a sign-out closes it. The returned
// function undoes it all, for tests.
export function startRealtime(): () => void {
  const client = new RealtimeClient()
  current = client
  const uninstall = client.install()
  return () => {
    uninstall()
    if (current === client) current = null
  }
}

// For signOut(): see RealtimeClient.hold.
export function holdRealtime(): void {
  current?.hold()
}
