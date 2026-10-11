import type { Middleware } from 'openapi-fetch'

import { ApiError, parseProblem } from './problem'
import { getAccessToken, refreshSession } from './session'

// A Request's body is a stream and can be read once, so the request that was
// sent cannot be sent again. A copy is taken before it leaves, keyed by the
// id openapi-fetch gives every call.
const unsent = new Map<string, Request>()

export const authMiddleware: Middleware = {
  onRequest({ request, id }) {
    const token = getAccessToken()
    if (token) request.headers.set('Authorization', bearer(token))
    unsent.set(id, request.clone())
    return request
  },

  async onResponse({ response, id }) {
    const spare = unsent.get(id)
    unsent.delete(id)

    const sentWith = spare?.headers.get('Authorization')
    // A 401 to a request that carried no token is an answer (wrong password),
    // not a lapsed session.
    if (response.status === 401 && spare && sentWith) {
      const current = getAccessToken()
      // Another request may have refreshed while this one was in the air.
      const stale = current !== null && bearer(current) !== sentWith
      const token = stale ? current : await refreshSession()
      if (token) {
        spare.headers.set('Authorization', bearer(token))
        // Once. A second 401 falls through and is thrown like any error.
        response = await fetch(spare)
      }
    }

    if (!response.ok) throw new ApiError(parseProblem(response.status, await body(response)))
    return response
  },

  onError({ id }) {
    unsent.delete(id)
  },
}

function bearer(token: string): string {
  return `Bearer ${token}`
}

async function body(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}