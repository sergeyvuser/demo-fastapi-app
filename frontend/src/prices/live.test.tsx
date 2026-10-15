import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, startSession } from '../api/session'
import { startRealtime } from '../realtime/socket'
import { setRealtimeStatus } from '../realtime/status'
import { renderWithProviders } from '../testing/render'
import { useSymbolsFeed } from './feed'
import { resetPrices } from './store'
import { TickerStrip } from './TickerStrip'

type Item = {
  symbol: string
  price: string | null
  reference_price: string | null
  precision: number
}

const BTC: Item = { symbol: 'BTCUSDT', price: '81794.5', reference_price: '80000', precision: 1 }

let items: Item[] = [BTC]
let symbolRequests = 0

// What every signed-in screen carries: the shell's feed and the strip.
function Shell() {
  useSymbolsFeed()
  return <TickerStrip />
}

const DIMMED = { color: 'var(--mantine-color-dimmed)' }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  items = [BTC]
  symbolRequests = 0
  vi.stubGlobal('fetch', (input: Request) => {
    if (new URL(input.url).pathname === '/api/v1/symbols') {
      symbolRequests += 1
      return Promise.resolve(Response.json({ items }))
    }
    return Promise.resolve(new Response(null, { status: 401 }))
  })
})

afterEach(() => {
  endSession()
  resetPrices()
  setRealtimeStatus('off')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a price the socket has stopped moving', () => {
  it('stays on screen in grey, with the reason beside it', async () => {
    setRealtimeStatus('live')
    const { i18n } = renderWithProviders(<Shell />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    const price = screen.getByText('81,794.5')
    expect(price).not.toHaveStyle(DIMMED)
    expect(screen.queryByText(i18n.t('prices.reconnecting'))).toBeNull()

    act(() => setRealtimeStatus('down'))

    // not blanked: the same number, where it was
    expect(screen.getByText('81,794.5')).toBe(price)
    // and not left looking live
    expect(price).toHaveStyle(DIMMED)
    expect(screen.getByText('+2.24%')).toHaveStyle(DIMMED)
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('prices.reconnecting'))
  })

  it('is not polled while the socket is live', async () => {
    setRealtimeStatus('live')
    renderWithProviders(<Shell />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(symbolRequests).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(symbolRequests).toBe(1)
  })
})

// The rule that makes the rest safe: the socket only makes prices faster.
describe('a signed-in screen whose socket never connects', () => {
  it('keeps showing the polled prices', async () => {
    // every attempt refused at the handshake
    const attempts = vi.fn()
    vi.stubGlobal(
      'WebSocket',
      class {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        readyState = 0
        onclose: ((event: { code: number }) => void) | null = null
        constructor() {
          attempts()
          setTimeout(() => this.onclose?.({ code: 1006 }), 10)
        }
        close() {}
      },
    )
    const stop = startRealtime()
    startSession('access-1', 900)
    const { i18n } = renderWithProviders(<Shell />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(screen.getByText('81,794.5')).toBeInTheDocument()

    items = [{ ...BTC, price: '81900.0' }]
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    items = [{ ...BTC, price: '82000.0' }]
    await act(() => vi.advanceTimersByTimeAsync(10_000))

    expect(screen.getByText('82,000.0')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('prices.reconnecting'))
    // and it never stopped trying
    expect(attempts.mock.calls.length).toBeGreaterThan(2)
    stop()
  })
})
