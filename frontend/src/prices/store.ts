import { useSyncExternalStore } from 'react'

import type { components } from '../api/generated/http'

type SymbolRead = components['schemas']['SymbolRead']

// What the UI knows about one Symbol's price. Both prices are decimal strings,
// exactly as the API sent them, and either may be missing: a `null` price is
// "no fresh Tick within the cache's 60 seconds", never zero.
export type Quote = {
  price: string | null
  referencePrice: string | null
  precision: number
}

type Snapshot = {
  // `null` until the first answer arrives: "loading" and "the system streams
  // nothing" are different screens.
  symbols: readonly string[] | null
  quotes: ReadonlyMap<string, Quote>
}

// The only price the UI ever renders. A Tick is not server state: it changes
// four times a second and nobody refetches it, so it lives here rather than in
// the query cache, and every component that shows a price reads it from here.
// The symbols response seeds it and the socket's Ticks write to it, and no
// screen knows which of the two a number came from.
let snapshot: Snapshot = { symbols: null, quotes: new Map() }
const listeners = new Set<() => void>()

function publish(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function sameQuote(a: Quote | undefined, b: Quote): a is Quote {
  return (
    a !== undefined &&
    a.price === b.price &&
    a.referencePrice === b.referencePrice &&
    a.precision === b.precision
  )
}

// The list is the whole Subscription, so it replaces what was there: a Symbol
// that left the Subscription leaves the strip. A quote whose numbers did not
// move keeps its identity, which is what lets React skip the element that
// shows it — a poll that changed one price re-renders one price.
export function seedPrices(items: readonly SymbolRead[]): void {
  const quotes = new Map<string, Quote>()
  let changed = snapshot.symbols === null || snapshot.symbols.length !== items.length

  items.forEach((item, index) => {
    const quote: Quote = {
      price: item.price,
      referencePrice: item.reference_price,
      precision: item.precision,
    }
    const previous = snapshot.quotes.get(item.symbol)
    if (sameQuote(previous, quote)) {
      quotes.set(item.symbol, previous)
    } else {
      quotes.set(item.symbol, quote)
      changed = true
    }
    if (snapshot.symbols?.[index] !== item.symbol) changed = true
  })

  if (!changed) return
  publish({ symbols: items.map((item) => item.symbol), quotes })
}

// One Tick from the socket: a new quote for its Symbol, at full rate — the
// server already samples to four a second. Only the list knows a Symbol's
// precision, so a Tick for a Symbol the list has not named is dropped; the
// socket only watches what the list named anyway. The list itself keeps its
// identity, which is how the socket tells a Tick from a new Subscription.
export function applyTick(symbol: string, price: string, referencePrice: string | null): void {
  const previous = snapshot.quotes.get(symbol)
  if (previous === undefined) return
  const quote: Quote = { price, referencePrice, precision: previous.precision }
  if (sameQuote(previous, quote)) return

  const quotes = new Map(snapshot.quotes)
  quotes.set(symbol, quote)
  publish({ symbols: snapshot.symbols, quotes })
}

export function getSymbols(): readonly string[] | null {
  return snapshot.symbols
}

export function getQuote(symbol: string): Quote | undefined {
  return snapshot.quotes.get(symbol)
}

// For tests: one store per module, so every test starts from "not loaded".
export function resetPrices(): void {
  publish({ symbols: null, quotes: new Map() })
}

export function subscribeToPrices(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSymbols(): readonly string[] | null {
  return useSyncExternalStore(subscribeToPrices, () => snapshot.symbols)
}

// Every subscriber is told of every change, but each compares only its own
// quote, and an identical one is no re-render.
export function useQuote(symbol: string): Quote | undefined {
  return useSyncExternalStore(subscribeToPrices, () => getQuote(symbol))
}
