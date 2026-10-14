import { Container, Group, AppShell as MantineAppShell, Skeleton } from '@mantine/core'
import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useSession } from '../api/session'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { ColorSchemeToggle } from './ColorSchemeToggle'
import { AnchorLink, ButtonLink } from './links'
import { UserMenu } from './UserMenu'

// One shell for every screen, public or not: the header and the footer are
// the frame, and what the header carries follows the session.
export function AppShell() {
  return (
    <MantineAppShell header={{ height: 56 }} footer={{ height: 48 }} padding="md">
      <MantineAppShell.Header>
        <Header />
      </MantineAppShell.Header>
      <MantineAppShell.Main>
        {/* the grid the prototype measured: content capped and centred, the
            header on the same column */}
        <Container size={1440} p={0}>
          <Outlet />
        </Container>
      </MantineAppShell.Main>
      {/* A setting changed once does not earn a slot in the header. This
          footer is temporary: impl 21 gives the public screens their own,
          and impl 29 puts the same switch on Account. */}
      <MantineAppShell.Footer px="md">
        <Group h="100%" justify="flex-end">
          <LanguageSwitch />
        </Group>
      </MantineAppShell.Footer>
    </MantineAppShell>
  )
}

function Header() {
  const { t } = useTranslation()
  const { status } = useSession()
  const signedIn = status === 'authenticated'

  return (
    <Container size={1440} h="100%" px="md">
      <Group h="100%" justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="md" wrap="nowrap">
          <AnchorLink
            to={signedIn ? '/alerts' : '/'}
            underline="never"
            c="inherit"
            fw={700}
            fz="lg"
            style={{ whiteSpace: 'nowrap' }}
          >
            {t('common.productName')}
          </AnchorLink>
          {/* Two destinations at every width; Account sits behind the user
              menu, and New Alert is a button on its own screen, never a link
              here (ticket 13 measured why: three items and the brand do not
              fit at 375 px). */}
          {signedIn && (
            <Group component="nav" gap={4} wrap="nowrap" aria-label={t('shell.navigation')}>
              <NavItem to="/alerts" label={t('shell.alerts')} />
              <NavItem to="/history" label={t('shell.history')} />
            </Group>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <ColorSchemeToggle visibleFrom={signedIn ? 'sm' : undefined} />
          {status === 'pending' && <Skeleton height={32} width={32} circle />}
          {status === 'anonymous' && (
            <ButtonLink to="/login" variant="subtle" size="sm">
              {t('shell.signIn')}
            </ButtonLink>
          )}
          {signedIn && <UserMenu />}
        </Group>
      </Group>
    </Container>
  )
}

function NavItem({ to, label }: { to: '/alerts' | '/history'; label: string }) {
  return (
    <ButtonLink
      to={to}
      size="sm"
      px="xs"
      variant="subtle"
      color="gray"
      // the router's own active state, restyled: filled in the brand colour
      activeProps={{ variant: 'light', color: undefined }}
    >
      {label}
    </ButtonLink>
  )
}
