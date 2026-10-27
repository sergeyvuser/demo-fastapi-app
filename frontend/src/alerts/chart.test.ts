import { describe, expect, it } from 'vitest'

import { hourTicks, niceStep, priceAxis } from './chart'

describe('a round step', () => {
  it('is 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceStep(1000)).toBe(200)
    expect(niceStep(1200)).toBe(250)
    expect(niceStep(0.03)).toBeCloseTo(0.01)
    expect(niceStep(40)).toBe(10)
  })
})

describe('the price axis', () => {
  it('reaches the Threshold and the live price, not only the closes', () => {
    const axis = priceAxis([70000, 70400], 72000, 70300)
    expect(axis.domain[0]).toBeLessThanOrEqual(70000)
    expect(axis.domain[1]).toBeGreaterThanOrEqual(72000)
  })

  it('arrives sorted, because Recharts drops ticks that do not', () => {
    const { ticks } = priceAxis([70000, 71000], 70550, 70990)
    const values = ticks.map((tick) => tick.value)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('carries the two named values among the round ones', () => {
    const { ticks } = priceAxis([70000, 71000], 70550, 70990)
    expect(ticks).toContainEqual({ value: 70550, kind: 'threshold' })
    expect(ticks).toContainEqual({ value: 70990, kind: 'live' })
    expect(ticks.filter((tick) => tick.kind === 'round').length).toBeGreaterThan(1)
  })

  it('drops a round tick that would collide with a named one', () => {
    // 70,000 to 71,000 by 200: 71,000 is 10 away from the live price
    const { ticks } = priceAxis([70000, 71000], 70550, 70990)
    expect(ticks.find((tick) => tick.value === 71000)).toBeUndefined()
    expect(ticks.find((tick) => tick.value === 70600)).toBeUndefined()
    expect(ticks).toContainEqual({ value: 70200, kind: 'round' })
  })

  it('drops the live label next to the Threshold, which keeps its own', () => {
    const { ticks } = priceAxis([70000, 71000], 70500, 70510)
    expect(ticks.find((tick) => tick.kind === 'live')).toBeUndefined()
    expect(ticks).toContainEqual({ value: 70500, kind: 'threshold' })
  })

  it('writes round values without floating-point noise', () => {
    const { ticks } = priceAxis([0.1, 0.4], null, null)
    for (const tick of ticks) expect(String(tick.value).length).toBeLessThan(6)
  })

  it('survives a flat series', () => {
    const axis = priceAxis([100, 100], null, null)
    expect(axis.domain[0]).toBeLessThan(100)
    expect(axis.domain[1]).toBeGreaterThan(100)
  })
})

describe('the hour axis', () => {
  const from = Date.parse('2026-10-26T12:15:00Z')
  const to = Date.parse('2026-10-27T12:00:00Z')

  it('labels whole hours every four hours across a day', () => {
    const ticks = hourTicks(from, to, 'UTC').map((time) => new Date(time).toISOString())
    expect(ticks).toEqual([
      '2026-10-26T16:00:00.000Z',
      '2026-10-26T20:00:00.000Z',
      '2026-10-27T00:00:00.000Z',
      '2026-10-27T04:00:00.000Z',
      '2026-10-27T08:00:00.000Z',
      '2026-10-27T12:00:00.000Z',
    ])
  })

  // The one test that runs the zone conversion: under the suite's pinned UTC
  // it never executes otherwise.
  it('counts hours on the reader’s clock, half-hour zones included', () => {
    const ticks = hourTicks(from, to, 'Asia/Kolkata')
    expect(ticks).toHaveLength(6)
    // 16:00 in Kolkata is 10:30 UTC — a whole local hour, not a whole UTC one
    expect(ticks.map((time) => new Date(time).toISOString().slice(11, 16))).toContain('10:30')
  })
})
