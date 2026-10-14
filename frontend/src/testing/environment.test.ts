import { describe, expect, it } from 'vitest'

describe('the test environment', () => {
  // Time is rendered in the reader's own zone, so every assertion about a
  // rendered instant depends on this. It is pinned in a global setup rather
  // than in `test.env`, which cannot reach a worker — if that ever silently
  // stops working, this is the test that says so.
  it('runs in UTC', () => {
    expect(new Date().getTimezoneOffset()).toBe(0)
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')
  })
})
