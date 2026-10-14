import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetPrices, seedPrices, subscribeToPrices } from './store'

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

  it('drops a Symbol that left the Subscription', () => {
    seedPrices([btc, eth])
    const listener = vi.fn()
    const unsubscribe = subscribeToPrices(listener)

    seedPrices([btc])

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
