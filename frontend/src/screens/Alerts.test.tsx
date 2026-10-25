import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Alert } from '../alerts/list'
import { endSession, getSession, startSession } from '../api/session'
import { resetPrices } from '../prices/store'
import { createAppRouter } from '../router'
import { renderWithProviders } from '../testing/render'

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

let sequence = 0

function alert(overrides: Partial<Alert> = {}): Alert {
  sequence += 1
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
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

let alerts: Alert[] = []

beforeEach(() => {
  alerts = []
  vi.stubGlobal('fetch', (request: Request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/v1/symbols') return Promise.resolve(Response.json({ items: SYMBOLS }))
    if (pathname === '/api/v1/users/me') return Promise.resolve(Response.json(ME))
    if (pathname === '/api/v1/alerts') {
      return Promise.resolve(
        Response.json({ items: alerts, total: alerts.length, skip: 0, limit: 100 }),
      )
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  // a socket is not this screen's subject; the shell opens none in tests
  vi.stubGlobal('WebSocket', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetPrices()
  endSession()
})

function renderAlerts(path = '/alerts') {
  startSession('access', 900)
  const router = createAppRouter(
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: [path] }),
  )
  return { router, ...renderWithProviders(<RouterProvider router={router} />) }
}

async function cards(): Promise<HTMLElement[]> {
  return screen.findAllByTestId('alert-card')
}

describe('the Alerts list', () => {
  it('renders a card with the rule, the live price and the distance', async () => {
    alerts = [alert({ trigger_count: 3, last_triggered_at: '2026-10-20T09:00:00Z' })]
    const { i18n } = renderAlerts()

    const card = within((await cards())[0])
    expect(card.getByText('BTCUSDT')).toBeInTheDocument()
    // the Threshold at the Symbol's precision, not at the column's eight
    expect(card.getByText(i18n.t('alerts.rule.price_above', { threshold: '70,000.0' })))
    expect(await card.findByText('71,000.0')).toBeInTheDocument()
    // 71,000 against 70,000: satisfied, 1,000 past — 1.41 % of the price now
    expect(card.getByText(i18n.t('alerts.distance.past', { distance: '1.41%' })))
    expect(card.getByText(i18n.t('alerts.card.triggerCount', { count: 3 })))
  })

  it('shows a state badge only when the state is not Active', async () => {
    alerts = [alert({ status: 'active' }), alert({ status: 'paused', symbol: 'ETHUSDT' })]
    const { i18n } = renderAlerts()

    const [first, second] = await cards()
    // both share the newest-first order's tie: the paused one was listed second
    const active = [first, second].find((card) => within(card).queryByText('BTCUSDT'))!
    const paused = [first, second].find((card) => within(card).queryByText('ETHUSDT'))!
    expect(within(paused).getByText(i18n.t('alerts.status.paused'))).toBeInTheDocument()
    for (const status of ['paused', 'completed', 'expired'] as const) {
      expect(within(active).queryByText(i18n.t(`alerts.status.${status}`))).toBeNull()
    }
  })

  it('renders the Status the backend sent, without recomputing it', async () => {
    // an Expiry long past, and the server still says Active: the card believes
    // the server, whose clock decides
    alerts = [alert({ status: 'active', expires_at: '2020-01-01T00:00:00Z' })]
    const { i18n } = renderAlerts()

    const card = within((await cards())[0])
    expect(card.queryByText(i18n.t('alerts.status.expired'))).toBeNull()
  })

  it('badges an Alert on a Symbol that left the Subscription, and nothing else', async () => {
    alerts = [alert({ symbol: 'DOGEUSDT' }), alert({ symbol: 'BTCUSDT' })]
    const { i18n } = renderAlerts()

    const badge = await screen.findByText(i18n.t('alerts.withdrawn.badge'))
    const withdrawn = within(badge.closest<HTMLElement>('[data-testid="alert-card"]')!)
    expect(withdrawn.getByText('DOGEUSDT')).toBeInTheDocument()
    // no price for it, and said so; its Status is untouched
    expect(withdrawn.getByText(i18n.t('prices.noFreshPrice'))).toBeInTheDocument()
    expect(withdrawn.queryByText(i18n.t('alerts.status.expired'))).toBeNull()
    expect(screen.getAllByText(i18n.t('alerts.withdrawn.badge'))).toHaveLength(1)
  })

  it('says a null Cooldown is none, and says nothing of it under `once`', async () => {
    alerts = [
      alert({ repeat_policy: 'on_cross', cooldown_seconds: null }),
      alert({ repeat_policy: 'once', cooldown_seconds: null, symbol: 'ETHUSDT' }),
    ]
    const { i18n } = renderAlerts()

    await cards()
    expect(screen.getAllByText(i18n.t('alerts.cooldown.none'))).toHaveLength(1)
  })
})

describe('the state control', () => {
  beforeEach(() => {
    alerts = [
      alert({ status: 'active' }),
      alert({ status: 'paused', symbol: 'ETHUSDT' }),
      alert({ status: 'completed' }),
      alert({ status: 'expired', symbol: 'ETHUSDT' }),
    ]
  })

  it('counts each state and keeps Finished Alerts in the list', async () => {
    const { i18n } = renderAlerts()

    expect(await cards()).toHaveLength(4)
    const control = screen.getByRole('radiogroup', { name: i18n.t('alerts.filter.label') })
    for (const [state, count] of [
      ['all', 4],
      ['active', 1],
      ['paused', 1],
      ['finished', 2],
    ] as const) {
      expect(
        within(control).getByLabelText(`${i18n.t(`alerts.filter.${state}`)} ${count}`),
      ).toBeInTheDocument()
    }
  })

  it('filters one list, and writes the choice into the URL', async () => {
    const { i18n, router } = renderAlerts()
    await cards()

    fireEvent.click(screen.getByLabelText(`${i18n.t('alerts.filter.finished')} 2`))

    await waitFor(() => expect(screen.getAllByTestId('alert-card')).toHaveLength(2))
    expect(router.state.location.search).toEqual({ state: 'finished' })
  })

  it('opens with the filters a link carries', async () => {
    const { i18n } = renderAlerts('/alerts?state=paused&symbols=ETHUSDT&group=symbol')

    expect(await cards()).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'ETHUSDT · 1' })).toBeInTheDocument()
    // the counts follow the Symbol filter
    expect(screen.getByLabelText(`${i18n.t('alerts.filter.all')} 2`)).toBeInTheDocument()
  })

  it('groups by Condition under headings in words, with counts', async () => {
    alerts = [alert(), alert({ condition: 'price_below' }), alert({ condition: 'price_below' })]
    const { i18n } = renderAlerts('/alerts?group=condition')

    await cards()
    expect(
      screen.getByRole('heading', { name: `${i18n.t('alerts.conditionGroup.price_above')} · 1` }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: `${i18n.t('alerts.conditionGroup.price_below')} · 2` }),
    ).toBeInTheDocument()
  })
})

describe('the slot counter', () => {
  it('is silent at fourteen', async () => {
    alerts = Array.from({ length: 14 }, () => alert())
    renderAlerts()

    await cards()
    expect(screen.queryByText(/of 20 Alerts used/)).toBeNull()
  })

  it('appears at fifteen and says Finished Alerts do not count', async () => {
    // fifteen occupying, and five Finished that do not
    alerts = [
      ...Array.from({ length: 15 }, () => alert()),
      ...Array.from({ length: 5 }, () => alert({ status: 'completed' })),
    ]
    renderAlerts()

    await cards()
    // the wording is the decision: a literal, not the catalogue
    expect(
      screen.getByText('15 of 20 Alerts used. Finished Alerts do not count.'),
    ).toBeInTheDocument()
  })
})

describe('an empty list', () => {
  it('defines an Alert and offers one way to make one, and no starters', async () => {
    const { i18n } = renderAlerts()

    expect(
      await screen.findByRole('heading', { name: i18n.t('alerts.empty.title') }),
    ).toBeInTheDocument()
    expect(screen.getByText(i18n.t('alerts.empty.body'))).toBeInTheDocument()

    const main = within(screen.getByRole('main'))
    const action = main.getByRole('link', { name: i18n.t('alerts.empty.action') })
    expect(action).toHaveAttribute('href', '/alerts/new')
    // the only way to a new Alert on the screen: no toolbar, no cards
    expect(main.queryByRole('link', { name: i18n.t('alerts.newAlert') })).toBeNull()
    expect(main.queryByRole('radiogroup', { name: i18n.t('alerts.filter.label') })).toBeNull()
    expect(screen.queryAllByTestId('alert-card')).toHaveLength(0)
  })
})

describe('New Alert', () => {
  it('is a button on the screen and never an item of the navigation', async () => {
    alerts = [alert()]
    const { i18n } = renderAlerts()
    await cards()

    const main = within(screen.getByRole('main'))
    expect(main.getByRole('link', { name: i18n.t('alerts.newAlert') })).toHaveAttribute(
      'href',
      '/alerts/new',
    )
    const navigation = within(screen.getByRole('navigation', { name: i18n.t('shell.navigation') }))
    expect(navigation.queryByRole('link', { name: i18n.t('alerts.newAlert') })).toBeNull()
  })
})
