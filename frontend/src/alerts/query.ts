import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { Alert } from './list'

// The API's ceiling for one page.
const PAGE_SIZE = 100

// The key every later writer invalidates: the create and edit forms, pause and
// delete, and a Trigger arriving over the socket (tickets 26–28).
export const ALERTS_QUERY_KEY = ['alerts', 'list'] as const

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
