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
  // nothing" are different screens (and "unavailable", below, a third).
  symbols: readonly string[] | null
  quotes: ReadonlyMap<string, Quote>
}

// The only price the UI ever renders. A Tick is not server state: it changes
// four times a second and nobody refetches it, so it lives here rather than in
// the query cache, and every component that shows a price reads it from here.
// The symbols response seeds it and the socket's Ticks write to it, and no
// screen knows which of the two a number came from.
let snapshot: Snapshot = { symbols: null, quotes: new Map() }
// A third state beside "loading" and "loaded": the list was asked for and
// never came. Only ever true while `symbols` is null — once a list has
// arrived, its prices stay on screen through any later failure.
let unavailable = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function publish(next: Snapshot): void {
  snapshot = next
  notify()
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
  // a first list always counts as changed, so this clears the failure too
  unavailable = false
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

// The symbols list could not be fetched. Said only while no list has ever
// arrived: a skeleton that never resolves claims "loading" about a server that
// is not answering. Later failures change nothing — the last prices stand.
export function markPricesUnavailable(): void {
  if (snapshot.symbols !== null || unavailable) return
  unavailable = true
  notify()
}

// For tests: one store per module, so every test starts from "not loaded".
export function resetPrices(): void {
  unavailable = false
  publish({ symbols: null, quotes: new Map() })
}

export function usePricesUnavailable(): boolean {
  return useSyncExternalStore(subscribeToPrices, () => unavailable)
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

// How often a chart may redraw. A requirement measured in the prototype, not
// a tuning knob: Recharts redraws the whole plot on any prop change, and at
// the socket's four Ticks a second that froze the tab.
export const CHART_INTERVAL_MS = 1000

// The same store, heard at most once per interval: the first change at once,
// the rest of the interval folded into one call at its end. Numbers keep the
// full rate through `subscribeToPrices`; only what a chart reads goes through
// here, so both show the same price and only the redraw is thinned.
export function subscribeAtMost(intervalMs: number) {
  return (listener: () => void): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending = false

    const settle = () => {
      timer = null
      if (!pending) return
      pending = false
      listener()
      timer = setTimeout(settle, intervalMs)
    }
    const unsubscribe = subscribeToPrices(() => {
      if (timer !== null) {
        pending = true
        return
      }
      listener()
      timer = setTimeout(settle, intervalMs)
    })

    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }
}

// What the charts see: a copy of the prices taken at most once per interval.
// Thinning the notification alone is not enough — a chart that re-renders for
// any other reason would read the live store and redraw at socket speed
// anyway, which is exactly what the first version of this did. The value
// itself must lag.
let sampled: ReadonlyMap<string, string | null> | null = null
const chartListeners = new Set<() => void>()
let stopSampling: (() => void) | null = null

function takeSample(): void {
  sampled = new Map([...snapshot.quotes].map(([symbol, quote]) => [symbol, quote.price]))
}

// One sampler for every chart on screen, started by the first and stopped by
// the last, so all of them move on the same beat.
export function subscribeToChartPrices(listener: () => void): () => void {
  chartListeners.add(listener)
  if (stopSampling === null) {
    takeSample()
    stopSampling = subscribeAtMost(CHART_INTERVAL_MS)(() => {
      takeSample()
      for (const each of chartListeners) each()
    })
  }
  return () => {
    chartListeners.delete(listener)
    if (chartListeners.size > 0 || stopSampling === null) return
    stopSampling()
    stopSampling = null
    sampled = null
  }
}

export function getSampledPrice(symbol: string): string | null {
  // before anything subscribed, the first render reads the store itself
  if (sampled === null) return getQuote(symbol)?.price ?? null
  return sampled.get(symbol) ?? null
}

// A price for something that must not redraw at socket speed.
export function useSampledPrice(symbol: string): string | null {
  return useSyncExternalStore(subscribeToChartPrices, () => getSampledPrice(symbol))
}

// A Symbol's precision alone: it changes with the Subscription, not with a
// Tick, and a number is compared by value — so reading it costs no re-render
// at socket speed, which reading the whole quote would.
export function usePrecision(symbol: string): number | undefined {
  return useSyncExternalStore(subscribeToPrices, () => getQuote(symbol)?.precision)
}
