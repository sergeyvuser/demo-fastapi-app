import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { i18n } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import type { Language } from '../i18n/language'
import { theme } from '../theme'
import { createTestI18n } from './i18n'

type Rendered = RenderResult & {
  // The typed helper the testing strategy asks for: a query goes through the
  // catalogue (`i18n.t('notFound.title')`), not through literal English, so a
  // copy edit does not turn forty tests red. The exception is a string whose
  // wording is itself a decision — there a literal in the test is the record.
  i18n: i18n
}

export function renderWithProviders(ui: ReactNode, language: Language = 'en'): Rendered {
  const instance = createTestI18n(language)
  // A cache per test, so no answer leaks from one into the next; and no
  // retries, so a failing request fails now rather than after the test.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return {
    i18n: instance,
    ...render(
      <I18nextProvider i18n={instance}>
        <QueryClientProvider client={queryClient}>
          <MantineProvider theme={theme}>{ui}</MantineProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    ),
  }
}
