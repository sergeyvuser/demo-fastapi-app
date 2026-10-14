import { describe, expect, it } from 'vitest'

import { dayChange } from './change'

describe('dayChange', () => {
  it('holds its colour while the price moves within the day', () => {
    // A day that opened at 100 and has been above it since: the Ticks go up
    // and down between themselves, and a last-Tick colouring would flip on
    // every second one. Against the reference, all of them are "up".
    const reference = '100'
    const ticks = ['101', '100.5', '102', '101.2', '100.01', '103']

    const directions = ticks.map((price) => dayChange(price, reference)?.direction)

    expect(directions).toEqual(['up', 'up', 'up', 'up', 'up', 'up'])
  })

  it('changes colour only when the price crosses the reference', () => {
    const directions = ['100.2', '99.9', '99.5', '100', '100.4'].map(
      (price) => dayChange(price, '100')?.direction,
    )

    expect(directions).toEqual(['up', 'down', 'down', 'flat', 'up'])
  })

  it('measures the change against the reference, not the previous Tick', () => {
    expect(dayChange('101', '100')?.ratio).toBeCloseTo(0.01)
    expect(dayChange('99', '100')?.ratio).toBeCloseTo(-0.01)
  })

  it('has nothing to say without both prices', () => {
    expect(dayChange(null, '100')).toBeNull()
    expect(dayChange('100', null)).toBeNull()
    expect(dayChange('100', '0')).toBeNull()
  })
})
