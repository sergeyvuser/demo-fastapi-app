import { describe, expect, it } from 'vitest'

import {
  formatAbsolute,
  formatExact,
  formatInstant,
  formatPastInstant,
  formatRelative,
} from './time'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe('formatRelative', () => {
  it('picks its own unit and declines inside Intl', () => {
    expect(formatRelative(NOW - 37 * MINUTE, NOW, 'en')).toBe('37 minutes ago')
    expect(formatRelative(NOW - 3 * HOUR, NOW, 'en')).toBe('3 hours ago')
    expect(formatRelative(NOW - 20_000, NOW, 'en')).toBe('20 seconds ago')
  })

  it('declines in Russian with no catalogue key of ours', () => {
    expect(formatRelative(NOW - MINUTE, NOW, 'ru')).toBe('1 минуту назад')
    expect(formatRelative(NOW - 2 * MINUTE, NOW, 'ru')).toBe('2 минуты назад')
    expect(formatRelative(NOW - 5 * MINUTE, NOW, 'ru')).toBe('5 минут назад')
  })

  it('says "now" rather than "in 0 seconds"', () => {
    expect(formatRelative(NOW, NOW, 'en')).toBe('now')
  })

  it('reads a future instant too — an Expiry is one', () => {
    expect(formatRelative(NOW + 2 * HOUR, NOW, 'en')).toBe('in 2 hours')
  })
})

describe('formatInstant', () => {
  it('stays relative under a day', () => {
    expect(formatInstant(NOW - 23 * HOUR, NOW, 'en')).toBe('23 hours ago')
  })

  it('turns absolute above a day', () => {
    expect(formatInstant(NOW - 25 * HOUR, NOW, 'en')).toBe(formatAbsolute(NOW - 25 * HOUR, 'en'))
  })
})

describe('formatPastInstant', () => {
  // A Trigger pushed over the socket is newer than the 30-second clock.
  it('says "now" for an event the clock has not caught up with', () => {
    expect(formatPastInstant(NOW + 20_000, NOW, 'en')).toBe('now')
  })

  it('reads an ordinary past instant as formatInstant does', () => {
    expect(formatPastInstant(NOW - 37 * MINUTE, NOW, 'en')).toBe('37 minutes ago')
  })
})

describe('the conversion into the reader’s zone', () => {
  // Under UTC this path never executes, which is why the pinned zone above
  // has a price. This is the test that pays it — and the real test of the
  // conversion anyway.
  it('moves the clock and, past midnight, the date', () => {
    const instant = Date.parse('2026-10-12T22:30:00Z')

    expect(formatAbsolute(instant, 'en', 'UTC')).toBe('Oct 12, 2026, 10:30 PM')
    expect(formatAbsolute(instant, 'en', 'Europe/Moscow')).toBe('Oct 13, 2026, 1:30 AM')
    expect(formatAbsolute(instant, 'ru', 'Europe/Moscow')).toBe('13 окт. 2026 г., 01:30')
  })

  it('names the zone in the exact form the Tooltip shows', () => {
    const instant = Date.parse('2026-10-12T22:30:00Z')

    expect(formatExact(instant, 'en', 'Europe/Moscow')).toContain('1:30:00')
    expect(formatExact(instant, 'en', 'Europe/Moscow')).not.toBe(formatExact(instant, 'en', 'UTC'))
  })
})
