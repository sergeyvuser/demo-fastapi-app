import { MantineProvider } from '@mantine/core'
import { render, type RenderResult } from '@testing-library/react'
import type { i18n } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import type { Language } from '../i18n/language'
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

    return {
        i18n: instance,
        ...render(
            <I18nextProvider i18n={instance}>
                <MantineProvider>{ui}</MantineProvider>
            </I18nextProvider>,
        ),
    }
}
