import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyTick,
  getQuote,
  getSymbols,
  markPricesUnavailable,
  resetPrices,
  seedPrices,
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
