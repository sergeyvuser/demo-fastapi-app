import { useQuery, type QueryClient } from '@tanstack/react-query'

import { api } from '../api/client'
import type { Alert } from './list'

// The API's ceiling for one page.
const PAGE_SIZE = 100

// The key every later writer invalidates: the create and edit forms, pause and
// delete, and a Trigger arriving over the socket (tickets 26–28).
export const ALERTS_QUERY_KEY = ['alerts', 'list'] as const

// Shared by every optimistic write to the list (pause, resume, delete), so
// the last one to settle can tell it is last — and so a refetch from
// elsewhere can tell one is still in flight.
export const ALERTS_WRITE_KEY = ['alerts', 'write'] as const

// Ask for the list again because something changed it on the server — not
// while an optimistic write is in flight. A read served before that write
// lands would bring back the state from before the click and flicker the
// card through it; and the write refetches once it settles anyway, after
// whatever changed here, so nothing is lost by waiting for it.
export function refreshAlerts(queryClient: QueryClient): void {
  if (queryClient.isMutating({ mutationKey: ALERTS_WRITE_KEY }) > 0) return
  void queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY })
}

// The whole list, every page of it. The screen filters, counts and groups on
// the client, so it needs every Alert, not the first page: twenty occupy
// slots, but Finished ones stay for thirty days and are not bounded.
async function fetchAllAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { data } = await api.GET('/api/v1/alerts', {
      params: { query: { skip, limit: PAGE_SIZE } },
    })
    // every non-2xx is thrown by the middleware, so here the body is there
    alerts.push(...data!.items)
    if (data!.items.length < PAGE_SIZE || alerts.length >= data!.total) return alerts
  }
}

export function useAlerts() {
  return useQuery({ queryKey: ALERTS_QUERY_KEY, queryFn: fetchAllAlerts })
}
