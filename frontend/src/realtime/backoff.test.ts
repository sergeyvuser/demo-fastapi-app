import { describe, expect, it } from 'vitest'

import { reconnectDelay } from './backoff'

// The top of the range: Math.random never returns 1 itself.
const almostOne = () => 0.999_999

describe('the reconnect delay', () => {
  it('doubles its ceiling from one second', () => {
    expect([0, 1, 2, 3, 4].map((attempt) => reconnectDelay(attempt, almostOne))).toEqual([
      999, 1999, 3999, 7999, 15_999,
    ])
  })

  it('stops growing at thirty seconds, however long the outage', () => {
    expect(reconnectDelay(5, almostOne)).toBe(29_999)
    expect(reconnectDelay(1_000, almostOne)).toBe(29_999)
  })

  // Full jitter: anywhere from nothing to the ceiling, so tabs dropped by
  // the same deploy spread out instead of returning on the same second.
  it('may be anything below the ceiling, down to no wait at all', () => {
    expect(reconnectDelay(3, () => 0)).toBe(0)
    expect(reconnectDelay(3, () => 0.5)).toBe(4_000)
  })
})
