import type { InfiniteData } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { ALERTS_QUERY_KEY, ALERTS_WRITE_KEY } from '../alerts/query'
import { queryClient } from '../api/client'
import {
  feedKey,
  flattenFeed,
  recentKey,
  TRIGGERS_QUERY_KEY,
  type Trigger,
  type TriggerPage,
} from './feed'
import {
  applyTrigger,
  recoverTriggers,
  triggerOf,
  withRecent,
  withTrigger,
  type TriggerMessage,
} from './live'

type Feed = InfiniteData<TriggerPage, string | null>

function trigger(id: string, alertId = 'alert-1'): Trigger {
  return {
    id,
    alert_id: alertId,
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '80000',
    price: '80012.5',
    triggered_at: '2026-10-29T10:00:00Z',
    delivery: 'queued',
  }
}

// The same Trigger as the socket says it.
function frame(t: Trigger): TriggerMessage {
  const { id, ...rest } = t
  return { type: 'trigger', trigger_id: id, ...rest }
}

function feed(...pages: Trigger[][]): Feed {
  return {
    pages: pages.map((items, i) => ({ items, next_cursor: i < pages.length - 1 ? `c${i}` : null })),
    pageParams: pages.map((_, i) => (i === 0 ? null : `c${i - 1}`)),
  }
}

const ids = (triggers: readonly Trigger[]) => triggers.map((t) => t.id)

function feedIds(key = TRIGGERS_QUERY_KEY as readonly unknown[]): string[] | undefined {
  const data = queryClient.getQueryData<Feed>(key)
  return data && ids(flattenFeed(data.pages))
}

afterEach(() => {
  queryClient.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('triggerOf', () => {
  it('is the stored row, with the id under its feed name', () => {
    const row = { ...trigger('t-1'), delivery: 'no_chat' as const }
    expect(triggerOf(frame(row))).toEqual(row)
  })
})

describe('withTrigger', () => {
  it('puts a new Trigger at the head of the first page, cursors untouched', () => {
    const before = feed([trigger('b'), trigger('a')], [trigger('z')])
    const after = withTrigger(before, trigger('c'))!

    expect(ids(flattenFeed(after.pages))).toEqual(['c', 'b', 'a', 'z'])
    expect(after.pages.map((p) => p.next_cursor)).toEqual(['c0', null])
    expect(after.pageParams).toBe(before.pageParams)
  })

  it('leaves a feed that already has it exactly as it was, on any page', () => {
    const before = feed([trigger('b')], [trigger('a')])
    expect(withTrigger(before, trigger('b'))).toBe(before)
    expect(withTrigger(before, trigger('a'))).toBe(before)
  })

  it('does not start a feed nobody has loaded', () => {
    expect(withTrigger(undefined, trigger('a'))).toBeUndefined()
  })
})

describe('withRecent', () => {
  it('keeps the latest few, newest first', () => {
    const five = ['e', 'd', 'c', 'b', 'a'].map((id) => trigger(id))
    expect(ids(withRecent(five, trigger('f'))!)).toEqual(['f', 'e', 'd', 'c', 'b'])
  })

  it('ignores one it already shows, and one nobody loaded', () => {
    const recent = [trigger('a')]
    expect(withRecent(recent, trigger('a'))).toBe(recent)
    expect(withRecent(undefined, trigger('a'))).toBeUndefined()
  })
})

describe('a Trigger arriving over the socket', () => {
  let invalidate: MockInstance<typeof queryClient.invalidateQueries>

  beforeEach(() => {
    invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  })

  it('lands in History without asking the server', () => {
    queryClient.setQueryData(TRIGGERS_QUERY_KEY, feed([trigger('a')]))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    applyTrigger(frame(trigger('b')))

    expect(feedIds()).toEqual(['b', 'a'])
    expect(fetch).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: TRIGGERS_QUERY_KEY })
  })

  // The ticket's dedupe: the same Trigger from the socket and from a page.
  it('is shown once when a page from the server carries it too', () => {
    queryClient.setQueryData(TRIGGERS_QUERY_KEY, feed([trigger('a')]))

    applyTrigger(frame(trigger('b')))
    // the next page load, from the server, already has it
    queryClient.setQueryData(TRIGGERS_QUERY_KEY, (old: Feed | undefined) => ({
      ...old!,
      pages: [...old!.pages, { items: [trigger('b'), trigger('a')], next_cursor: null }],
    }))

    expect(feedIds()).toEqual(['b', 'a'])
  })

  it('is shown once when the page brought it first', () => {
    queryClient.setQueryData(TRIGGERS_QUERY_KEY, feed([trigger('b'), trigger('a')]))
    const before = queryClient.getQueryData(TRIGGERS_QUERY_KEY)

    applyTrigger(frame(trigger('b')))

    expect(queryClient.getQueryData(TRIGGERS_QUERY_KEY)).toBe(before)
  })

  it("reaches its own Alert's lists, and no other Alert's", () => {
    queryClient.setQueryData(feedKey('alert-1'), feed([trigger('a')]))
    queryClient.setQueryData(feedKey('alert-2'), feed([trigger('x', 'alert-2')]))
    queryClient.setQueryData(recentKey('alert-1'), [trigger('a')])

    applyTrigger(frame(trigger('b')))

    expect(feedIds(feedKey('alert-1'))).toEqual(['b', 'a'])
    expect(feedIds(feedKey('alert-2'))).toEqual(['x'])
    expect(ids(queryClient.getQueryData<Trigger[]>(recentKey('alert-1'))!)).toEqual(['b', 'a'])
  })

  it('leaves unloaded lists unloaded', () => {
    applyTrigger(frame(trigger('b')))

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  // A `once` Alert has just Completed; its badge is the server's to derive.
  it('asks for the Alerts list again', () => {
    applyTrigger(frame(trigger('b')))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ALERTS_QUERY_KEY })
  })

  it('leaves the list alone while a pause or delete is in flight, whose refetch follows', () => {
    vi.spyOn(queryClient, 'isMutating').mockImplementation((filters) =>
      filters?.mutationKey === ALERTS_WRITE_KEY ? 1 : 0,
    )

    applyTrigger(frame(trigger('b')))

    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ALERTS_QUERY_KEY })
  })
})

describe('recoverTriggers', () => {
  it('asks again for every list of Triggers, and for the Alerts', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

    recoverTriggers()

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['triggers'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ALERTS_QUERY_KEY })
  })
})
