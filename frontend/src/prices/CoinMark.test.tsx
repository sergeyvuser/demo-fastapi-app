import { act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders } from '../testing/render'
import { allHaveIcons, baseAsset, coinIcon, CoinMark } from './CoinMark'
import { resetPrices, seedPrices } from './store'

function quote(symbol: string) {
  return { symbol, price: '1', reference_price: '1', precision: 2 }
}

afterEach(() => resetPrices())

describe('coin marks', () => {
  it('names a picture by the base asset', () => {
    expect(baseAsset('BTCUSDT')).toBe('BTC')
    expect(baseAsset('LINKUSDC')).toBe('LINK')
    expect(coinIcon('ETHUSDT')).toBeDefined()
    expect(coinIcon('PEPEUSDT')).toBeUndefined()
  })

  it('has a picture for every Symbol the prototype streamed', () => {
    const subscription = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'].map(
      (asset) => `${asset}USDT`,
    )
    expect(allHaveIcons(subscription)).toBe(true)
  })

  it('draws logos when every Symbol has one', () => {
    act(() => seedPrices([quote('BTCUSDT'), quote('ETHUSDT')]))
    const { container } = renderWithProviders(<CoinMark symbol="BTCUSDT" size={24} />)

    expect(container.querySelector('img')).not.toBeNull()
  })

  it('falls back to letters for everyone when one Symbol has no logo', () => {
    act(() => seedPrices([quote('BTCUSDT'), quote('PEPEUSDT')]))
    const { container } = renderWithProviders(<CoinMark symbol="BTCUSDT" size={24} />)

    // BTC has a file; it is the neighbour without one that decides
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('B')
  })
})
