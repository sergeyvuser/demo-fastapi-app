import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The session is module state — one token, one boot promise per page load.
// Each test therefore imports a fresh copy, and a second copy in the same
// test is a second tab: same cookie, same lock manager, its own memory.
// The query string is what makes the second import a second module rather
// than the cached first.
let tabs = 0
const open: (typeof import('./session'))[] = []
async function openTab(): Promise<typeof import('./session')> {
  tabs += 1
  const tab = (await import(
    /* @vite-ignore */ `./session?tab=${tabs}`
  )) as typeof import('./session')
  open.push(tab)
  return tab
}

// The refresh endpoint as a script, one answer per request, the last one
// repeated: `down` is a network failure, a number is a bare status, `ok` a
// fresh token numbered by the request that got it.
type Answer = 'down' | 'ok' | number
function scriptedEndpoint(...answers: Answer[]) {
  let requests = 0
  vi.stubGlobal('fetch', () => {
    requests += 1
    const answer = answers[Math.min(requests, answers.length) - 1]
    if (answer === 'down') return Promise.reject(new TypeError('Failed to fetch'))
    if (answer === 'ok') {
      return Promise.resolve(
        Response.json({
          access_token: `access-${requests}`,
          token_type: 'bearer',
          expires_in: 900,
        }),
      )
    }
    return Promise.resolve(new Response(null, { status: answer }))
  })
  return { requests: () => requests }
}

// Whether a promise has settled, without waiting for it to.
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  void promise.then(() => {
    settled = true
  })
  await vi.advanceTimersByTimeAsync(0)
  return settled
}

// Stands in for the refresh endpoint with the one property that matters here:
// the cookie rotates on every success, and presenting a rotated one is reuse,
// which revokes the whole family — exactly what the backend does.
function refreshEndpoint(options: { signedIn: boolean }) {
  let cookie = options.signedIn ? 1 : null
  let revoked = false
  let requests = 0

  vi.stubGlobal('fetch', async () => {
    requests += 1
    // read when the request leaves, answered later: the window a race lives in
    const presented = cookie
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (presented === null || revoked) return new Response(null, { status: 401 })
    if (presented !== cookie) {
      revoked = true
      return new Response(null, { status: 401 })
    }
    cookie = presented + 1
    return Response.json({
      access_token: `access-${cookie}`,
      token_type: 'bearer',
      expires_in: 900,
    })
  })

  return {
    requests: () => requests,
    revoked: () => revoked,
  }
}

// Web Locks as the browser implements them for one name: requests queue and
// run one at a time. jsdom has no `navigator.locks` at all.
function installLocks() {
  let tail: Promise<unknown> = Promise.resolve()
  const locks = {
    request: (_name: string, task: () => Promise<unknown>) => {
      const run = tail.then(task)
      tail = run.catch(() => undefined)
      return run
    },
  }
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  // a tab left waiting to retry would keep its timer and its listeners
  for (const tab of open.splice(0)) tab.endSession()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // jsdom's navigator has no such property, so removing it restores it
  Reflect.deleteProperty(navigator, 'locks')
})

describe('the boot refresh', () => {
  it('starts pending, before anything has been asked', async () => {
    const tab = await openTab()

    expect(tab.getSession()).toEqual({ status: 'pending', expired: false })
  })

  it('brings a session back after a reload', async () => {
    refreshEndpoint({ signedIn: true })
    const tab = await openTab()

    await tab.bootSession()

    expect(tab.getSession()).toEqual({ status: 'authenticated', expired: false })
    expect(tab.getAccessToken()).toBe('access-2')
  })

  it('settles as anonymous when there is no session, with nothing to explain', async () => {
    refreshEndpoint({ signedIn: false })
    const tab = await openTab()

    await tab.bootSession()

    // A first visit is not an expired session: the sign-in screen must not
    // tell this person their session ended.
    expect(tab.getSession()).toEqual({ status: 'anonymous', expired: false })
    expect(tab.getAccessToken()).toBeNull()
  })

  it('is asked once however many guards await it', async () => {
    const endpoint = refreshEndpoint({ signedIn: true })
    const tab = await openTab()

    await Promise.all([tab.bootSession(), tab.bootSession(), tab.bootSession()])

    expect(endpoint.requests()).toBe(1)
  })
})

describe('refreshing a running session', () => {
  it('marks a session lost while signed in as expired', async () => {
    refreshEndpoint({ signedIn: false })
    const tab = await openTab()
    tab.startSession('access-old', 900)

    await tab.refreshSession()

    expect(tab.getSession()).toEqual({ status: 'anonymous', expired: true })
  })

  it('notifies subscribers of every change', async () => {
    refreshEndpoint({ signedIn: true })
    const tab = await openTab()
    const seen: string[] = []
    tab.subscribeToSession(() => seen.push(tab.getSession().status))

    await tab.bootSession()
    tab.endSession()

    expect(seen).toEqual(['authenticated', 'anonymous'])
  })

  it('sends one request for simultaneous refreshes in one tab', async () => {
    const endpoint = refreshEndpoint({ signedIn: true })
    const tab = await openTab()

    const tokens = await Promise.all([
      tab.refreshSession(),
      tab.refreshSession(),
      tab.refreshSession(),
    ])

    expect(endpoint.requests()).toBe(1)
    expect(new Set(tokens)).toEqual(new Set(['access-2']))
  })

  it('serialises two tabs, so neither presents a rotated cookie', async () => {
    installLocks()
    const endpoint = refreshEndpoint({ signedIn: true })
    const [first, second] = [await openTab(), await openTab()]

    const tokens = await Promise.all([first.refreshSession(), second.refreshSession()])

    // two requests — one per tab — but one after the other: the second
    // presents the cookie the first was given
    expect(endpoint.requests()).toBe(2)
    expect(endpoint.revoked()).toBe(false)
    expect(tokens).toEqual(['access-2', 'access-3'])
  })

  // The bug the lock exists for, shown rather than described: the same two
  // tabs without it. If this ever passes, the endpoint stand-in no longer
  // models reuse detection and the test above proves nothing.
  it('without the lock, two tabs revoke the family', async () => {
    const endpoint = refreshEndpoint({ signedIn: true })
    const [first, second] = [await openTab(), await openTab()]

    await Promise.all([first.refreshSession(), second.refreshSession()])

    expect(endpoint.revoked()).toBe(true)
  })
})

// A deploy restarts `api`, and every tab that refreshes meanwhile gets a
// network error or the edge's 502. Neither is the server's opinion of the
// session; only a 401 is.
describe('a refresh with no answer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // the middle of the jitter range: every wait is half its ceiling
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  it.each([
    ['a network error', 'down'],
    ['a 502 from the edge', 502],
    ['a 503', 503],
  ] as const)('leaves a running session signed in: %s', async (_case, answer) => {
    scriptedEndpoint(answer)
    const tab = await openTab()
    tab.startSession('access-old', 900)

    const token = await tab.refreshSession()

    expect(token).toBeNull()
    expect(tab.getSession()).toEqual({ status: 'authenticated', expired: false })
    // the session's own token, not handed out as a fresh one
    expect(tab.getAccessToken()).toBe('access-old')
    expect(tab.isRefreshUnanswered()).toBe(true)
  })

  it('leaves a boot pending, and the boot waits for an answer', async () => {
    scriptedEndpoint('down')
    const tab = await openTab()

    const boot = tab.bootSession()

    expect(await isSettled(boot)).toBe(false)
    expect(tab.getSession()).toEqual({ status: 'pending', expired: false })
  })

  it('retries with backoff until the server answers', async () => {
    const endpoint = scriptedEndpoint('down', 502, 'ok')
    const tab = await openTab()
    const boot = tab.bootSession()
    await vi.advanceTimersByTimeAsync(0)
    expect(endpoint.requests()).toBe(1)

    // the first wait is under 1 s, the second under 2 s
    await vi.advanceTimersByTimeAsync(500)
    expect(endpoint.requests()).toBe(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(endpoint.requests()).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(endpoint.requests()).toBe(3)

    // A reload during the outage recovers on its own: no second reload.
    expect(await isSettled(boot)).toBe(true)
    expect(tab.getSession()).toEqual({ status: 'authenticated', expired: false })
    expect(tab.getAccessToken()).toBe('access-3')
    expect(tab.isRefreshUnanswered()).toBe(false)

    // and nothing is asked again once answered
    await vi.advanceTimersByTimeAsync(60_000)
    expect(endpoint.requests()).toBe(3)
  })

  it('retries at once when the network comes back', async () => {
    const endpoint = scriptedEndpoint('down', 'ok')
    const tab = await openTab()
    void tab.bootSession()
    await vi.advanceTimersByTimeAsync(0)

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)

    expect(endpoint.requests()).toBe(2)
    expect(tab.getSession().status).toBe('authenticated')
  })

  it('retries at once when the tab is looked at', async () => {
    const endpoint = scriptedEndpoint('down', 'ok')
    const tab = await openTab()
    void tab.bootSession()
    await vi.advanceTimersByTimeAsync(0)

    // jsdom's document is never hidden, so this is a tab coming into view
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(endpoint.requests()).toBe(2)
    expect(tab.getSession().status).toBe('authenticated')
  })

  it('ends the session once a retry is refused, and only then', async () => {
    scriptedEndpoint('down', 401)
    const tab = await openTab()
    tab.startSession('access-old', 900)

    await tab.refreshSession()
    expect(tab.getSession().status).toBe('authenticated')
    await vi.advanceTimersByTimeAsync(500)

    // a session that existed and was refused: what `expired` is for
    expect(tab.getSession()).toEqual({ status: 'anonymous', expired: true })
    expect(tab.isRefreshUnanswered()).toBe(false)
  })

  it('settles a boot refused after an outage as a first visit, not an expired session', async () => {
    scriptedEndpoint('down', 401)
    const tab = await openTab()
    const boot = tab.bootSession()

    await vi.advanceTimersByTimeAsync(500)

    expect(await isSettled(boot)).toBe(true)
    expect(tab.getSession()).toEqual({ status: 'anonymous', expired: false })
  })

  it('stops retrying after a sign-out, and a retry in the air cannot undo it', async () => {
    let release: () => void = () => {}
    let requests = 0
    vi.stubGlobal('fetch', async () => {
      requests += 1
      if (requests === 1) throw new TypeError('Failed to fetch')
      // the retry hangs until the test lets it through, granted
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return Response.json({ access_token: 'late', token_type: 'bearer', expires_in: 900 })
    })
    const tab = await openTab()
    tab.startSession('access-old', 900)
    await tab.refreshSession()
    await vi.advanceTimersByTimeAsync(500)
    expect(requests).toBe(2)

    tab.endSession()
    release()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(tab.getSession()).toEqual({ status: 'anonymous', expired: false })
    expect(tab.getAccessToken()).toBeNull()
    expect(requests).toBe(2)
  })

  it('does not keep a sign-in waiting for a server that is not answering', async () => {
    scriptedEndpoint('down')
    const tab = await openTab()
    void tab.bootSession()

    expect(await isSettled(tab.refreshLanded())).toBe(true)
    expect(tab.getSession().status).toBe('pending')
  })
})
