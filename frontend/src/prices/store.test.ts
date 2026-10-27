import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyTick,
  getQuote,
  getSampledPrice,
  getSymbols,
  markPricesUnavailable,
  resetPrices,
  seedPrices,
  subscribeAtMost,
  subscribeToChartPrices,
  subscribeToPrices,
} from './store'

const btc = { symbol: 'BTCUSDT', price: '81794.5', reference_price: '83503.6', precision: 1 }
const eth = { symbol: 'ETHUSDT', price: '2427.91', reference_price: '2514.57', precision: 2 }

afterEach(() => resetPrices())

// The hooks are thin `useSyncExternalStore` wrappers; what is worth pinning is
// when the store tells its readers anything at all.
describe('the price store', () => {
  it('tells nobody when a poll brought the same numbers', () => {
    seedPrices([btc, eth])
    const listener = vi.fn()
    const unsubscribe = subscribeToPrices(listener)

    seedPrices([{ ...btc }, { ...eth }])

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('tells its readers when a price moved', () => {
    seedPrices([btc, eth])
    const listener = vi.fn()
    const unsubscribe = subscribeToPrices(listener)

    seedPrices([{ ...btc, price: '81800.0' }, eth])

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('takes a Tick into one quote, keeping the list and the precision', () => {
    seedPrices([btc, eth])
    const symbols = getSymbols()
    const untouched = getQuote('ETHUSDT')

    applyTick('BTCUSDT', '81800.0', '83503.6')

    expect(getQuote('BTCUSDT')).toEqual({
      price: '81800.0',
      referencePrice: '83503.6',
      precision: 1,
    })
    // the socket tells a Tick from a new Subscription by this identity
    expect(getSymbols()).toBe(symbols)
    expect(getQuote('ETHUSDT')).toBe(untouched)
  })

  it('drops a Tick for a Symbol the list has not named', () => {
    seedPrices([btc])
    const listener = vi.fn()
    const unsubscribe = subscribeToPrices(listener)

    applyTick('ETHUSDT', '2430.00', null)

    expect(getQuote('ETHUSDT')).toBeUndefined()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('calls the prices unavailable only while no list has ever arrived', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToPrices(listener)

    markPricesUnavailable()
    expect(listener).toHaveBeenCalledOnce()
    seedPrices([btc])
    expect(listener).toHaveBeenCalledTimes(2)

    // a failure after a list: nothing to tell, the last prices stand
    markPricesUnavailable()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('drops a Symbol that left the Subscription', () => {
    seedPrices([btc, eth])
    const listener = vi.fn()
    const unsubscribe = subscribeToPrices(listener)

    seedPrices([btc])

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })
})

// The prototype's measured requirement: the chart froze the tab at socket
// speed. Numbers keep the full rate, the chart hears at most one change a second.
describe('a chart reading the store', () => {
  afterEach(() => vi.useRealTimers())

  it('redraws at 1 Hz while the numbers update at full rate', () => {
    vi.useFakeTimers()
    seedPrices([btc])
    const numbers = vi.fn()
    const chart = vi.fn()
    const stopNumbers = subscribeToPrices(numbers)
    const stopChart = subscribeAtMost(1000)(chart)

    // the socket's sampler: four Ticks a second, for three seconds
    for (let tick = 0; tick < 12; tick += 1) {
      applyTick('BTCUSDT', String(81000 + tick), null)
      vi.advanceTimersByTime(250)
    }

    expect(numbers).toHaveBeenCalledTimes(12)
    // at 0 s, then at 1, 2 and 3 s: each second's Ticks folded into one call
    // at its end, so the chart ends on the latest price, not a second behind
    expect(chart).toHaveBeenCalledTimes(4)
    // and nothing more once the Ticks stop
    vi.advanceTimersByTime(5000)
    expect(chart).toHaveBeenCalledTimes(4)

    stopNumbers()
    stopChart()
  })

  it('stops hearing, timers included, once unsubscribed', () => {
    vi.useFakeTimers()
    seedPrices([btc])
    const chart = vi.fn()
    const stop = subscribeAtMost(1000)(chart)

    applyTick('BTCUSDT', '81000', null)
    applyTick('BTCUSDT', '81001', null)
    stop()
    vi.advanceTimersByTime(2000)

    expect(chart).toHaveBeenCalledTimes(1)
  })

  // The notification alone is not the requirement: a chart re-rendered for any
  // other reason must still draw the sampled price, not the live one.
  it('holds the price a chart reads until the next sample', () => {
    vi.useFakeTimers()
    seedPrices([btc])
    const stop = subscribeToChartPrices(() => {})

    applyTick('BTCUSDT', '81000.0', null)
    expect(getSampledPrice('BTCUSDT')).toBe('81000.0')
    applyTick('BTCUSDT', '81001.0', null)
    applyTick('BTCUSDT', '81002.0', null)
    // the numbers already moved; what a chart reads did not
    expect(getQuote('BTCUSDT')?.price).toBe('81002.0')
    expect(getSampledPrice('BTCUSDT')).toBe('81000.0')

    vi.advanceTimersByTime(1000)
    expect(getSampledPrice('BTCUSDT')).toBe('81002.0')
    stop()
  })
})
