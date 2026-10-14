import { AppShell, Group, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { LanguageSwitch } from './i18n/LanguageSwitch'
import { NotFound } from './NotFound'

// Until the router arrives (impl 19) the only known address is the root;
// everything else is the app's own NotFound — served with a 200 by the proxy.
export function App() {
  const { t } = useTranslation()
  const isHome = window.location.pathname === '/'

  return (
    <AppShell header={{ height: 56 }} footer={{ height: 48 }} padding="md">
      <AppShell.Header px="md" style={{ display: 'flex', alignItems: 'center' }}>
        <Title order={1} size="h3">
          {t('common.productName')}
        </Title>
      </AppShell.Header>
      <AppShell.Main>{isHome ? null : <NotFound />}</AppShell.Main>
      {/* A setting changed once does not earn a slot in the header. This
            footer is temporary: impl 21 gives the public screens their own,
            and impl 29 puts the same switch on Account. */}
      <AppShell.Footer px="md">
        <Group h="100%" justify="flex-end">
          <LanguageSwitch />
        </Group>
      </AppShell.Footer>
    </AppShell>
  )
}
