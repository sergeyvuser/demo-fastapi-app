import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import { queryClient } from './api/client'
import { bootSession } from './api/session'
import { i18n } from './i18n'
import { createSessionRouter } from './router'
import { colorSchemeManager, theme } from './theme'

// Before the first render, not from inside it: every page load starts with a
// refresh, and the Landing has no reason to be the one that triggers it. The
// signed-in guard awaits this same promise; nothing else waits for it.
void bootSession()

const router = createSessionRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MantineProvider
          theme={theme}
          colorSchemeManager={colorSchemeManager}
          defaultColorScheme="auto"
        >
          <Notifications />
          <RouterProvider router={router} />
        </MantineProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
)
