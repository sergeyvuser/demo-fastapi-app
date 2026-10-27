import { describe, expect, it } from 'vitest'

import { flattenFeed, type Trigger, type TriggerPage } from './feed'

function trigger(id: string, triggeredAt: string): Trigger {
  return {
    id,
    alert_id: 'a',
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '1',
    price: '2',
    triggered_at: triggeredAt,
    delivery: 'queued',
  }
}

function page(...items: Trigger[]): TriggerPage {
  return { items, next_cursor: null }
}

const ids = (triggers: Trigger[]) => triggers.map((t) => t.id)

describe('flattenFeed', () => {
  it('joins the pages in the order they came', () => {
    const pages = [
      page(trigger('c', '2026-10-27T10:02:00Z'), trigger('b', '2026-10-27T10:01:00Z')),
      page(trigger('a', '2026-10-27T10:00:00Z')),
    ]
    expect(ids(flattenFeed(pages))).toEqual(['c', 'b', 'a'])
  })

  it('keeps the server order inside one instant rather than re-sorting by time', () => {
    const at = '2026-10-27T10:00:00Z'
    const pages = [page(trigger('z', at), trigger('m', at)), page(trigger('k', at))]
    expect(ids(flattenFeed(pages))).toEqual(['z', 'm', 'k'])
  })

  it('shows a Trigger that two sources carry once, where it first appeared', () => {
    // the socket wrote it into the head; the next page carries it too
    const pages = [
      page(trigger('new', '2026-10-27T10:05:00Z'), trigger('b', '2026-10-27T10:01:00Z')),
      page(trigger('new', '2026-10-27T10:05:00Z'), trigger('a', '2026-10-27T10:00:00Z')),
    ]
    expect(ids(flattenFeed(pages))).toEqual(['new', 'b', 'a'])
  })

  it('is empty for no pages and for empty pages', () => {
    expect(flattenFeed([])).toEqual([])
    expect(flattenFeed([page()])).toEqual([])
  })
})
