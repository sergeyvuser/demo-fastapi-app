import type { components } from '../api/generated/http'

export type Condition = components['schemas']['AlertCondition']

// The axis shows the Threshold ±4 %: wide enough that a normal day's move
// stays on it, narrow enough that a quarter of a percent is still visible.
export const DISTANCE_WINDOW = 0.04

export type Distance = {
  // How far the price has to move to reach the Threshold, as a fraction of
  // the price now: (Threshold − price) / price. Measured against the price,
  // because that is the question the badge answers — "how much does it have
  // to move". Against the Threshold, a price twice the Threshold would read
  // "100 % to go", a fall no price can make; this way it reads 50 %.
  move: number
  // whether the Condition is satisfied right now — the only thing the
  // distance is ever coloured by
  holds: boolean
  // where the dot sits, 0 (left end) to 1 (right end), the Threshold at 0.5.
  // The axis is a window around the Threshold, so this one is measured
  // against the Threshold; inside the window the two measures differ by a
  // few hundredths of a percent.
  position: number
  // which end the dot was pinned to, when the price is off the axis
  clamped: 'low' | 'high' | null
}

// Mirrors `condition_holds` on the server: both boundaries are inclusive, so
// a price exactly at the Threshold satisfies either Condition.
export function conditionHolds(condition: Condition, threshold: number, price: number): boolean {
  return condition === 'price_above' ? price >= threshold : price <= threshold
}

// The gap between the live price and the Threshold, drawn and measured. `null`
// when there is no price to measure: a missing price is no distance at all,
// never a distance of zero.
//
// Both values go through a double. This is a drawing and a caption rounded
// to two decimals, not a price, so nothing the exchange quoted is shown from
// it.
export function distanceTo(
  condition: Condition,
  threshold: string,
  price: string | null,
): Distance | null {
  if (price === null) return null
  const level = Number(threshold)
  const now = Number(price)
  if (!Number.isFinite(level) || !Number.isFinite(now) || level <= 0 || now <= 0) return null

  const raw = 0.5 + (now - level) / level / (2 * DISTANCE_WINDOW)

  return {
    move: (level - now) / now,
    holds: conditionHolds(condition, level, now),
    position: Math.min(1, Math.max(0, raw)),
    clamped: raw < 0 ? 'low' : raw > 1 ? 'high' : null,
  }
}

// Green means "this rule is being met right now", whichever way the price had
// to go for that. Not "the price is above the Threshold": the two disagree for
// every `price_below` Alert, and colouring by side would paint a satisfied
// rule red under the green band on its own axis. Grey when there is nothing to
// measure, or when the socket is down and the number is no longer moving.
export function distanceColor(distance: Distance | null, stale: boolean): 'green' | 'red' | 'gray' {
  if (distance === null || stale) return 'gray'
  return distance.holds ? 'green' : 'red'
}
