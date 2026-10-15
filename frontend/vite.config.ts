import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Not "localhost": on Windows it may resolve to ::1 while the API is
    // published on IPv4 only.
    host: '127.0.0.1',
    // One origin in development too: the browser talks only to this server,
    // which forwards /api — and, with ws, the socket upgrade — to the API.
    // That is what lets the bundle carry relative paths and no base URL.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', ws: true },
    },
  },
  test: {
    // The application is a browser one: the language switch is storage plus a
    // re-render, and the one clock listens for `visibilitychange`.
    environment: 'jsdom',
    // jsdom costs a few hundred milliseconds to create, and the default pool
    // creates it again for every file — over half of the run. vmThreads builds
    // it once per worker and still gives every file a fresh window and fresh
    // modules. Not `isolate: false`: that shares module state across files,
    // and the session, the price store and the socket client all keep theirs
    // in module scope. The price of a VM realm: an error made by Node itself
    // (fs, a native fetch) fails `instanceof Error` here, so a test that fails
    // only under this pool is worth suspecting of that first.
    pool: 'vmThreads',
    // Time is rendered in the reader's own zone, so the output depends on the
    // machine. `test.env` cannot pin it — a documented hole: TZ set there does
    // not reach the threads pool — so it is set on the main process, which
    // every pool inherits. `environment.test.ts` asserts that it took.
    globalSetup: ['./vitest.globalSetup.ts'],
    setupFiles: ['./src/testing/setup.ts'],
  },
  build: {
    rolldownOptions: {
      // One bundle: no chunk can go missing after a deploy, so the stale-chunk
      // problem is deleted rather than handled. A dynamic import() is inlined
      // too, not split. Consequence: a future "new version available" prompt
      // has to ride a response header — the socket's message union is closed.
      output: { codeSplitting: false },
    },
  },
})
