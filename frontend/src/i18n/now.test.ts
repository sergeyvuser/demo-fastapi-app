import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getNow, subscribeToNow } from './now'

describe('the one clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-12T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs one interval however many readers there are', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    const first = vi.fn()
    const second = vi.fn()

    const unsubscribeFirst = subscribeToNow(first)
    const unsubscribeSecond = subscribeToNow(second)
    expect(spy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    unsubscribeSecond()
    spy.mockRestore()
  })

  it('stops when the last reader leaves', () => {
    const listener = vi.fn()

    subscribeToNow(listener)()
    vi.advanceTimersByTime(60_000)

    expect(listener).not.toHaveBeenCalled()
  })

  it('ticks immediately when the tab comes back', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToNow(listener)

    // A laptop asleep for an hour: the timer did not run, and waiting another
    // thirty seconds for every relative time to jump at once is the thing
    // this avoids.
    vi.setSystemTime(Date.parse('2026-10-12T13:00:00Z'))
    document.dispatchEvent(new Event('visibilitychange'))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getNow()).toBe(Date.parse('2026-10-12T13:00:00Z'))

    unsubscribe()
  })

  it('does not tick when the tab is hidden instead', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToNow(listener)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(listener).not.toHaveBeenCalled()

    vi.restoreAllMocks()
    unsubscribe()
  })
})
