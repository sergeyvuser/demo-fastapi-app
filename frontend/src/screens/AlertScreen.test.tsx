import { notifications } from '@mantine/notifications'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Alert } from '../alerts/list'
import { endSession, getSession, startSession } from '../api/session'
import type { Trigger } from '../history/feed'
import { resetPrices } from '../prices/store'
import { createAppRouter } from '../router'
import { renderWithProviders } from '../testing/render'

// The chart draws nothing in jsdom (its container has no size), and what this
// file asks of it is only that it is ticket 26's chart, fed this Alert's
// Threshold. A stand-in records exactly that.
const chartProps = vi.hoisted(() => [] as { symbol: string; threshold: number | null }[])
vi.mock('../alerts/PriceChart', () => ({
  PriceChart: (props: { symbol: string; threshold: number | null }) => {
    chartProps.push(props)
    return <div data-testid="price-chart" />
  },
}))

const SYMBOLS = [
  { symbol: 'BTCUSDT', price: '71000.0', reference_price: '70000.0', precision: 1 },
  { symbol: 'ETHUSDT', price: '2500.00', reference_price: '2400.00', precision: 2 },
]

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

const FIRST = '00000000-0000-4000-8000-00000000000a'
const SECOND = '00000000-0000-4000-8000-00000000000b'

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: FIRST,
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '70000.00000000',
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    status: 'active',
    last_triggered_at: null,
    finished_at: null,
    expires_at: null,
    trigger_count: 0,
    created_at: '2026-10-20T10:00:00Z',
    ...overrides,
  }
}

function trigger(index: number): Trigger {
  return {
    id: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
    alert_id: FIRST,
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '70000.00000000',
    price: '70100.00000000',
    triggered_at: `2026-10-20T0${index}:00:00Z`,
    delivery: 'queued',
  }
}

// What the server holds, and how it answers a write. A write answers with a
// promise the test settles, so the screen can be looked at in between.
let alerts: Alert[] = []
let triggers: Trigger[] = []
let onPatch: (id: string, body: { status: Alert['status'] }) => Promise<Response>
let onDelete: (id: string) => Promise<Response>
let requests: string[] = []
// Set, every later read of the list hangs: what the screen shows then is its
// own doing, not a refetch's.
let holdList = false

function deferred() {
  let settle!: (response: Response) => void
  const promise = new Promise<Response>((resolve) => (settle = resolve))
  return { promise, settle }
}

beforeEach(() => {
  alerts = []
  triggers = []
  requests = []
  holdList = false
  chartProps.length = 0
  onPatch = () => Promise.resolve(new Response(null, { status: 500 }))
  onDelete = () => Promise.resolve(new Response(null, { status: 204 }))
  vi.spyOn(notifications, 'show')
  vi.stubGlobal('fetch', async (request: Request) => {
    const { pathname, search } = new URL(request.url)
    requests.push(`${request.method} ${pathname}${search}`)
    if (pathname === '/api/v1/symbols') return Response.json({ items: SYMBOLS })
    if (pathname === '/api/v1/users/me') return Response.json(ME)
    if (pathname === '/api/v1/alerts') {
      if (holdList) return new Promise<Response>(() => {})
      return Response.json({ items: alerts, total: alerts.length, skip: 0, limit: 100 })
    }
    if (pathname === '/api/v1/triggers') {
      return Response.json({ items: triggers.slice(0, 5), next_cursor: null })
    }
    const one = /^\/api\/v1\/alerts\/([^/]+)$/.exec(pathname)
    if (one && request.method === 'PATCH') {
      return onPatch(one[1], (await request.json()) as { status: Alert['status'] })
    }
    if (one && request.method === 'DELETE') return onDelete(one[1])
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('WebSocket', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetPrices()
  endSession()
})

function renderAt(path: string) {
  startSession('access', 900)
  const router = createAppRouter(
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: [path] }),
  )
  return { router, ...renderWithProviders(<RouterProvider router={router} />) }
}

async function card(symbol = 'BTCUSDT') {
  const cards = await screen.findAllByTestId('alert-card')
  return within(cards.find((item) => within(item).queryByText(symbol))!)
}

describe('pause and resume', () => {
  it('pauses at once, before the server answers, and rolls back when it refuses', async () => {
    alerts = [alert()]
    const answer = deferred()
    onPatch = () => answer.promise
    const { i18n } = renderAt('/alerts')
    const paused = i18n.t('alerts.status.paused')

    const first = await card()
    holdList = true
    fireEvent.click(first.getByRole('button', { name: i18n.t('alerts.actions.pause') }))

    // the server has not answered yet
    expect(await first.findByText(paused)).toBeInTheDocument()
    expect(first.getByRole('button', { name: i18n.t('alerts.actions.resume') })).toBeInTheDocument()

    answer.settle(Response.json({ detail: 'Nope' }, { status: 409 }))

    await waitFor(() => expect(first.queryByText(paused)).toBeNull())
    // plainly: said in words, with the server's reason
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: i18n.t('alerts.actions.pauseFailed', { symbol: 'BTCUSDT' }),
        message: 'Nope',
      }),
    )
  })

  it('resumes, and keeps what the server confirmed', async () => {
    alerts = [alert({ status: 'paused' })]
    onPatch = (id, body) => {
      alerts = alerts.map((item) => (item.id === id ? { ...item, status: body.status } : item))
      return Promise.resolve(Response.json(alerts[0]))
    }
    const { i18n } = renderAt('/alerts')

    const first = await card()
    fireEvent.click(first.getByRole('button', { name: i18n.t('alerts.actions.resume') }))

    await waitFor(() => expect(first.queryByText(i18n.t('alerts.status.paused'))).toBeNull())
    expect(requests).toContain(`PATCH /api/v1/alerts/${FIRST}`)
    expect(notifications.show).not.toHaveBeenCalled()
  })
})

describe('delete', () => {
  async function askToDelete(i18n: {
    t: (key: 'alerts.actions.more' | 'alerts.actions.delete') => string
  }) {
    const first = await card()
    fireEvent.click(first.getByRole('button', { name: i18n.t('alerts.actions.more') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('alerts.actions.delete') }))
    return screen.findByRole('dialog')
  }

  it('asks first, and keeping the Alert sends nothing', async () => {
    alerts = [alert()]
    const { i18n } = renderAt('/alerts')

    const dialog = within(await askToDelete(i18n))
    fireEvent.click(dialog.getByRole('button', { name: i18n.t('alerts.confirm.cancel') }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getAllByTestId('alert-card')).toHaveLength(1)
    expect(requests.some((line) => line.startsWith('DELETE'))).toBe(false)
  })

  it('removes the card at once and puts it back when the server fails', async () => {
    alerts = [alert(), alert({ id: SECOND, symbol: 'ETHUSDT' })]
    const answer = deferred()
    onDelete = () => answer.promise
    const { i18n } = renderAt('/alerts')

    const dialog = within(await askToDelete(i18n))
    holdList = true
    fireEvent.click(dialog.getByRole('button', { name: i18n.t('alerts.confirm.delete') }))

    // gone before the server answered
    await waitFor(() => expect(screen.getAllByTestId('alert-card')).toHaveLength(1))
    // and no Undo, delayed-send or otherwise
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()

    answer.settle(Response.json({ detail: 'Internal error' }, { status: 500 }))

    await waitFor(() => expect(screen.getAllByTestId('alert-card')).toHaveLength(2))
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: i18n.t('alerts.actions.deleteFailed', { symbol: 'BTCUSDT' }),
      }),
    )
  })

  it('takes a 404 as success: the Alert was already gone', async () => {
    alerts = [alert(), alert({ id: SECOND, symbol: 'ETHUSDT' })]
    onDelete = (id) => {
      // deleted elsewhere a moment ago
      alerts = alerts.filter((item) => item.id !== id)
      return Promise.resolve(Response.json({ detail: 'Alert not found' }, { status: 404 }))
    }
    const { i18n } = renderAt('/alerts')

    const dialog = within(await askToDelete(i18n))
    fireEvent.click(dialog.getByRole('button', { name: i18n.t('alerts.confirm.delete') }))

    await waitFor(() => expect(requests).toContain(`DELETE /api/v1/alerts/${FIRST}`))
    // settled, refetched, and still gone — no rollback, no complaint
    await waitFor(() =>
      expect(requests.filter((line) => line.startsWith('GET /api/v1/alerts?'))).toHaveLength(2),
    )
    expect(screen.getAllByTestId('alert-card')).toHaveLength(1)
    expect(notifications.show).not.toHaveBeenCalled()
  })

  it('closes the open Alert it deletes, rather than showing it as not found', async () => {
    alerts = [alert(), alert({ id: SECOND, symbol: 'ETHUSDT' })]
    const { i18n, router } = renderAt(`/alerts/${FIRST}?state=active`)

    const dialog = within(await askToDelete(i18n))
    fireEvent.click(dialog.getByRole('button', { name: i18n.t('alerts.confirm.delete') }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/alerts'))
    // the list's filters survive
    expect(router.state.location.search).toEqual({ state: 'active' })
    expect(screen.queryByText(i18n.t('notFound.title'))).toBeNull()
  })
})

describe('the Alert’s own screen', () => {
  it('opens from the card with the chart, the Threshold and five Triggers', async () => {
    alerts = [alert({ trigger_count: 7, last_triggered_at: '2026-10-20T07:00:00Z' })]
    triggers = Array.from({ length: 7 }, (_, index) => trigger(7 - index))
    const { i18n, router } = renderAt('/alerts?group=symbol')

    fireEvent.click((await screen.findAllByTestId('alert-card'))[0])

    const detail = within(await screen.findByTestId('alert-detail'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/alerts/${FIRST}`))
    expect(router.state.location.search).toEqual({ group: 'symbol' })
    // ticket 26's chart, with this Alert's Threshold across it
    expect(detail.getByTestId('price-chart')).toBeInTheDocument()
    expect(chartProps.at(-1)).toEqual({ symbol: 'BTCUSDT', threshold: 70000 })
    // ticket 25's row, five of them, asked of the server for this Alert only
    expect(await detail.findAllByTestId('trigger-row')).toHaveLength(5)
    expect(requests).toContain(`GET /api/v1/triggers?alert_id=${FIRST}&limit=5`)
    expect(
      detail.getByRole('link', { name: i18n.t('alerts.detail.seeAll', { count: 7 }) }),
    ).toHaveAttribute('href', `/history?alert=${FIRST}`)
  })

  it('opens under its card on a phone', async () => {
    // jsdom answers no to every media query: the narrow layout
    alerts = [alert(), alert({ id: SECOND, symbol: 'ETHUSDT', created_at: '2026-10-21T10:00:00Z' })]
    renderAt(`/alerts/${FIRST}`)

    const detail = await screen.findByTestId('alert-detail')
    const cards = screen.getAllByTestId('alert-card')
    const opened = cards.find((item) => item.dataset.selected)!
    expect(within(opened).getByText('BTCUSDT')).toBeInTheDocument()
    // the next element after the opened card is its panel
    expect(opened.nextElementSibling).toBe(detail)
  })

  // The router scrolls a new page to the top. The list and its panel are one
  // screen: on a phone the jump threw the reader away from the card tapped.
  it('opens and closes where the reader is, without scrolling to the top', async () => {
    alerts = [alert()]
    const { i18n, router } = renderAt('/alerts')
    const first = (await screen.findAllByTestId('alert-card'))[0]
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    fireEvent.click(first)
    const detail = within(await screen.findByTestId('alert-detail'))
    fireEvent.click(detail.getByRole('button', { name: i18n.t('alerts.detail.close') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/alerts'))

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('renders the ordinary not-found state for an Alert that no longer exists', async () => {
    alerts = [alert()]
    const { i18n } = renderAt('/alerts/00000000-0000-4000-8000-0000000000ff')

    expect(await screen.findByText(i18n.t('notFound.title'))).toBeInTheDocument()
    // the list stays, so another Alert is one click away
    expect(screen.getAllByTestId('alert-card')).toHaveLength(1)
  })

  it('offers a copy on a Finished Alert, linking to the prefilled form', async () => {
    alerts = [alert({ status: 'completed' })]
    const { i18n, router } = renderAt('/alerts')

    const first = await card()
    // in plain sight, not behind the menu; and no pause on a Finished Alert
    expect(first.queryByRole('button', { name: i18n.t('alerts.actions.pause') })).toBeNull()
    fireEvent.click(first.getByRole('button', { name: i18n.t('alerts.actions.clone') }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/alerts/new'))
    expect(router.state.location.search).toEqual({ from: FIRST })
  })
})

describe('History of one Alert', () => {
  it('asks the server for that Alert’s Triggers and says the feed is narrowed', async () => {
    triggers = [trigger(1)]
    const { i18n } = renderAt(`/history?alert=${FIRST}`)

    expect(await screen.findByText(i18n.t('history.oneAlert'))).toBeInTheDocument()
    expect(requests).toContain(`GET /api/v1/triggers?limit=50&alert_id=${FIRST}`)
    expect(screen.getByRole('link', { name: i18n.t('history.showAll') })).toHaveAttribute(
      'href',
      '/history',
    )
  })
})
