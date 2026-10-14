export type Direction = 'up' | 'down' | 'flat'

export type DayChange = {
  // a fraction: 0.0123 is +1.23 %
  ratio: number
  direction: Direction
}

// Where a price stands against the price 24 hours ago — the only thing a price
// is ever coloured by. Not against the previous Tick: that is the question a
// trades list asks ("what just happened"), and on a screen that asks "where is
// this today" it makes every number flicker four times a second. The reference
// holds for hours, so the colour does too.
//
// The ratio goes through a double: it is a caption rounded to two decimals,
// not a price, and no digit the exchange quoted is lost by it.
export function dayChange(price: string | null, reference: string | null): DayChange | null {
  if (price === null || reference === null) return null
  const now = Number(price)
  const then = Number(reference)
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null

  const ratio = (now - then) / then
  return { ratio, direction: ratio > 0 ? 'up' : ratio < 0 ? 'down' : 'flat' }
}

// The colour each direction is painted in. Mantine's own `green`/`red`
// resolve per colour scheme; the brand palette is deliberately not one of
// them (`aurora` was picked away from the semantic green). The sign in the
// text carries the same meaning for anyone who cannot tell the two apart.
export const DIRECTION_COLOR = {
  up: 'green',
  down: 'red',
  flat: 'dimmed',
} as const satisfies Record<Direction, string>
