import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The session is module state — one token, one boot promise per page load.
// Each test therefore imports a fresh copy, and a second copy in the same
// test is a second tab: same cookie, same lock manager, its own memory.
// The query string is what makes the second import a second module rather
// than the cached first.
let tabs = 0
async function openTab(): Promise<typeof import('./session')> {
  tabs += 1
  return (await import(/* @vite-ignore */ `./session?tab=${tabs}`)) as typeof import('./session')
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
    return Response.json({ access_token: `access-${cookie}`, token_type: 'bearer' })
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
    tab.startSession('access-old')

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
