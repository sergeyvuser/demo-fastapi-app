import { AppShell, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { NotFound } from './NotFound'

// Until the router arrives (impl 19) the only known address is the root;
// everything else is the app's own NotFound — served with a 200 by the proxy.
export function App() {
    const { t } = useTranslation()
    const isHome = window.location.pathname === '/'

    return (
        <AppShell header={{ height: 56 }} padding="md">
            <AppShell.Header px="md" style={{ display: 'flex', alignItems: 'center' }}>
                <Title order={1} size="h3">
                    {t('common.productName')}
                </Title>
            </AppShell.Header>
            <AppShell.Main>{isHome ? null : <NotFound />}</AppShell.Main>
        </AppShell>
    )
}
