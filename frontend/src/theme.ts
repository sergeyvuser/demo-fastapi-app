import { createTheme, localStorageColorSchemeManager, Select } from '@mantine/core'

// The accent of vorobev.dev (palette "Aurora", oklch(0.48 0.1 175)), spread
// into Mantine's ten shades at the same hue. Not the built-in `teal`: that one
// sits at hue ~160, close to the green that means "the Condition holds" and
// "up against 24 hours ago" on this product's screens, and its default shade
// gives white text a contrast of 2.55. These clear WCAG AA at Mantine's own
// primaryShade (6 light, 8 dark): white on a filled button 4.62 and 8.22, a
// link 4.62 on white and 6.32 (shade 4) on the dark body.
const aurora = [
  '#e8faf4',
  '#cdf1e6',
  '#a7e3d2',
  '#7dcdb7',
  '#53b69e',
  '#379d86',
  '#11846e',
  '#006f5a',
  '#005a48',
  '#004436',
] as const

export const theme = createTheme({
  primaryColor: 'aurora',
  colors: { aurora },
  components: {
    Select: Select.extend({
      defaultProps: {
        // Anchored at the field's left edge, never centred under it. Centring
        // needs the dropdown's own width, which is not measured on the first
        // frame: the dropdown then starts at mid-screen at full width, sticks
        // out past the right edge, and a phone answers the wider page by
        // jumping to the top — taking the field off screen, so the dropdown
        // that follows it hides. Aligned to the start it needs no width, and
        // at full field width it lands in the same place.
        comboboxProps: { position: 'bottom-start' },
      },
    }),
  },
})

// Beside `alerts.language`, under the same prefix: both are choices that
// belong to one browser, never to a User.
export const COLOR_SCHEME_STORAGE_KEY = 'alerts.colorScheme'

export const colorSchemeManager = localStorageColorSchemeManager({
  key: COLOR_SCHEME_STORAGE_KEY,
})
