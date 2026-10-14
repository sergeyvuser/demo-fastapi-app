import { QueryClient } from '@tanstack/react-query'
import createFetchClient from 'openapi-fetch'
import createClient from 'openapi-react-query'

import type { paths } from './generated/http'
import { authMiddleware } from './middleware'
import { ApiError } from './problem'

// No baseUrl: paths in the schema start at /api, and the bundle must not know
// its origin (ADR 0004).
// `fetch` is looked up on every call rather than captured once: openapi-fetch
// keeps whichever function it saw at creation, and a test that stubs the
// global afterwards would otherwise talk to the real one.
export const api = createFetchClient<paths>({ fetch: (request) => fetch(request) })
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
