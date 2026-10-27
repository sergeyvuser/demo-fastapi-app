import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/problem'
import {
  clonedExpiry,
  cooldownChoices,
  deadlineOf,
  EMPTY_FORM,
  staysSilent,
  submitOutcome,
  thresholdScale,
  thresholdText,
  toCreateBody,
  toUpdateBody,
  valuesFrom,
  withPolicy,
  type AlertFormValues,
} from './form'
import type { Alert } from './list'

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '70000.50000000',
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    status: 'active',
    last_triggered_at: null,
    finished_at: null,
    expires_at: null,
    trigger_count: 0,
    created_at: '2026-10-20T10:00:00Z',
    ...overrides,
  }
}

function values(overrides: Partial<AlertFormValues> = {}): AlertFormValues {
  return { ...EMPTY_FORM, symbol: 'BTCUSDT', threshold: 70000, ...overrides }
}

describe('values from an Alert', () => {
  it('drops the trailing zeros of the column, keeping the typed digits', () => {
    expect(valuesFrom(alert(), 'create').threshold).toBe('70000.5')
    expect(valuesFrom(alert({ threshold: '70000.00000000' }), 'create').threshold).toBe('70000')
  })

  it('reads a null Cooldown as the choice "none"', () => {
    const cloned = valuesFrom(
      alert({ repeat_policy: 'on_cross', cooldown_seconds: null }),
      'create',
    )
    expect(cloned.cooldown).toBe('none')
  })

  it('keeps the deadline of an edited Alert unless another is picked', () => {
    expect(valuesFrom(alert({ expires_at: '2026-10-27T10:00:00Z' }), 'edit').expiry).toBe('keep')
    expect(valuesFrom(alert(), 'edit').expiry).toBe('none')
  })

  it('gives a clone the preset its original was created with', () => {
    expect(clonedExpiry(alert({ expires_at: '2026-10-27T10:00:01Z' }))).toBe('604800')
    // an Expiry set by a later edit counts from the edit and matches nothing
    expect(clonedExpiry(alert({ expires_at: '2026-10-23T17:00:00Z' }))).toBe('none')
  })
})

describe('the Cooldown', () => {
  it('comes back when leaving on_cross with "none" for while_true', () => {
    const next = withPolicy(values({ repeatPolicy: 'on_cross', cooldown: 'none' }), 'while_true')
    expect(next.cooldown).toBe('3600')
  })

  it('offers the value being edited when it is not a preset', () => {
    expect(cooldownChoices('5400')).toContain(5400)
    expect(cooldownChoices('3600')).not.toContain(5400)
  })

  it('is sent as null under once, whatever the field held', () => {
    expect(toCreateBody(values({ repeatPolicy: 'once', cooldown: '900' })).cooldown_seconds).toBe(
      null,
    )
    expect(
      toCreateBody(values({ repeatPolicy: 'on_cross', cooldown: 'none' })).cooldown_seconds,
    ).toBe(null)
  })
})

describe('the Threshold', () => {
  it('leaves the browser with a decimal point and nothing else', () => {
    expect(thresholdText(70000.5)).toBe('70000.5')
    expect(thresholdText(0.00012345)).toBe('0.00012345')
    expect(thresholdText(65000)).toBe('65000')
  })

  it('is missing while it does not parse or is not above zero', () => {
    expect(thresholdText('')).toBeNull()
    expect(thresholdText(0)).toBeNull()
    expect(thresholdText('1,')).toBeNull()
  })

  it('takes the Symbol precision, or more when the rule already has more', () => {
    expect(thresholdScale(2, '')).toBe(2)
    expect(thresholdScale(1, '70000.125')).toBe(3)
    expect(thresholdScale(undefined, '')).toBe(8)
  })
})

describe('the warning before an on_cross Alert is saved', () => {
  it('appears when the Condition already holds, for either Condition', () => {
    expect(staysSilent(values({ repeatPolicy: 'on_cross' }), '71000')).toBe(true)
    expect(
      staysSilent(values({ repeatPolicy: 'on_cross', condition: 'price_below' }), '69000'),
    ).toBe(true)
  })

  it('does not appear when it does not hold, under another policy, or with no price', () => {
    expect(staysSilent(values({ repeatPolicy: 'on_cross' }), '69000')).toBe(false)
    expect(staysSilent(values({ repeatPolicy: 'while_true' }), '71000')).toBe(false)
    expect(staysSilent(values({ repeatPolicy: 'on_cross' }), null)).toBe(false)
  })
})

describe('the Expiry', () => {
  it('means a deadline counted from now, and none for "none" or "keep"', () => {
    const now = Date.parse('2026-10-27T12:00:00Z')
    expect(deadlineOf('86400', now)).toBe(Date.parse('2026-10-28T12:00:00Z'))
    expect(deadlineOf('none', now)).toBeNull()
    expect(deadlineOf('keep', now)).toBeNull()
  })

  it('is sent as a duration on create', () => {
    expect(toCreateBody(values({ expiry: '2592000' })).expires_in_seconds).toBe(2592000)
    expect(toCreateBody(values()).expires_in_seconds).toBeNull()
  })
})

describe('an edit', () => {
  it('sends only what changed', () => {
    const original = alert({ expires_at: '2026-10-27T10:00:00Z' })
    const edited = { ...valuesFrom(original, 'edit'), threshold: 71000 }
    expect(toUpdateBody(edited, original)).toEqual({ threshold: '71000' })
  })

  it('removes an Expiry with null and clears a Cooldown with null', () => {
    const original = alert({ repeat_policy: 'on_cross', expires_at: '2026-10-27T10:00:00Z' })
    const edited = { ...valuesFrom(original, 'edit'), expiry: 'none' as const, cooldown: 'none' }
    expect(toUpdateBody(edited, original)).toEqual({
      expires_in_seconds: null,
      cooldown_seconds: null,
    })
  })

  it('sends nothing for "none" on an Alert that never had an Expiry', () => {
    const original = alert()
    expect(toUpdateBody(valuesFrom(original, 'edit'), original)).toEqual({})
  })
})

describe('the outcome of a refused submit', () => {
  const refused = (status: number) => new ApiError({ status, detail: 'x', fieldErrors: [] })

  it('names a 404 on an edit as deleted while editing', () => {
    expect(submitOutcome(refused(404), 'edit')).toBe('deleted')
  })

  it('names the limit and the stale list on a create', () => {
    expect(submitOutcome(refused(409), 'create')).toBe('limit')
    expect(submitOutcome(refused(400), 'create')).toBe('staleSymbol')
  })

  it('leaves everything else to the server sentence', () => {
    expect(submitOutcome(refused(409), 'edit')).toBe('other')
    expect(submitOutcome(refused(422), 'create')).toBe('other')
    expect(submitOutcome(new TypeError('offline'), 'create')).toBe('other')
  })
})
