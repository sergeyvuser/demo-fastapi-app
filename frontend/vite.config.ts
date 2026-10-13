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
    // Time is rendered in the reader's own zone, so the output depends on the
    // machine. `test.env` cannot pin it — a documented hole: TZ set there does
    // not reach the threads pool — so it is set on the main process, which
    // every pool inherits. `environment.test.ts` asserts that it took.
    globalSetup: ['./vitest.globalSetup.ts'],
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
