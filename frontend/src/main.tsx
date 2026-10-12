import '@mantine/core/styles.css'

import { MantineProvider } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import { queryClient } from './api/client'
import { App } from './App'
import { i18n } from './i18n'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={queryClient}>
                <MantineProvider>
                    <App />
                </MantineProvider>
            </QueryClientProvider>
        </I18nextProvider>
    </StrictMode>,
)
