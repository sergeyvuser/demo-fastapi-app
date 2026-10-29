import type { InfiniteData } from '@tanstack/react-query'

import { refreshAlerts } from '../alerts/query'
import { queryClient } from '../api/client'
import type { ServerMessage } from '../api/socket'
import {
  ALL_TRIGGERS_KEY,
  feedKey,
  RECENT_LIMIT,
  recentKey,
  type Trigger,
  type TriggerPage,
} from './feed'

// Triggers from the socket, into the query cache.
//
// A Trigger is the opposite of a Tick: rare, and server state. A Tick runs
// into the price store at full rate and never touches the cache; a Trigger is
// written into the cache like a page that arrived early, and every list of
// Triggers already on screen gains it without asking the server.
//
// The socket is still only a latency optimisation. Nothing is buffered for a
// tab that was away, nothing is numbered, nothing is replayed: a gap is closed
// by asking again (recoverTriggers), and the same Trigger arriving both ways
// is shown once because every write here dedupes by its id.

export type TriggerMessage = Extract<ServerMessage, { type: 'trigger' }>

type Feed = InfiniteData<TriggerPage, string | null>

// The frame is the stored row, field for field; only the id is named
// differently, as the socket's envelope has a `type` of its own.
export function triggerOf(message: TriggerMessage): Trigger {
  return {
    id: message.trigger_id,
    alert_id: message.alert_id,
    symbol: message.symbol,
    condition: message.condition,
    threshold: message.threshold,
    price: message.price,
    triggered_at: message.triggered_at,
    delivery: message.delivery,
  }
}

// A feed with the Trigger at its head.
//
// A feed nobody has loaded stays unloaded: one row written into it would pass
// for the whole feed the next time it is shown. A Trigger already in it, on
// any page, leaves it exactly as it was — the same object, so nothing
// re-renders. The new row goes into the first page's items only: the cursors
// belong to the last row of each page, and the head is not where any of them
// points.
export function withTrigger(feed: Feed | undefined, trigger: Trigger): Feed | undefined {
  if (feed === undefined || feed.pages.length === 0) return feed
  if (feed.pages.some((page) => page.items.some((item) => item.id === trigger.id))) return feed
  const [head, ...older] = feed.pages
  return { ...feed, pages: [{ ...head, items: [trigger, ...head.items] }, ...older] }
}

// An Alert's latest few with the Trigger on top — still a few.
export function withRecent(recent: Trigger[] | undefined, trigger: Trigger): Trigger[] | undefined {
  if (recent === undefined || recent.some((item) => item.id === trigger.id)) return recent
  return [trigger, ...recent].slice(0, RECENT_LIMIT)
}

// One `trigger` frame. Written into every list of Triggers it belongs to: the
// History feed, the feed narrowed to its Alert, and that Alert's latest five.
// A feed narrowed to any other Alert is not touched — keys are exact here.
export function applyTrigger(message: TriggerMessage): void {
  const trigger = triggerOf(message)
  for (const key of [feedKey(), feedKey(trigger.alert_id)]) {
    queryClient.setQueryData<Feed>(key, (feed) => withTrigger(feed, trigger))
  }
  queryClient.setQueryData<Trigger[]>(recentKey(trigger.alert_id), (recent) =>
    withRecent(recent, trigger),
  )
  // The Alert itself changed on the server: its count, its last Trigger, and
  // a `once` Alert is now Completed. That state is derived by the backend, so
  // it is asked for, never worked out here.
  refreshAlerts(queryClient)
}

// After a successful auth on a new connection: whatever went off while the
// socket was away. Every list of Triggers is refetched — the ones on screen
// now, the rest when next shown — and with them the Alerts they changed.
//
// A loaded feed refetches all of its pages, from the head, through the
// server's cursors: more Triggers in the gap than one page holds would
// otherwise leave a hole between the new head and the older pages.
export function recoverTriggers(): void {
  void queryClient.invalidateQueries({ queryKey: ALL_TRIGGERS_KEY })
  refreshAlerts(queryClient)
}
