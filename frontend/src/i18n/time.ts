import { useTranslation } from 'react-i18next'

import { resolvedLanguage } from './language'
import { useNow } from './now'

// The server is timezone-aware everywhere, so an instant arrives unambiguous
// and the browser knows the reader's zone. The conversion happens in the
// render and nowhere else: no zone in state, no zone in a request.
//
// Every formatter below takes the language explicitly, derived from
// `i18n.resolvedLanguage` at the call site — one source, or `Intl` and the
// catalogue drift apart. `timeZone` is the browser's own unless passed; it is
// passed only where a test pins one.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const UNITS = [
  ['hour', HOUR],
  ['minute', MINUTE],
  ['second', SECOND],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[]

// `Intl` declines the number itself, in both languages. This must never
// acquire catalogue plural keys: that would be the same CLDR rules
// implemented twice, disagreeing on the twelfth case.
export function formatRelative(instant: number, now: number, language: string): string {
  const difference = instant - now
  const [unit, size] = UNITS.find(([, span]) => Math.abs(difference) >= span) ?? UNITS[2]

  return new Intl.RelativeTimeFormat(language, {
    // "yesterday" and "now" instead of "1 day ago" and "in 0 seconds"
    numeric: 'auto',
  }).format(Math.round(difference / size), unit)
}

export function formatAbsolute(instant: number, language: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(instant)
}

// What the Tooltip on a relative time shows: the whole instant, seconds and
// zone included, so "3 minutes ago" is never the only answer available.
export function formatExact(instant: number, language: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'long',
    timeStyle: 'long',
    timeZone,
  }).format(instant)
}

// Relative under a day, absolute above it.
export function formatInstant(
  instant: number,
  now: number,
  language: string,
  timeZone?: string,
): string {
  return Math.abs(instant - now) < DAY
    ? formatRelative(instant, now, language)
    : formatAbsolute(instant, language, timeZone)
}

export type RenderedInstant = {
  text: string
  exact: string
}

// The hook every card uses: one clock drives all of them, and both strings
// come back together because the exact one always rides along in a Tooltip.
export function useInstant(instant: string): RenderedInstant {
  const { i18n } = useTranslation()
  const now = useNow()

  const language = resolvedLanguage(i18n)
  const at = new Date(instant).getTime()

  return {
    text: formatInstant(at, now, language),
    exact: formatExact(at, language),
  }
}
