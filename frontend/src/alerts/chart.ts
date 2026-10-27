import type { components } from '../api/generated/http'

type Candle = components['schemas']['CandleRead']

// The chart's arithmetic, kept out of the component: which numbers go on the
// axes is a decision, and Recharts would make a different one silently.

export type ChartPoint = { time: number; close: number }

// Only the close is drawn. The API sends the whole Candle oldest first, which
// is the order a line wants.
export function toPoints(candles: readonly Candle[]): ChartPoint[] {
  return candles.map((candle) => ({
    time: Date.parse(candle.start),
    close: Number(candle.close),
  }))
}

// A round step for about `target` intervals across `span`: 1, 2, 2.5 or 5
// times a power of ten — the steps a person reads without effort.
export function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1
  const raw = span / target
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw)!
  return step * power
}

export type TickKind = 'round' | 'threshold' | 'live'
export type PriceTick = { value: number; kind: TickKind }

export type PriceAxis = {
  domain: [number, number]
  ticks: PriceTick[]
}

// How close two labels may sit, as a share of the axis height, before the
// lesser one is dropped: about one line of 12 px text on a 220 px plot.
export const LABEL_GAP = 0.07

// The left axis: round numbers, plus the Threshold and the live price, each
// among the numbers in its own line's colour. The range covers the closes and
// both lines, so neither is drawn off the plot.
//
// What gives way: a round tick yields to either named one, and the live
// price's label yields to the Threshold's (its line stays) — the Threshold is
// the number this form is about.
//
// The result is sorted. Recharts drops ticks that arrive out of order, without
// a word — that is how the Threshold's label went missing in the prototype.
export function priceAxis(
  closes: readonly number[],
  threshold: number | null,
  live: number | null,
): PriceAxis {
  const named = [threshold, live].filter((value): value is number => value !== null)
  const values = [...closes, ...named]
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    // one value only: give it room, or every label lands on one line
    const pad = Math.abs(min) * 0.01 || 1
    min -= pad
    max += pad
  }
  const step = niceStep(max - min)
  const low = Math.floor(min / step) * step
  const high = Math.ceil(max / step) * step
  const gap = (high - low) * LABEL_GAP

  const ticks: PriceTick[] = []
  if (threshold !== null) ticks.push({ value: threshold, kind: 'threshold' })
  if (live !== null && (threshold === null || Math.abs(live - threshold) >= gap)) {
    ticks.push({ value: live, kind: 'live' })
  }
  // multiplied out from an index, not summed: adding 0.1 ten times is not 1
  const count = Math.round((high - low) / step)
  for (let index = 0; index <= count; index += 1) {
    const value = round(low + index * step, step)
    if (ticks.every((tick) => tick.kind === 'round' || Math.abs(tick.value - value) >= gap)) {
      ticks.push({ value, kind: 'round' })
    }
  }

  return { domain: [low, high], ticks: ticks.sort((a, b) => a.value - b.value) }
}

// Rounding noise off a multiple of `step`: 0.30000000000000004 is a tick
// label nobody wants to read.
function round(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  return Number(value.toFixed(decimals))
}

const QUARTER_HOUR = 15 * 60 * 1000
export const HOURS_BETWEEN_LABELS = 4

// The bottom axis: whole hours on the reader's clock, one every four. Found by
// walking quarter hours rather than whole UTC hours, because in a zone at a
// half-hour offset a whole UTC hour is never a whole local one. `timeZone` is
// the browser's own unless a test pins one.
export function hourTicks(from: number, to: number, timeZone?: string): number[] {
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    timeZone,
  })
  const ticks: number[] = []
  for (let time = Math.ceil(from / QUARTER_HOUR) * QUARTER_HOUR; time <= to; time += QUARTER_HOUR) {
    const parts = clock.formatToParts(time)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)
    if (minute === 0 && hour % HOURS_BETWEEN_LABELS === 0) ticks.push(time)
  }
  return ticks
}
