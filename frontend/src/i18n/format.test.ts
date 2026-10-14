import { describe, expect, it } from 'vitest'

import { formatPrice, separatorsFor, toDecimalPoint } from './format'

describe('formatPrice', () => {
  it('renders as many decimals as the Symbol quotes', () => {
    expect(formatPrice('70000.1', 2, 'en')).toBe('70,000.10')
    expect(formatPrice('0.0000123', 8, 'en')).toBe('0.00001230')
  })

  it('follows the language', () => {
    const russian = formatPrice('70000.1', 2, 'ru')

    // Russian groups with a non-breaking space, which is not an ordinary
    // space — asserted through the separators rather than pasted in, so this
    // test says what it means.
    expect(russian).toBe(`70${separatorsFor('ru').thousandSeparator}000,10`)
    expect(russian).not.toBe(formatPrice('70000.1', 2, 'en'))
  })

  it('keeps every digit the exchange quoted', () => {
    // 20 digits of a decimal string survive; the same number through a double
    // would not.
    expect(formatPrice('123456789.123456789', 9, 'en')).toBe('123,456,789.123456789')
  })
})

describe('separatorsFor', () => {
  it('reads them off Intl rather than a table per language', () => {
    expect(separatorsFor('en')).toEqual({ decimalSeparator: '.', thousandSeparator: ',' })

    const russian = separatorsFor('ru')
    expect(russian.decimalSeparator).toBe(',')
    expect(russian.thousandSeparator).not.toBe(',')
    expect(russian.thousandSeparator.trim()).toBe('')
  })
})

describe('toDecimalPoint', () => {
  it('leaves an English number alone apart from the grouping', () => {
    expect(toDecimalPoint('70,000.10', 'en')).toBe('70000.10')
    expect(toDecimalPoint('70000.10', 'en')).toBe('70000.10')
  })

  it('turns a Russian comma into a point', () => {
    const grouped = `70${separatorsFor('ru').thousandSeparator}000,10`

    expect(toDecimalPoint(grouped, 'ru')).toBe('70000.10')
    // what a person types, with an ordinary space for grouping
    expect(toDecimalPoint('70 000,10', 'ru')).toBe('70000.10')
    expect(toDecimalPoint('0,5', 'ru')).toBe('0.5')
  })

  it('round-trips what the browser itself rendered', () => {
    for (const language of ['en', 'ru']) {
      expect(toDecimalPoint(formatPrice('1234.5', 2, language), language)).toBe('1234.50')
    }
  })
})
