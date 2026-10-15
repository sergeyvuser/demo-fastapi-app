import { useEffect } from 'react'

import { $api } from '../api/client'
import { useRealtimeStatus } from '../realtime/status'
import { markPricesUnavailable, seedPrices } from './store'

// How often the symbols list is asked for again. The public screens have no
// socket — an anonymous one cannot exist, the first frame is the auth — so
// this is how prices move there, and a shop window ten seconds behind is the
// price of not handing anonymous visitors unbounded watchers.
export const SYMBOLS_POLL_MS = 10_000

// The symbols response feeds the price store and is never rendered itself:
// everything on screen comes out of the store, so no screen can show one
// number from the poll and another from the socket. Mounted once, in the shell.
//
// While the socket is live the poll stops: Ticks are the faster copy of the
// same numbers, and a poll answer landing after a newer Tick would wind the
// price back. Every other state polls — anonymous, connecting, and above all
// down, which is what keeps a signed-in screen correct if the socket never
// connects at all. The socket refetches this list once on every reconnect.
export function useSymbolsFeed(): void {
  const live = useRealtimeStatus() === 'live'
  const { data, isError } = $api.useQuery('get', '/api/v1/symbols', undefined, {
    refetchInterval: live ? false : SYMBOLS_POLL_MS,
    // a hidden tab asks nothing; React Query refetches on focus anyway
    refetchIntervalInBackground: false,
  })

  useEffect(() => {
    if (data) seedPrices(data.items)
  }, [data])

  // After the client's own retries. The poll keeps asking all the same, so
  // the prices appear by themselves when the server answers again.
  useEffect(() => {
    if (isError) markPricesUnavailable()
  }, [isError])
}
