import js from '@eslint/js'
import i18next from 'eslint-plugin-i18next'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Derived from openapi.json by `npm run generate`: nobody edits it, and a
  // generator's output is not ours to style.
  { ignores: ['dist', 'src/api/generated'] },

  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // Type-aware: the rules that need to know what a value is — a floating
      // promise, a `?? ` that can never fire — cannot be written without the
      // types. The cost is that `npm run generate` must run first, as it
      // already does before the type-checker.
      tseslint.configs.recommendedTypeChecked,
      // `configs.flat.*`, not `configs.*`: the top-level ones are still in
      // the old format, where `plugins` is an array of names.
      reactHooks.configs.flat['recommended-latest'],
      i18next.configs['flat/recommended'],
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.browser,
    },
    rules: {
      // A guard leaves a route by throwing `redirect(...)` — the router's
      // own control flow, and a Response rather than an Error. That one type
      // is allowed by name; throwing any other non-Error stays a mistake.
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'package', package: '@tanstack/router-core', name: 'Redirect' }] },
      ],
      // Type parity guards keys somebody wrote; it says nothing about
      // <Button>Create alert</Button>, where there is no key at all — that
      // string breaks neither the build nor a test and simply stays English
      // in a Russian interface.
      //
      // `jsx-only` rather than the default `jsx-text-only`, because the
      // attributes are `placeholder`, `title` and `aria-label`, which is
      // exactly what a screen reader reads — and exactly why Mantine's
      // accessible labels are our own catalogue strings.
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            // A list given here replaces the plugin's own rather than adding
            // to it, so its documented entries are repeated first.
            exclude: [
              'className',
              'styleName',
              'style',
              'type',
              'key',
              'id',
              'width',
              'height',
              // Ours: an identifier a test queries by is not prose.
              'data-testid',
              // On a DOM element the rule checks only the attributes that
              // carry text; on a component it checks them all — and Mantine
              // takes its design tokens as props. `size="xs"` and
              // `color="gray"` are values from the theme, not words. The list
              // grows as screens arrive; what it must never swallow is
              // `label`, `description`, `error` or `placeholder`.
              // `component` is Mantine's polymorphism: an element name.
              '^(size|color|variant|radius|order|justify|align|gap|wrap|span|shadow|pos|display|c|bg|ta|fz|fw|lh|tt|td|ff|component)$',
              '^[pm][xytblrse]?$',
            ],
          },
        },
      ],
    },
  },

  {
    // A test asserts against the catalogue through the typed helper, and its
    // own probes are not screens.
    files: ['src/**/*.test.{ts,tsx}', 'src/testing/**'],
    rules: { 'i18next/no-literal-string': 'off' },
  },

  {
    // Configuration and Node-side files at the root: they need the
    // TypeScript parser, but none of the rules that ask the type checker —
    // they belong to the Node tsconfig, not to the application's.
    files: ['*.{js,ts}'],
    extends: [js.configs.recommended, tseslint.configs.base],
    languageOptions: { globals: globals.node },
  },
)
