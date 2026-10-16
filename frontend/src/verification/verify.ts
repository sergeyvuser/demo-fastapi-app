import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../api/client'
import { ApiError } from '../api/problem'

// The three ways a link from the letter can turn out. Each one asks for a
// different next step, which is why they are told apart at all.
export type Outcome = 'verified' | 'used' | 'expired'

// /users/me as openapi-react-query keys it: invalidating this prefix is what
// takes the banner down once the address is confirmed.
const ME = ['get', '/api/v1/users/me']

export async function verifyAddress(token: string | undefined): Promise<Outcome> {
  // No token, or one the API could never have minted (it would answer 422):
  // either way the link is no use, and the way on is another letter.
  if (!token) return 'expired'
  try {
    await api.POST('/api/v1/auth/verify', { body: { verification_token: token } })
    return 'verified'
  } catch (error) {
    if (error instanceof ApiError) {
      // already spent, or the address was confirmed by another link
      if (error.status === 409) return 'used'
      // out of time, unknown, or malformed
      if (error.status === 410 || error.status === 422) return 'expired'
    }
    // the network, a 5xx: not an answer about the link at all
    throw error
  }
}

// A query rather than a mutation for one reason: the cache deduplicates. The
// call spends the token, so a second one — React's development double mount,
// a re-render — would turn "confirmed" into "already used" on the screen.
// Nothing may ask again on its own for the same reason: no refetch on focus,
// on reconnect, or for staleness.
export function useVerification(token: string | undefined) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['verification', token],
    queryFn: async () => {
      const outcome = await verifyAddress(token)
      if (outcome !== 'expired') void queryClient.invalidateQueries({ queryKey: ME })
      return outcome
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

// Asking for another letter. Signed-in only (impl 08): the address comes
// from the session, so there is nothing to type and nothing to enumerate.
export function useResendVerification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.POST('/api/v1/auth/resend-verification')
    },
    onError: (error) => {
      // 409: confirmed meanwhile, in another tab or by an older link
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ME })
      }
    },
  })
}
