import { test as base } from '@playwright/test'

import { newAccount, register, signInThroughApi, verify, type Account } from './support/accounts.ts'
import { Ticks } from './support/ticks.ts'

// What the journeys stand on. Import `test` and `expect` from here, not from
// @playwright/test, in every spec that drives the browser.

type SpecFixtures = {
  // A fresh, verified account, already signed in to the browser context: the
  // refresh cookie is in the jar and the first page load runs the
  // application's own boot refresh from it.
  account: Account
}

type WorkerFixtures = {
  // One broker connection per worker — there is one worker (see
  // playwright.config.ts), and the exchange is global anyway.
  ticks: Ticks
}

export const test = base.extend<SpecFixtures, WorkerFixtures>({
  // Every context starts in English, whatever the machine. The application
  // reads its language from this key (src/i18n/language.ts) before anything
  // renders. Passed as source text: it runs in the page, and this file is
  // type-checked against Node, which has no `window`.
  //
  // An init script runs in every document of the page — the blank one a new
  // tab starts with included. That one has an opaque origin, and touching its
  // localStorage throws a SecurityError into the console; the document of the
  // app, which is the one that matters, gets the key.
  context: async ({ context }, use) => {
    await context.addInitScript({
      content: "try { localStorage.setItem('alerts.language', 'en') } catch {}",
    })
    await use(context)
  },

  account: async ({ context }, use) => {
    const account = newAccount()
    // The registration and verification calls go through the same jar, but
    // neither sets a cookie; only the sign-in does.
    await register(context.request, account)
    await verify(context.request, account)
    await signInThroughApi(context, account)
    await use(account)
  },

  ticks: [
    // Playwright reads a fixture's dependencies from the destructuring
    // pattern of its first argument, so "none" must be written as `{}`.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const ticks = await Ticks.open()
      await use(ticks)
      await ticks.close()
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'
