import { defineConfig, devices } from '@playwright/test'

// The e2e gate. It runs against the stack `make e2e-up` brings up — the
// deployable images behind the production Caddyfile — and starts no server
// of its own: a `webServer` here would be a second way of serving the app,
// and the gate exists to test the one that ships.
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  // One at a time, in CI and locally. Accounts are fresh per spec, but the
  // ticks exchange is global: a Tick for one Symbol reaches every Alert of
  // every User, so two specs pushing prices would fire each other's Alerts.
  // When the suite outgrows serial, partition by Symbol, not by worker.
  workers: 1,
  fullyParallel: false,
  // One retry in CI absorbs chance; none locally, where a flake should be
  // seen. A spec that keeps needing its retry is fixed or deleted — there is
  // no quarantine, because this gate blocks production.
  retries: CI ? 1 : 0,
  // A stray `test.only` would quietly turn the gate into one spec.
  forbidOnly: CI,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    // The edge as compose.ci.yaml publishes it, and the origin the API
    // builds its mail links from — the two must stay the same string.
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8090',
    // Not the application's language (that is seeded into localStorage) but
    // Intl's defaults: a Russian-configured machine formats 1 234,56 where
    // the runner formats 1,234.56.
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'on-first-retry',
  },
  // Chromium only: this gate protects production, not a browser matrix.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
