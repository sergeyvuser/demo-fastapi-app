import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router'

import { isAlertId, validateAlertsSearch } from './alerts/list'
import { bootSession, getSession, subscribeToSession, type Session } from './api/session'
import { NotFound } from './NotFound'
import { EditAlert, NewAlert } from './screens/AlertForm'
import { Alerts } from './screens/Alerts'
import { History } from './screens/History'
import { Landing } from './screens/Landing'
import { Account } from './screens/placeholders'
import { SignIn } from './screens/SignIn'
import { SignUp } from './screens/SignUp'
import { Verify } from './screens/Verify'
import { AppShell } from './shell/AppShell'
import { BannerSlot } from './shell/BannerSlot'
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

export type VerifySearch = {
  token?: string
}

// Public: the letter is opened in whatever browser the mail client picks,
// signed in or not, and the token alone is the proof.
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify',
  validateSearch: (search: Record<string, unknown>): VerifySearch => ({
    // The router parses query values as JSON, so a token of digits alone
    // would arrive as a number; only a string can be one the API minted.
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: Verify,
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
      <BannerSlot />
      <Outlet />
    </>
  )
}

const alertsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/alerts',
  // the list's filters, grouping and Symbol choice, so a reload, the back
  // button and a pasted link all keep them
  validateSearch: validateAlertsSearch,
  component: Alerts,
})

// One Alert, opened beside the list. A child of the list's route, so the
// filters in the URL survive opening and closing it, and with no component of
// its own: the list screen reads the id and decides where the panel goes —
// beside the list on a wide screen, under the card on a phone.
const alertRoute = createRoute({
  getParentRoute: () => alertsRoute,
  path: '$id',
})

export type NewAlertSearch = {
  // the Alert a clone starts from
  from?: string
}

// A route rather than a modal, so a clone is a link: `/alerts/new?from=<id>`.
// An id that is not shaped like one is dropped, and the form opens empty.
// Static, so it outranks `/alerts/$id` for the path `/alerts/new`.
const newAlertRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/alerts/new',
  validateSearch: (search: Record<string, unknown>): NewAlertSearch => ({
    from: isAlertId(search.from) ? search.from : undefined,
  }),
  component: NewAlert,
})

const editAlertRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/alerts/$id/edit',
  component: EditAlert,
})

export type HistorySearch = {
  // narrowed to one Alert: "See all in History" from that Alert's screen
  alert?: string
}

const historyRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: '/history',
  validateSearch: (search: Record<string, unknown>): HistorySearch => ({
    alert: isAlertId(search.alert) ? search.alert : undefined,
  }),
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
  verifyRoute,
  signedInRoute.addChildren([
    alertsRoute.addChildren([alertRoute]),
    newAlertRoute,
    editAlertRoute,
    historyRoute,
    accountRoute,
  ]),
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
