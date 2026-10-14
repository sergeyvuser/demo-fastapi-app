import { describe, expect, it } from 'vitest'

import { createTestI18n } from '../testing/i18n'
import { en, ru } from './resources'

// Key parity between the catalogues is a compile error (`ru satisfies typeof
// en` in resources.ts) and needs no test. Plural keys are the one hole that
// check structurally cannot cover: English has two categories and Russian
// four, so there is nothing in `en` from which to require `_few` and `_many`.
// A missing `_many` compiles cleanly and shows a user "5 срабатывания".

// Read from the platform rather than typed by hand: the same CLDR data
// i18next resolves a suffix through. `other` serves fractional counts and
// looks redundant — it stays because `Intl` says so, not because anyone has
// an opinion about Russian.
const RUSSIAN_CATEGORIES = new Intl.PluralRules('ru').resolvedOptions().pluralCategories

const SINGULAR_SUFFIX = '_one'

// Catalogues are nested objects; i18next addresses them by dotted path.
function keyPaths(catalogue: unknown, prefix = ''): string[] {
  if (typeof catalogue !== 'object' || catalogue === null) return [prefix]

  return Object.entries(catalogue).flatMap(([key, value]) =>
    keyPaths(value, prefix ? `${prefix}.${key}` : key),
  )
}

const pluralKeys = keyPaths(en)
  .filter((key) => key.endsWith(SINGULAR_SUFFIX))
  .map((key) => key.slice(0, -SINGULAR_SUFFIX.length))

describe('the plural keys of the catalogue', () => {
  // Both halves below are `it.each` over keys derived from `en`. Without this
  // they would pass by having nothing to iterate, which is the one way a
  // derived test lies.
  it('are found at all', () => {
    expect(pluralKeys.length).toBeGreaterThan(0)
  })

  describe.each(pluralKeys)('%s', (key) => {
    it('has every Russian category', () => {
      const russianKeys = new Set(keyPaths(ru))

      for (const category of RUSSIAN_CATEGORIES) {
        expect(russianKeys).toContain(`${key}_${category}`)
      }
    })

    it('declines in Russian without repeating a form', () => {
      // A key read out of the catalogue cannot be a literal, so `t` is used
      // through its loose signature here — the only cast in the suite.
      const instance = createTestI18n('ru')
      const translate = instance.t as (key: string, options: { count: number }) => string

      // The count itself is stripped, so the assertion is about the form of
      // the noun and not about the digits in front of it — 21 and 1 must come
      // out of this with the same number of hashes.
      const form = (count: number) => translate(key, { count }).replace(/\d+/g, '#')

      // No expected strings anywhere: wording stays free to change, and what
      // is asserted is the thing that is actually wrong when it is wrong.
      // A `_few` pasted from `_many` fails here...
      expect(new Set([form(1), form(2), form(5)]).size).toBe(3)
      // ...and a 21 that drifted into the `_many` wording fails here.
      expect(form(21)).toBe(form(1))
    })
  })
})
