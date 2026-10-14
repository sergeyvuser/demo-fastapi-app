// Numbers follow the language: `70 000,00` in Russian, with a non-breaking
// space and a decimal comma, straight out of `Intl`. A Symbol, by contrast, is
// never translated and never formatted.

// Display precision is a property of the Symbol, published by the API —
// `Numeric(20, 8)` in the schema tells a client nothing, and two decimals for
// BTCUSDT against five for a sub-dollar coin is information the exchange has
// and the frontend must not guess.
export function formatPrice(price: string | number, precision: number, language: string): string {
  return new Intl.NumberFormat(language, {
    // No currency style: it needs an ISO 4217 code and USDT is not one. The
    // quote asset is read off the Symbol beside the number instead, and `$` is
    // rejected as a factual error — USDT is pegged to the dollar, not equal to
    // it.
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    // A price arrives as a decimal string and is formatted as one: a detour
    // through a double would round what the exchange actually quoted. `Intl`
    // takes a decimal string since its v3 API, but the type it declares for
    // that overload is a template literal no plain `string` can satisfy —
    // hence the cast, which is about typing and not about the value.
  }).format(price as Intl.StringNumericLiteral)
}

// A change as a signed percentage: `+1.23%`, `-0.40%`, `0.00%`. The sign is
// always written, so a direction is legible without its colour; zero gets
// none, because "+0.00%" claims a direction that is not there.
export function formatChange(ratio: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(ratio)
}

export type Separators = {
  decimalSeparator: string
  thousandSeparator: string
}

// Derived from `Intl` rather than written out per language, so a third locale
// needs no code change here. Feeds a Mantine `NumberInput`, whose separators
// are props.
export function separatorsFor(language: string): Separators {
  const parts = new Intl.NumberFormat(language).formatToParts(12345.6)

  return {
    decimalSeparator: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    thousandSeparator: parts.find((part) => part.type === 'group')?.value ?? '',
  }
}

// What leaves the browser is always a decimal point. Format is a property of
// the screen, not of the value: accepting both separators and echoing back
// whatever was typed makes one number look different on the form and on the
// card, and the user cannot tell whether that is their mistake or ours.
export function toDecimalPoint(typed: string, language: string): string {
  const { decimalSeparator, thousandSeparator } = separatorsFor(language)

  // Russian groups with a non-breaking space, which no keyboard types but
  // every `Intl` output carries; an ordinary space is what a person types
  // instead. Both go, along with every other kind of space.
  let value = typed.replace(/\s/g, '')
  if (thousandSeparator.trim()) value = value.split(thousandSeparator.trim()).join('')

  return decimalSeparator === '.' ? value : value.split(decimalSeparator).join('.')
}
