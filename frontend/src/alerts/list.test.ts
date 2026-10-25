import { describe, expect, it } from 'vitest'

import {
  countByState,
  filterByState,
  groupAlerts,
  isWithdrawn,
  narrowAlerts,
  slotsUsed,
  sortAlerts,
  validateAlertsSearch,
  type Alert,
} from './list'

let sequence = 0

function alert(overrides: Partial<Alert> = {}): Alert {
  sequence += 1
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '70000',
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    status: 'active',
    last_triggered_at: null,
    finished_at: null,
    expires_at: null,
    trigger_count: 0,
    created_at: `2026-10-${String(sequence % 28 || 1).padStart(2, '0')}T10:00:00Z`,
    ...overrides,
  }
}

const LIST = [
  alert({ status: 'active' }),
  alert({ status: 'paused', symbol: 'ETHUSDT' }),
  alert({ status: 'completed', symbol: 'ETHUSDT', condition: 'price_below' }),
  alert({ status: 'expired', condition: 'price_below' }),
]

describe('the state filter', () => {
  it('puts Completed and Expired together under Finished', () => {
    expect(filterByState(LIST, 'finished').map((a) => a.status)).toEqual(['completed', 'expired'])
  })

  it('counts each position, All being the whole list', () => {
    expect(countByState(LIST)).toEqual({ all: 4, active: 1, paused: 1, finished: 2 })
  })

  it('counts after the Symbol filter, so a number is what clicking it shows', () => {
    expect(countByState(narrowAlerts(LIST, ['ETHUSDT']))).toEqual({
      all: 2,
      active: 0,
      paused: 1,
      finished: 1,
    })
  })
})

describe('the slot count', () => {
  it('counts Active and Paused, and not Finished', () => {
    expect(slotsUsed(LIST)).toBe(2)
  })
})

describe('grouping', () => {
  it('keeps one unnamed group when there is none', () => {
    expect(groupAlerts(LIST, 'none')).toEqual([{ key: null, alerts: LIST }])
  })

  it('groups by Symbol alphabetically', () => {
    const groups = groupAlerts(LIST, 'symbol')

    expect(groups.map((g) => [g.key, g.alerts.length])).toEqual([
      ['BTCUSDT', 2],
      ['ETHUSDT', 2],
    ])
  })

  it('groups by Condition, above before below whatever the letters say', () => {
    const below = alert({ condition: 'price_below' })
    const above = alert({ condition: 'price_above' })

    expect(groupAlerts([below, above], 'condition').map((g) => g.key)).toEqual([
      'price_above',
      'price_below',
    ])
  })
})

describe('the order of the list', () => {
  it('is newest first', () => {
    const older = alert({ created_at: '2026-10-01T00:00:00Z' })
    const newer = alert({ created_at: '2026-10-20T00:00:00Z' })

    expect(sortAlerts([older, newer])).toEqual([newer, older])
  })
})

describe('a withdrawn Symbol', () => {
  it('is one the Subscription no longer carries', () => {
    expect(isWithdrawn('DOGEUSDT', ['BTCUSDT', 'ETHUSDT'])).toBe(true)
    expect(isWithdrawn('BTCUSDT', ['BTCUSDT', 'ETHUSDT'])).toBe(false)
  })

  it('is never claimed while the Subscription is still unknown', () => {
    expect(isWithdrawn('DOGEUSDT', null)).toBe(false)
  })
})

describe('the search parameters', () => {
  it('leaves the defaults out', () => {
    expect(validateAlertsSearch({})).toEqual({
      state: undefined,
      symbols: undefined,
      group: undefined,
    })
    expect(validateAlertsSearch({ state: 'all', group: 'none' })).toEqual({
      state: undefined,
      symbols: undefined,
      group: undefined,
    })
  })

  it('keeps what it knows', () => {
    expect(
      validateAlertsSearch({ state: 'paused', symbols: 'BTCUSDT,ETHUSDT', group: 'symbol' }),
    ).toEqual({ state: 'paused', symbols: 'BTCUSDT,ETHUSDT', group: 'symbol' })
  })

  it('drops what it does not, rather than refusing the page', () => {
    expect(
      validateAlertsSearch({ state: 'deleted', symbols: 'BTCUSDT,<script>,BTCUSDT', group: 42 }),
    ).toEqual({ state: undefined, symbols: 'BTCUSDT', group: undefined })
  })
})
