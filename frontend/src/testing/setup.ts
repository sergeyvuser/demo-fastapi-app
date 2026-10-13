// Matchers that read like the assertion they make (`toBeChecked`,
// `toBeInTheDocument`), and the types that come with them.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Testing Library unmounts after each test by itself only when Vitest's
// globals are on, and they are off here — every test imports what it uses.
// Without this, a second render finds the first one's elements still in the
// document and a query that should match once matches twice.
afterEach(cleanup)

// jsdom implements no media queries at all, and Mantine's provider asks for
// the colour-scheme one on mount. Answering "no" for everything is the honest
// stub: this application ships one theme. Deliberately not typed as a whole
// `MediaQueryList` — that interface still carries the deprecated
// addListener/removeListener pair, and nothing here calls them.
vi.stubGlobal('matchMedia', (query: string) => ({
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
vi.stubGlobal(
    'ResizeObserver',
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
)
