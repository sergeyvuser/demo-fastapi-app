// Matchers that read like the assertion they make (`toBeChecked`,
// `toBeInTheDocument`), and the types that come with them.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library unmounts after each test by itself only when Vitest's
// globals are on, and they are off here — every test imports what it uses.
// Without this, a second render finds the first one's elements still in the
// document and a query that should match once matches twice.
afterEach(cleanup)

// Installed as plain properties, not with `vi.stubGlobal`: a test that stubs
// `fetch` and calls `vi.unstubAllGlobals()` afterwards would remove these too,
// and every later render in that file would die inside Mantine.
function installGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

// jsdom implements no media queries at all, and Mantine's provider asks for
// the colour-scheme one on mount. Answering "no" for everything reads as a
// system that prefers the light scheme, which is what "auto" then resolves
// to. Deliberately not typed as a whole `MediaQueryList` — that interface
// still carries the deprecated addListener/removeListener pair, and nothing
// here calls them.
installGlobal('matchMedia', (query: string) => ({
  media: query,
  matches: false,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}))

// Nor does jsdom implement element measurement, and Mantine's
// SegmentedControl measures the control it slides its indicator over. Nothing
// is asserted about the indicator's position, so a stub that observes nothing
// is enough — but without it the component throws on mount.
installGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
