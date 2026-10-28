import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api/problem'
import { deleteAlert, restoreAlert, withoutAlert, withStatus } from './actions'
import type { Alert } from './list'

function alert(id: string, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: '70000.00000000',
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    status: 'active',
    last_triggered_at: null,
    finished_at: null,
    expires_at: null,
    trigger_count: 0,
    created_at: '2026-10-20T10:00:00Z',
    ...overrides,
  }
}

describe('the optimistic list', () => {
  const list = [alert('a'), alert('b', { status: 'paused' })]

  it('changes one Alert’s Status and leaves the others alone', () => {
    const next = withStatus(list, 'a', 'paused')
    expect(next.map((item) => item.status)).toEqual(['paused', 'paused'])
    // a new list, so the cache sees a change; the untouched Alert is the same object
    expect(next).not.toBe(list)
    expect(next[1]).toBe(list[1])
  })

  it('removes an Alert, and puts it back exactly once', () => {
    const removed = withoutAlert(list, 'a')
    expect(removed.map((item) => item.id)).toEqual(['b'])
    expect(restoreAlert(removed, list[0]).map((item) => item.id)).toEqual(['b', 'a'])
    // restoring twice — two failed deletes of one card — still yields one card
    expect(restoreAlert(list, list[0]).filter((item) => item.id === 'a')).toHaveLength(1)
  })
})

describe('deleteAlert', () => {
  afterEach(() => vi.unstubAllGlobals())

  function answer(response: Response) {
    vi.stubGlobal('fetch', () => Promise.resolve(response))
  }

  it('succeeds on a 404: the row is gone, which is what was asked for', async () => {
    answer(Response.json({ detail: 'Alert not found' }, { status: 404 }))
    await expect(deleteAlert('a')).resolves.toBeUndefined()
  })

  it('fails on anything else', async () => {
    answer(Response.json({ detail: 'Internal error' }, { status: 500 }))
    await expect(deleteAlert('a')).rejects.toBeInstanceOf(ApiError)
  })
})
