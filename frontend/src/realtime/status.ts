import { useSyncExternalStore } from 'react'

// What the socket means for the prices on screen right now.
//   off        — no socket by design: nobody is signed in, and the public
//                screens poll. Nothing about that is stale.
//   connecting — the first attempt since sign-in, not yet answered. Not
//                dimmed either: a page load would flash grey every time.
//   live       — authenticated; Ticks are arriving.
//   down       — a socket should be live and is not: the first attempt
//                failed, or a live one was lost. Prices are dimmed.
export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'down'

let status: RealtimeStatus = 'off'
const listeners = new Set<() => void>()

export function getRealtimeStatus(): RealtimeStatus {
  return status
}

export function setRealtimeStatus(next: RealtimeStatus): void {
  if (next === status) return
  status = next
  for (const listener of listeners) listener()
}

export function subscribeToRealtimeStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeToRealtimeStatus, getRealtimeStatus)
}
