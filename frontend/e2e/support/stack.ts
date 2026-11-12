// Where the e2e stack answers, as deploy/compose.ci.yaml publishes it. Each
// can be pointed elsewhere from the environment; the defaults are the stack
// `make e2e-up` brings up, so a plain `npx playwright test` needs none of them.

// The edge. playwright.config.ts uses the same variable for `baseURL`, and
// the API builds its mail links from APP_CONFIG__RUN__PUBLIC_URL — all three
// must be one string.
export const EDGE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8090'

// The broker, with the .env.example credentials the stack runs on. The test
// publishes Ticks here itself: no ingestor runs in this stack.
export const AMQP_URL = process.env.E2E_AMQP_URL ?? 'amqp://rabbit:change-me@127.0.0.1:5673'

// Mailpit's HTTP API. SMTP never leaves the compose project.
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8026'

// The demo account the seeder creates in this stack (compose.ci.yaml).
export const DEMO_EMAIL = 'demo@example.com'
