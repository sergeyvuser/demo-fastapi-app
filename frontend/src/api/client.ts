import { QueryClient } from '@tanstack/react-query'
import createFetchClient from 'openapi-fetch'
import createClient from 'openapi-react-query'

import type { paths } from './generated/http'
import { authMiddleware } from './middleware'
import { ApiError } from './problem'

// No baseUrl: paths in the schema start at /api, and the bundle must not know
// its origin (ADR 0004).
export const api = createFetchClient<paths>()
api.use(authMiddleware)

export const $api = createClient(api)

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx is an answer and asking again gets the same one. Only a 5xx or
      // a network failure is worth another try.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
  },
})
