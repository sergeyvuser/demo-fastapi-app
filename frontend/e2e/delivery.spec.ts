import { expect, test, type APIResponse } from '@playwright/test'

// Journey 5: the delivery invariants. No browser — only the `request`
// fixture, because each of these is a fact about what the edge answers, and
// all of them are true the moment a bundle is served.
//
// What ties them together is the catch-all at the bottom of the Caddyfile:
// every path the edge does not claim lands on the frontend, which answers
// anything that is not a file with the app shell and a 200. That is right
// for a route of the app and wrong for everything else, so each test below
// pins one side of that line. Reverse the catch-all — or let a route slip
// past it — and a test goes red here instead of a demo going strange.

// The entry document: the one element the bundle mounts into. Matching on it
// rather than on the title survives a copy edit and fails on any other page.
const SHELL_MARKER = '<div id="root"></div>'

async function isShell(response: APIResponse): Promise<boolean> {
  return (await response.text()).includes(SHELL_MARKER)
}

test('a missing asset is a real 404, not the app shell', async ({ request }) => {
  // Answered with the shell, a stale asset name after a deploy would surface
  // in the browser as an unreadable MIME-type error instead of a missing file.
  const response = await request.get('/assets/does-not-exist-0000.js')

  expect(response.status()).toBe(404)
  expect(await isShell(response)).toBe(false)
})

test('an unknown route is a 200 carrying the app, which renders its own NotFound', async ({
  request,
}) => {
  // Which paths exist is the router's knowledge; the server hands over the
  // shell and the app decides. Rendering the NotFound screen itself needs a
  // browser — what can be proved here is that the app got the chance.
  const response = await request.get('/no-such-page/at-all')

  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/html')
  expect(await isShell(response)).toBe(true)
})

test('the API answers under /api, its documentation included', async ({ request }) => {
  const docs = await request.get('/api/docs')
  expect(docs.status()).toBe(200)
  expect(await isShell(docs)).toBe(false)

  const schema = await request.get('/api/openapi.json')
  expect(schema.status()).toBe(200)
  expect(await schema.json()).toHaveProperty('openapi')

  // An unknown API path is the API's own 404 in JSON — not the shell, which
  // would hand a fetch() an HTML page with a 200.
  const unknown = await request.get('/api/v1/no-such-endpoint')
  expect(unknown.status()).toBe(404)
  expect(unknown.headers()['content-type']).toContain('application/json')
})

// Paths that exist inside the compose network and must not admit to existing
// outside it. Without the edge's blocks they would fall into the catch-all and
// answer 200 with the shell — an outside uptime check on /healthz would then
// report a dead API as alive. `/asyncapi.json` is the schema that once
// published the broker's password.
for (const path of ['/healthz', '/readyz', '/metrics', '/internal/anything', '/asyncapi.json']) {
  test(`${path} is a 404 at the edge`, async ({ request }) => {
    const response = await request.get(path)

    expect(response.status()).toBe(404)
    expect(await isShell(response)).toBe(false)
  })
}
