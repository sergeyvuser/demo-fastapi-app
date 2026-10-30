import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/problem'
import { digestInstant, linkRefusal, parseChatId } from './account'

describe('parseChatId', () => {
  it('reads a private chat id, forgiving the spaces a copy brings along', () => {
    expect(parseChatId('123456789')).toBe(123456789)
    expect(parseChatId('  123456789 ')).toBe(123456789)
  })

  it.each([
    ['empty', ''],
    ['a group (negative)', '-1001234567890'],
    ['zero', '0'],
    ['with a space inside', '123 456'],
    ['a decimal', '12.5'],
    ['an exponent', '1e9'],
    // one past the largest integer a browser holds exactly: it would be saved
    // as a different number than the one typed
    ['beyond 2^53 − 1', '9007199254740992'],
  ])('refuses %s', (_case, typed) => {
    expect(parseChatId(typed)).toBeNull()
  })

  it('accepts the ceiling itself', () => {
    expect(parseChatId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('linkRefusal', () => {
  const refused = (status: number, type?: string, retryAfter: number | null = null) =>
    new ApiError({ status, type, detail: 'English prose', fieldErrors: [] }, retryAfter)

  it('tells the three refusals apart by type, not by status or prose', () => {
    expect(linkRefusal(refused(400, 'urn:alerts:linked-chat:not-started')).kind).toBe('notStarted')
    expect(linkRefusal(refused(400, 'urn:alerts:linked-chat:blocked')).kind).toBe('blocked')
    expect(linkRefusal(refused(409, 'urn:alerts:linked-chat:taken')).kind).toBe('taken')
  })

  it('reads the rest by status', () => {
    expect(linkRefusal(refused(403)).kind).toBe('unverified')
    expect(linkRefusal(refused(429, undefined, 1800))).toEqual({
      kind: 'limited',
      retryAfter: 1800,
    })
    expect(linkRefusal(refused(503)).kind).toBe('unavailable')
    expect(linkRefusal(refused(500))).toEqual({
      kind: 'other',
      status: 500,
      detail: 'English prose',
    })
  })

  it('calls anything that is not an answer a network failure', () => {
    expect(linkRefusal(new TypeError('Failed to fetch')).kind).toBe('network')
  })
})

describe('digestInstant', () => {
  it('is today at the hour, in UTC', () => {
    const now = Date.UTC(2026, 6, 15, 21, 30)
    expect(digestInstant(8, now)).toBe(Date.UTC(2026, 6, 15, 8))
  })
})
