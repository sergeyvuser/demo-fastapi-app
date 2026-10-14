import { useEffect } from 'react'

import { $api } from '../api/client'
import { seedPrices } from './store'

// How often the symbols list is asked for again. The public screens have no
// socket — an anonymous one cannot exist, the first frame is the auth — so
// this is how prices move there, and a shop window ten seconds behind is the
// price of not handing anonymous visitors unbounded watchers.
export const SYMBOLS_POLL_MS = 10_000

// The symbols response feeds the price store and is never rendered itself:
// there is one path from the network to a price on screen, so there are not
// two that could disagree. Mounted once, in the shell.
//
// Until ticket 22 this also keeps the signed-in screens moving. That ticket
// feeds the same store from the socket and refetches this list on every
// reconnect; whether the poll stops while the socket is live is its call.
export function useSymbolsFeed(): void {
  const { data } = $api.useQuery('get', '/api/v1/symbols', undefined, {
    refetchInterval: SYMBOLS_POLL_MS,
    // a hidden tab asks nothing; React Query refetches on focus anyway
    refetchIntervalInBackground: false,
  })

  useEffect(() => {
    if (data) seedPrices(data.items)
  }, [data])
}
