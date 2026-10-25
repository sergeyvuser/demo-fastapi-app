import { describe, expect, it } from 'vitest'

import { distanceColor, distanceTo } from './distance'

describe('the distance axis', () => {
  it('puts a price at the Threshold in the middle', () => {
    const distance = distanceTo('price_above', '70000', '70000')

    expect(distance).toMatchObject({ move: 0, position: 0.5, clamped: null })
  })

  it('places the dot by the gap as a share of the Threshold', () => {
    // 2 % under 50,000: a quarter of the way along, the window being ±4 %
    const distance = distanceTo('price_above', '50000', '49000')!

    expect(distance.position).toBeCloseTo(0.25)
    expect(distance.clamped).toBeNull()
  })

  it('measures the move to go as a share of the price now', () => {
    // 49,000 has to rise by 1,000, which is 2.04 % of 49,000
    expect(distanceTo('price_above', '50000', '49000')!.move).toBeCloseTo(0.0204, 4)
  })

  it('reaches the ends exactly at the edge of the window without clamping', () => {
    expect(distanceTo('price_above', '100', '104')).toMatchObject({ position: 1, clamped: null })
    expect(distanceTo('price_above', '100', '96')).toMatchObject({ position: 0, clamped: null })
  })

  it('clamps a price past the right end', () => {
    const distance = distanceTo('price_below', '100', '104.5')!

    expect(distance.position).toBe(1)
    expect(distance.clamped).toBe('high')
  })

  it('clamps a price past the left end', () => {
    const distance = distanceTo('price_above', '100', '95.9')!

    expect(distance.position).toBe(0)
    expect(distance.clamped).toBe('low')
  })

  it('keeps the true distance of a price far under the window', () => {
    // the dot is pinned, the number is not: the price has to double
    const distance = distanceTo('price_above', '100000', '50000')!

    expect(distance.move).toBeCloseTo(1)
    expect(distance.position).toBe(0)
    expect(distance.clamped).toBe('low')
  })

  it('keeps the true distance of a price far over the window, as a fall a price can make', () => {
    // twice the Threshold has to halve: 50 %, never "100 % to go"
    const distance = distanceTo('price_below', '50000', '100000')!

    expect(distance.move).toBeCloseTo(-0.5)
    expect(distance.position).toBe(1)
    expect(distance.clamped).toBe('high')
  })

  it('has no distance without a price', () => {
    expect(distanceTo('price_above', '70000', null)).toBeNull()
  })

  it('has no distance for a value it cannot read', () => {
    expect(distanceTo('price_above', '0', '1')).toBeNull()
    expect(distanceTo('price_above', '70000', 'NaN')).toBeNull()
  })
})

describe('the colour of the distance', () => {
  it('is green for an `above` Alert that is satisfied', () => {
    // the price is over the Threshold — the side an `above` rule waits for
    const distance = distanceTo('price_above', '70000', '71000')

    expect(distance?.holds).toBe(true)
    expect(distanceColor(distance, false)).toBe('green')
  })

  it('is green for a `below` Alert that is satisfied', () => {
    // the price is *under* the Threshold, and that is the satisfied case:
    // colouring by side would make this one red
    const distance = distanceTo('price_below', '70000', '69000')

    expect(distance?.holds).toBe(true)
    expect(distanceColor(distance, false)).toBe('green')
  })

  it('is red for either Condition while it does not hold', () => {
    expect(distanceColor(distanceTo('price_above', '70000', '69000'), false)).toBe('red')
    expect(distanceColor(distanceTo('price_below', '70000', '71000'), false)).toBe('red')
  })

  it('counts a price exactly at the Threshold as satisfied, like the server', () => {
    expect(distanceTo('price_above', '70000', '70000')?.holds).toBe(true)
    expect(distanceTo('price_below', '70000', '70000')?.holds).toBe(true)
  })

  it('is grey with no price, and grey while the socket is down', () => {
    expect(distanceColor(null, false)).toBe('gray')
    expect(distanceColor(distanceTo('price_above', '70000', '71000'), true)).toBe('gray')
  })
})
