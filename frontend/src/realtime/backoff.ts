export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_CAP_MS = 30_000

// How long to wait before reconnection attempt number `attempt` (0 for the
// first after a loss): exponential backoff with full jitter. The ceiling grows
// 1, 2, 4 … 30 s and the delay is anywhere below it, so a deploy that drops
// every socket at once does not get every tab back on the same second. There
// is no attempt limit — a tab left open across an outage reconnects when the
// outage ends, without the person reloading.
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  // min() before the power would overflow it: past 2^15 the ceiling is the cap
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 15))
  return Math.floor(random() * ceiling)
}
