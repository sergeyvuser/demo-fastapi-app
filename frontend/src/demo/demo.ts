import { $api } from '../api/client'

// The published Demo account, narrowed: either all three facts or nothing.
// The endpoint always answers the same four keys and nulls the three when the
// account is off, so `enabled` alone decides — the rest is for the type.
export type PublishedDemo = {
  email: string
  password: string
  resetsAt: string
}

// A moment past the reset before asking again. The server answers the *next*
// reset, strictly in the future, so a clock running slightly ahead of the
// server's would otherwise ask while the old answer is still the true one.
const AFTER_RESET_MS = 5_000

// One query for the Landing and the banner alike. Nothing here is a timer of
// its own: the next answer is asked for once, just after the reset it names,
// which is what moves "resets in 1 hour" on to tomorrow in a tab left open.
export function useDemo(): PublishedDemo | null {
  const { data } = $api.useQuery('get', '/api/v1/demo', undefined, {
    refetchInterval: (query) => {
      const at = query.state.data?.resets_at
      return at ? Math.max(Date.parse(at) - Date.now(), 0) + AFTER_RESET_MS : false
    },
  })

  // Loading, failed or switched off all read the same: there is no account to
  // offer, and the button is absent rather than pointing at nothing.
  if (!data?.enabled || !data.email || !data.password || !data.resets_at) return null
  return { email: data.email, password: data.password, resetsAt: data.resets_at }
}
