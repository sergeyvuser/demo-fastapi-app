import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router'

import { bootSession, getSession, subscribeToSession, type Session } from './api/session'
import { NotFound } from './NotFound'
import { Landing } from './screens/Landing'
import { Account, Alerts, History } from './screens/placeholders'
import { SignIn } from './screens/SignIn'
import { SignUp } from './screens/SignUp'
import { AppShell } from './shell/AppShell'
import { ContentSkeleton } from './shell/ContentSkeleton'

// What the guards read. Passed in rather than imported, so a test can hand
// the router a boot that never settles and see what renders meanwhile.
export type RouterContext = {
  session: {
    boot: () => Promise<void>
    current: () => Session
  }
}

// Where a person was heading, carried through the sign-in screen and back. It
// arrives in the URL, so it is attacker-controlled: only a path on this origin
// is accepted. `//evil.example` is a path to the eye and another host to the
// browser, and `/\evil.example` is the same thing on some of them.
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) return undefined
  if (value.startsWith('//') || value.startsWith('/\\')) return undefined
  return value
}

export type SignInSearch = {
  redirect?: string
  // why the person is here, when there is a why: the session ran out
  expired?: true
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
  notFoundComponent: NotFound,
})

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Landing,
})

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    redirect: safeRedirect(search.redirect),
    expired: search.expired === true ? true : undefined,
  }),
  component: SignIn,
})

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: SignUp,
})

// A layout with an id instead of a path: it adds nothing to the URL, only the
// guard and the banner slot to everything under it.
const signedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'signed-in',
  // The only place that waits for the boot refresh. Everything outside this
  // subtree — the Landing above all — renders without it.
  beforeLoad: async ({ context, location }) => {
    await context.session.boot()
    const session = context.session.current()
    if (session.status !== 'authenticated') {
      throw redirect({
        to: '/login',
        search: { redirect: location.href, expired: session.expired || undefined },
      })
    }
  },
  // The router's default is a second's grace before showing anything, which
  // here would be a second of an empty main area under a live header.
  pendingMs: 0,
  pendingComponent: ContentSkeleton,
  component: SignedInLayout,
})

function SignedInLayout() {
  return (
    <>
      {/* The banner slot. Ticket 20's "verify your address" and ticket 23's
          "this account is shared" both land here, and the demo account is
          always verified, so the two never compete for it. */}
      <Outlet />
    </>
  )
}

const alertsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/alerts',
  component: Alerts,
})

const historyRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/history',
  component: History,
})

const accountRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/account',
  component: Account,
})

const routeTree = rootRoute.addChildren([
  landingRoute,
  signInRoute,
  signUpRoute,
  signedInRoute.addChildren([alertsRoute, historyRoute, accountRoute]),
])

export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({ routeTree, context, history })
}

// The application's own, wired to the real session. A test builds its own
// with `createAppRouter` and never touches this one.
export function createSessionRouter() {
  const router = createAppRouter({ session: { boot: bootSession, current: getSession } })
  // A session lost while a signed-in screen is open — a refresh refused, a
  // sign-out — re-runs the guards, and the guard is what moves the person.
  // Only the loss matters: gaining a session is followed by a navigation the
  // screen that gained it makes itself.
  subscribeToSession(() => {
    if (getSession().status === 'anonymous') void router.invalidate()
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
