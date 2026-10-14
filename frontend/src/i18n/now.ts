import { useSyncExternalStore } from 'react'

// One clock for the whole application. Twenty cards with a `setInterval` each
// is the pattern that froze the main-screen prototype, and a relative time
// needs no better resolution than this.
const TICK_MS = 30_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function tick(): void {
  now = Date.now()
  for (const listener of listeners) listener()
}

function onVisibilityChange(): void {
  // A laptop waking after an hour otherwise shows every relative time jumping
  // at once, up to thirty seconds later.
  if (document.visibilityState === 'visible') tick()
}

// The store runs only while something reads it: nothing ticks in a test that
// never subscribed, and nothing is left running after the last card unmounts.
export function subscribeToNow(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === undefined) {
    timer = setInterval(tick, TICK_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

export function getNow(): number {
  return now
}

export function useNow(): number {
  return useSyncExternalStore(subscribeToNow, getNow)
}
