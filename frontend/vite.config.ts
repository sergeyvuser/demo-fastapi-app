import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
