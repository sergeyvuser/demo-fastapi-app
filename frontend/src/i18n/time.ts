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

// A time of day without a date — `4:00 AM`, `04:00` — for something that
// recurs daily at one instant, said in the reader's own zone.
export function formatTimeOfDay(instant: number, language: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone }).format(instant)
}

// Whether two instants fall on one calendar day in the reader's zone. Asked
// of `Intl` rather than of `Date.getDate()`, which can only answer for the
// browser's own zone — the one thing a test here pins to something else.
function onTheSameDay(a: number, b: number, language: string, timeZone?: string): boolean {
  const day = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeZone })
  return day.format(a) === day.format(b)
}

// A time of day while the instant is still on the reader's own today, the day
// and month in front of it once it is not — where a bare "1:30 AM" would read
// as an hour that has already gone by. No year, and no `formatAbsolute`: this
// is for a deadline at most a day out (a Cooldown ends within 24 h of its
// Trigger), so "tomorrow" is as far as it ever has to say, and the badge it
// goes in has a card's width to live in.
export function formatTimeOfDayOrDate(
  instant: number,
  now: number,
  language: string,
  timeZone?: string,
): string {
  const time = formatTimeOfDay(instant, language, timeZone)
  if (onTheSameDay(instant, now, language, timeZone)) return time

  // The day in front of the same time string, never a second way of writing
  // the hour: asking one `Intl` call for both would decide the leading zero
  // by its own rules and print "8:00" where every other time on the screen
  // says "08:00". The comma is the separator both locales already use
  // between a date and a time.
  const day = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone })
  return `${day.format(instant)}, ${time}`
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

// For something that has already happened: never "in 30 seconds". The shared
// clock ticks every 30 s, so it can be up to that far behind an instant that
// arrived since — a Trigger pushed over the socket, or a list refetched
// because of one — and a slightly fast server clock does the same. Such an
// instant reads as "now" until the clock catches up.
export function formatPastInstant(
  instant: number,
  now: number,
  language: string,
  timeZone?: string,
): string {
  return formatInstant(Math.min(instant, now), now, language, timeZone)
}

export type RenderedInstant = {
  text: string
  exact: string
}

// The hook every card uses: one clock drives all of them, and both strings
// come back together because the exact one always rides along in a Tooltip.
// `past` for an event that has happened; the exact string is never clamped.
export function useInstant(instant: string, { past = false } = {}): RenderedInstant {
  const { i18n } = useTranslation()
  const now = useNow()

  const language = resolvedLanguage(i18n)
  const at = new Date(instant).getTime()

  return {
    text: (past ? formatPastInstant : formatInstant)(at, now, language),
    exact: formatExact(at, language),
  }
}
