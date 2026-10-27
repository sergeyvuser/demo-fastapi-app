import { Notifications } from '@mantine/notifications'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Alert } from '../alerts/list'
import { endSession, getSession, startSession } from '../api/session'
import { getNow } from '../i18n/now'
import { formatAbsolute } from '../i18n/time'
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

const ID = '00000000-0000-4000-8000-0000000000aa'

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: ID,
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

type Sent = { method: string; pathname: string; body: unknown }

let sent: Sent[] = []
let stored: Alert | null = null
let me = ME
// what a write answers; a 201 with the body by default
let answer: () => Response = () => Response.json(alert(), { status: 201 })

beforeEach(() => {
  sent = []
  stored = null
  me = ME
  answer = () => Response.json(alert(), { status: 201 })
  vi.stubGlobal('fetch', async (request: Request) => {
    const { pathname } = new URL(request.url)
    const method = request.method
    if (method !== 'GET') {
      const text = await request.text()
      sent.push({ method, pathname, body: text ? JSON.parse(text) : null })
      return answer()
    }
    if (pathname === '/api/v1/symbols') return Response.json({ items: SYMBOLS })
    if (pathname === '/api/v1/users/me') return Response.json(me)
    if (pathname === '/api/v1/alerts') {
      return Response.json({ items: [], total: 0, skip: 0, limit: 100 })
    }
    if (pathname === `/api/v1/alerts/${ID}`) {
      return stored
        ? Response.json(stored)
        : Response.json({ detail: 'Alert not found' }, { status: 404 })
    }
    // The chart's market data is down: the form must not care.
    if (pathname.endsWith('/candles')) {
      return Response.json({ detail: 'Price history is unavailable' }, { status: 503 })
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('WebSocket', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetPrices()
  endSession()
})

function renderForm(path: string) {
  startSession('access', 900)
  const router = createAppRouter(
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: [path] }),
  )
  return {
    router,
    ...renderWithProviders(
      <>
        <Notifications />
        <RouterProvider router={router} />
      </>,
    ),
  }
}

async function submit(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: label }))
}

// A clone of `stored`: the quickest way to a filled-in create form, since a
// Mantine Select is awkward to drive in jsdom and is not this test's subject.
async function cloneForm(overrides: Partial<Alert> = {}) {
  stored = alert(overrides)
  const rendered = renderForm(`/alerts/new?from=${ID}`)
  // The form, once its source has loaded — the ticker strip in the shell
  // shows prices before that — and the price beside the Threshold field.
  await screen.findByLabelText(rendered.i18n.t('alertForm.threshold.label'), { selector: 'input' })
  await screen.findAllByText('71,000.0')
  return rendered
}

describe('creating an Alert', () => {
  it('submits with the chart failing to load', async () => {
    const { i18n, router } = await cloneForm()
    expect(await screen.findByText(i18n.t('alertForm.chart.unavailable'))).toBeInTheDocument()

    await submit(i18n.t('alertForm.submit.create'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/alerts'))
    expect(sent).toEqual([
      {
        method: 'POST',
        pathname: '/api/v1/alerts',
        body: {
          symbol: 'BTCUSDT',
          condition: 'price_above',
          threshold: '70000',
          repeat_policy: 'while_true',
          cooldown_seconds: 3600,
          expires_in_seconds: null,
        },
      },
    ])
  })

  it('offers the Symbol picker only what the system streams', async () => {
    const { i18n } = renderForm('/alerts/new')
    await screen.findByText(i18n.t('alertForm.chart.pickSymbol'))
    // the list arrives with the shell's first poll, which the strip shows
    await screen.findAllByText('71,000.0')

    const picker = screen.getByLabelText(i18n.t('alertForm.symbol.label'), { selector: 'input' })
    fireEvent.click(picker)

    // The list this field opened, not the other Selects' (Mantine keeps them
    // mounted); mid-transition it is still styled hidden in jsdom.
    await waitFor(() => expect(picker).toHaveAttribute('aria-controls'))
    const listbox = document.getElementById(picker.getAttribute('aria-controls')!)!
    const options = within(listbox).getAllByRole('option', { hidden: true })
    expect(options.map((option) => option.textContent)).toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  it('lands a server field error on its field', async () => {
    answer = () =>
      Response.json(
        {
          detail: [
            {
              loc: ['body', 'threshold'],
              msg: 'Decimal input should have no more than 8 decimal places',
              type: 'decimal_max_places',
            },
          ],
        },
        { status: 422 },
      )
    const { i18n } = await cloneForm()

    await submit(i18n.t('alertForm.submit.create'))

    const message = await screen.findByText(
      'Decimal input should have no more than 8 decimal places',
    )
    // under the Threshold field, not in the alert above the form
    const field = screen.getByRole('textbox', { name: i18n.t('alertForm.threshold.label') })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field.getAttribute('aria-describedby')).toContain(message.id)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says the limit in a sentence that names it', async () => {
    answer = () => Response.json({ detail: 'Alerts limit of 20 reached.' }, { status: 409 })
    const { i18n } = await cloneForm()

    await submit(i18n.t('alertForm.submit.create'))

    // the wording is the decision, so the literal is the record
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have 20 Alerts in use, the most an account can hold.',
    )
  })

  it('explains the limit as shared on the demo account', async () => {
    me = { ...ME, is_demo: true }
    answer = () => Response.json({ detail: 'Alerts limit of 20 reached.' }, { status: 409 })
    const { i18n } = await cloneForm()

    await submit(i18n.t('alertForm.submit.create'))

    // the demo banner above is an alert too, so this one is found by its words
    expect(
      await screen.findByText(/This shared demo account already has 20 Alerts in use/),
    ).toBeInTheDocument()
  })

  it('calls a withdrawn Symbol a stale list, not an invalid Symbol', async () => {
    answer = () =>
      Response.json({ detail: 'Symbol BTCUSDT is not streamed by this system' }, { status: 400 })
    const { i18n } = await cloneForm()

    await submit(i18n.t('alertForm.submit.create'))

    expect(
      await screen.findByText(i18n.t('alertForm.errors.staleList', { symbol: 'BTCUSDT' })),
    ).toBeInTheDocument()
  })

  it('warns before saving an on_cross Alert whose Condition already holds', async () => {
    // 71,000 is above 70,000: the server would seed it as already met
    const { i18n } = await cloneForm({ repeat_policy: 'on_cross' })

    expect(await screen.findByTestId('silence-warning')).toHaveTextContent(
      'This Alert will stay silent until the price leaves and crosses the Threshold again.',
    )
    fireEvent.click(screen.getByLabelText(i18n.t('alertForm.repeat.while_true.label')))
    expect(screen.queryByTestId('silence-warning')).toBeNull()
  })

  it('hides the Cooldown under once', async () => {
    const { i18n } = await cloneForm()
    const cooldown = i18n.t('alertForm.cooldown.label')
    expect(screen.getByLabelText(cooldown, { selector: 'input' })).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(i18n.t('alertForm.repeat.once.label')))

    expect(screen.queryByLabelText(cooldown, { selector: 'input' })).toBeNull()
  })

  it('shows the deadline an Expiry preset means as a date and time', async () => {
    // created with a 7-day Expiry: the clone starts with the same preset
    const { i18n } = await cloneForm({
      created_at: '2026-10-01T00:00:00Z',
      expires_at: '2026-10-08T00:00:00Z',
    })
    // counted from the application's one clock, as the screen counts it; the
    // zone conversion itself is pinned in time.test.ts
    const when = formatAbsolute(getNow() + 7 * 86_400_000, 'en')
    expect(screen.getByText(i18n.t('alertForm.expiry.until', { when }))).toBeInTheDocument()
  })
})

describe('editing an Alert', () => {
  it('keeps Symbol, Condition and Repeat policy fixed and sends what changed', async () => {
    stored = alert({ expires_at: '2026-11-01T00:00:00Z' })
    const { i18n, router } = renderForm(`/alerts/${ID}/edit`)
    const symbol = await screen.findByLabelText(i18n.t('alertForm.symbol.label'), {
      selector: 'input',
    })
    expect(symbol).toBeDisabled()
    expect(screen.getByLabelText(i18n.t('alertForm.repeat.once.label'))).toBeDisabled()

    const threshold = screen.getByRole('textbox', { name: i18n.t('alertForm.threshold.label') })
    fireEvent.change(threshold, { target: { value: '72000' } })
    await submit(i18n.t('alertForm.submit.edit'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/alerts'))
    expect(sent).toEqual([
      { method: 'PATCH', pathname: `/api/v1/alerts/${ID}`, body: { threshold: '72000' } },
    ])
  })

  it('names a 404 on submit, returns to the list and resubmits nowhere', async () => {
    stored = alert()
    answer = () => Response.json({ detail: 'Alert not found' }, { status: 404 })
    const { i18n, router } = renderForm(`/alerts/${ID}/edit`)
    const threshold = await screen.findByRole('textbox', {
      name: i18n.t('alertForm.threshold.label'),
    })
    fireEvent.change(threshold, { target: { value: '72000' } })

    await submit(i18n.t('alertForm.submit.edit'))

    expect(
      await screen.findByText('This Alert was deleted while you were editing it.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/alerts'))
    expect(sent.map(({ method }) => method)).toEqual(['PATCH'])
  })

  it('renders the ordinary not-found state for an Alert that does not exist', async () => {
    const { i18n } = renderForm(`/alerts/${ID}/edit`)
    expect(await screen.findByText(i18n.t('notFound.title'))).toBeInTheDocument()
  })

  it('offers a clone instead of an edit for a Finished Alert', async () => {
    stored = alert({ status: 'completed', finished_at: '2026-10-21T00:00:00Z' })
    const { i18n } = renderForm(`/alerts/${ID}/edit`)

    const clone = await screen.findByRole('link', { name: i18n.t('alertForm.finished.clone') })
    expect(clone).toHaveAttribute('href', `/alerts/new?from=${ID}`)
  })
})
