import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'

import { api } from '../api/client'
import type { components } from '../api/generated/http'

export type Trigger = components['schemas']['TriggerRead']
export type TriggerPage = components['schemas']['CursorPage_TriggerRead_']

// The API's own default. A page is what one scroll of a phone screen reveals
// several times over, so the next one is asked for well before it is needed.
export const FEED_PAGE_SIZE = 50

// The key ticket 28 writes into when a Trigger arrives over the socket, and
// refetches after a reconnect.
export const TRIGGERS_QUERY_KEY = ['triggers', 'feed'] as const

// The feed narrowed to one Alert — History reached from that Alert's screen.
// Under the global key, so invalidating the feed reaches it too, but never
// equal to it: a Trigger the socket writes into the global feed (ticket 28)
// must not land in a list that belongs to another Alert.
export function feedKey(alertId?: string) {
  return alertId === undefined
    ? TRIGGERS_QUERY_KEY
    : ([...TRIGGERS_QUERY_KEY, { alertId }] as const)
}

// How many of its own Triggers an Alert's screen shows; the rest is History.
export const RECENT_LIMIT = 5

// The cursor is the server's token: echoed back as it came, never built or
// read here (ticket 04). `null` is the first page; a `null` from the server is
// the end of the feed — there is no total to compare against.
async function fetchPage(cursor: string | null, alertId?: string): Promise<TriggerPage> {
  const { data } = await api.GET('/api/v1/triggers', {
    params: {
      query: {
        limit: FEED_PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
        ...(alertId === undefined ? {} : { alert_id: alertId }),
      },
    },
  })
  // every non-2xx is thrown by the middleware, so here the body is there
  return data!
}

// The pages as one list, in the order the server sent them.
//
// Never re-sorted: the server orders by `triggered_at DESC, id DESC`, and
// sorting by time alone here would shuffle the Triggers one Tick produced in
// the same instant. Deduplicated by id, because two sources write into this
// cache — the pages, and from ticket 28 the socket — and a Trigger that
// arrived over the socket comes back in the next page too.
export function flattenFeed(pages: readonly TriggerPage[]): Trigger[] {
  // The first copy wins: it sits nearer the head, where the newest-first feed
  // put it, and a later copy is only the same fact arriving again.
  const seen = new Set<string>()
  const triggers: Trigger[] = []
  for (const page of pages) {
    for (const trigger of page.items) {
      if (seen.has(trigger.id)) continue
      seen.add(trigger.id)
      triggers.push(trigger)
    }
  }
  return triggers
}

export function useTriggerFeed(alertId?: string) {
  return useInfiniteQuery({
    queryKey: feedKey(alertId),
    queryFn: ({ pageParam }) => fetchPage(pageParam, alertId),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    select: (data: InfiniteData<TriggerPage, string | null>) => flattenFeed(data.pages),
  })
}

// One Alert's latest few, newest first: one request, no cursor. A query of
// its own rather than the first page of the narrowed feed — that page is
// fifty rows, and this screen shows five.
export function useRecentTriggers(alertId: string) {
  return useQuery({
    queryKey: ['triggers', 'alert', alertId],
    queryFn: async () => {
      const { data } = await api.GET('/api/v1/triggers', {
        params: { query: { alert_id: alertId, limit: RECENT_LIMIT } },
      })
      return data!.items
    },
  })
}
