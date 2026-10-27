import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession, startSession } from '../api/session'
import { FEED_PAGE_SIZE, type Trigger } from '../history/feed'
import { formatAbsolute, formatExact } from '../i18n/time'
import { resetPrices } from '../prices/store'
import { createAppRouter } from '../router'
import { renderWithProviders } from '../testing/render'

const SYMBOLS = [{ symbol: 'BTCUSDT', price: '71000.0', reference_price: '70000.0', precision: 1 }]

const ME = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'alice',
  email: 'alice@example.com',
  is_active: true,
  is_verified: true,
  telegram_chat_id: null,
  digest_enabled: false,
  is_demo: false,
}

const ALERT_ID = '00000000-0000-4000-8000-0000000000aa'
const MINUTE = 60_000

// The ids sort the way the server's tiebreak does: fixed-width lower-case
// hex compares as text exactly as Postgres compares the UUIDs.
function id(n: number): string {
  return `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`
}

function trigger(n: number, triggeredAt: string, overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: id(n),
    alert_id: ALERT_ID,
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '70000.00000000',
    price: '70123.40000000',
    triggered_at: triggeredAt,
    delivery: 'queued',
    ...overrides,
  }
}

// Newer first, and inside one instant the larger id first — the server's
// `triggered_at DESC, id DESC`.
function newestFirst(a: Trigger, b: Trigger): number {
  if (a.triggered_at !== b.triggered_at) return a.triggered_at < b.triggered_at ? 1 : -1
  return a.id < b.id ? 1 : -1
}

// The server's half of the contract, played straight: a keyset over
// `(triggered_at, id)`, not an offset. The cursor is opaque to the client and
// readable here only because this is the server's side.
let feed: Trigger[] = []
const requests: URLSearchParams[] = []

function servePage(query: URLSearchParams): Response {
  requests.push(query)
  const limit = Number(query.get('limit') ?? 50)
  const cursor = query.get('cursor')
  let rows = [...feed].sort(newestFirst)
  if (cursor !== null) {
    const [at, after] = atob(cursor).split('|')
    rows = rows.filter((row) => newestFirst(row, trigger(0, at, { id: after })) > 0)
  }
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const more = rows.length > limit && last !== undefined
  return Response.json({
    items: page,
    next_cursor: more ? btoa(`${last.triggered_at}|${last.id}`) : null,
  })
}

// jsdom has no IntersectionObserver. This one does nothing until a test says
// the end of the list came into sight, which is what scrolling amounts to.
const observers = new Set<IntersectionObserverCallback>()

function scrollToEnd(): void {
  act(() => {
    for (const callback of [...observers]) {
      callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
}

beforeEach(() => {
  feed = []
  requests.length = 0
  observers.clear()
  vi.stubGlobal('fetch', (request: Request) => {
    const url = new URL(request.url)
    if (url.pathname === '/api/v1/symbols')
      return Promise.resolve(Response.json({ items: SYMBOLS }))
    if (url.pathname === '/api/v1/users/me') return Promise.resolve(Response.json(ME))
    if (url.pathname === '/api/v1/triggers') return Promise.resolve(servePage(url.searchParams))
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
      }
      observe() {
        observers.add(this.callback)
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.callback)
      }
    },
  )
  vi.stubGlobal('WebSocket', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetPrices()
  endSession()
})

function renderHistory() {
  startSession('access', 900)
  const router = createAppRouter(
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: ['/history'] }),
  )
  return renderWithProviders(<RouterProvider router={router} />)
}

function renderedIds(): string[] {
  return screen.getAllByTestId('trigger-row').map((row) => row.dataset.triggerId!)
}

// `count` Triggers a minute apart, the newest `offset` minutes ago.
function minutesApart(count: number, from = 0, offset = 1): Trigger[] {
  return Array.from({ length: count }, (_, i) =>
    trigger(from + i, new Date(Date.now() - (offset + i) * MINUTE).toISOString()),
  )
}

describe('a Trigger row', () => {
  it('carries the Symbol, the rule, the Threshold and the price at firing', async () => {
    feed = [trigger(1, new Date(Date.now() - 37 * MINUTE).toISOString())]
    const { i18n } = renderHistory()

    const row = within(await screen.findByTestId('trigger-row'))
    expect(row.getByText('BTCUSDT')).toBeInTheDocument()
    // both numbers at the Symbol's precision, once the store knows it
    expect(
      await row.findByText(i18n.t('alerts.rule.price_above', { threshold: '70,000.0' })),
    ).toBeInTheDocument()
    expect(row.getByText(i18n.t('history.firedAt', { price: '70,123.4' }))).toBeInTheDocument()
    expect(row.getByText('37 minutes ago')).toBeInTheDocument()
  })

  it('shows the exact instant a hover away from a relative time', async () => {
    const at = new Date(Date.now() - 5 * MINUTE).toISOString()
    feed = [trigger(1, at)]
    renderHistory()

    const time = await screen.findByText('5 minutes ago')
    expect(time).toHaveAttribute('datetime', at)
    fireEvent.mouseEnter(time.parentElement!)
    expect(await screen.findByText(formatExact(Date.parse(at), 'en'))).toBeInTheDocument()
  })

  it('writes a Trigger older than a day as an absolute instant', async () => {
    const at = new Date(Date.now() - 26 * 60 * MINUTE).toISOString()
    feed = [trigger(1, at)]
    renderHistory()

    expect(await screen.findByText(formatAbsolute(Date.parse(at), 'en'))).toBeInTheDocument()
  })

  it('says a `no_chat` Trigger fired with nowhere to go, and where to fix it', async () => {
    feed = [
      trigger(2, new Date(Date.now() - MINUTE).toISOString(), { delivery: 'no_chat' }),
      trigger(1, new Date(Date.now() - 2 * MINUTE).toISOString(), { delivery: 'queued' }),
    ]
    const { i18n } = renderHistory()

    const [silent, delivered] = (await screen.findAllByTestId('trigger-row')).map((row) =>
      within(row),
    )
    expect(silent.getByText(i18n.t('history.noChat.badge'))).toBeInTheDocument()
    expect(silent.getByText(i18n.t('history.noChat.explained'), { exact: false })).toBeVisible()
    expect(silent.getByRole('link', { name: i18n.t('history.noChat.action') })).toHaveAttribute(
      'href',
      '/account',
    )
    expect(delivered.queryByText(i18n.t('history.noChat.badge'))).toBeNull()
  })
})

describe('the feed', () => {
  it('lists the Triggers newest first', async () => {
    feed = minutesApart(3)
    renderHistory()

    await screen.findAllByTestId('trigger-row')
    expect(renderedIds()).toEqual([id(0), id(1), id(2)])
  })

  it('renders a sentence, not a blank screen, when nothing has fired', async () => {
    const { i18n } = renderHistory()

    expect(await screen.findByText(i18n.t('history.empty'))).toBeInTheDocument()
    expect(screen.queryByTestId('trigger-row')).toBeNull()
  })

  it('loads older pages through the cursor as the end comes into sight', async () => {
    feed = minutesApart(FEED_PAGE_SIZE + 10)
    const { i18n } = renderHistory()

    await waitFor(() => expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE))
    expect(screen.queryByText(i18n.t('history.end'))).toBeNull()

    scrollToEnd()

    await waitFor(() =>
      expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE + 10),
    )
    // the second request echoed the token the first answer carried
    expect(requests[0].has('cursor')).toBe(false)
    expect(requests[1].get('cursor')).not.toBeNull()
    expect(screen.getByText(i18n.t('history.end'))).toBeInTheDocument()
  })

  it('neither repeats nor skips a row when the feed grows at its head between pages', async () => {
    const original = minutesApart(FEED_PAGE_SIZE + 10, 0, 10)
    feed = [...original]
    renderHistory()
    await waitFor(() => expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE))

    // three Alerts fire while the reader is on the first page; an offset of
    // fifty would now start three rows early and show them a second time
    feed.push(...minutesApart(3, 1000, 0))
    scrollToEnd()

    await waitFor(() =>
      expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE + 10),
    )
    expect(renderedIds()).toEqual(original.map((row) => row.id))
  })

  it('keeps the Triggers of one Tick in a stable order across a page boundary', async () => {
    // one instant shared by six Triggers, straddling the end of page one
    const tick = new Date(Date.now() - 100 * MINUTE).toISOString()
    const before = minutesApart(FEED_PAGE_SIZE - 3, 0)
    const sameTick = [500, 501, 502, 503, 504, 505].map((n) => trigger(n, tick))
    feed = [...before, ...sameTick]
    renderHistory()
    await waitFor(() => expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE))

    scrollToEnd()

    await waitFor(() =>
      expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE + 3),
    )
    // larger id first inside the instant, each exactly once
    expect(renderedIds().slice(-6)).toEqual([505, 504, 503, 502, 501, 500].map(id))
  })

  it('offers a button that loads the next page without any scrolling', async () => {
    feed = minutesApart(FEED_PAGE_SIZE + 1)
    const { i18n } = renderHistory()
    await waitFor(() => expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('history.loadOlder') }))

    await waitFor(() =>
      expect(screen.getAllByTestId('trigger-row')).toHaveLength(FEED_PAGE_SIZE + 1),
    )
  })
})
