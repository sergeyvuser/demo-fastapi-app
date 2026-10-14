import { Box, Container, Group, AppShell as MantineAppShell, Skeleton } from '@mantine/core'
import { Outlet, useMatches } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useSession } from '../api/session'
import { useSymbolsFeed } from '../prices/feed'
import { STRIP_HEIGHT, TickerStrip } from '../prices/TickerStrip'
import { ColorSchemeToggle } from './ColorSchemeToggle'
import { PublicFooter, SignedInFooter } from './Footer'
import { AnchorLink, ButtonLink } from './links'
import { UserMenu } from './UserMenu'

const HEADER_HEIGHT = 56

// One shell for every screen, public or not: the header and the footer are
// the frame, and what the header carries follows the session.
export function AppShell() {
  // Once, here: the strip is on every screen, so its feed is too.
  useSymbolsFeed()
  const signedInScreen = useMatches({
    select: (matches) => matches.some((match) => match.routeId === '/signed-in'),
  })

  return (
    <MantineAppShell header={{ height: HEADER_HEIGHT + STRIP_HEIGHT }} padding="md">
      <MantineAppShell.Header>
        <Header />
        <Box bg="var(--mantine-color-default-hover)">
          <Container size={1440} p={0}>
            <TickerStrip />
          </Container>
        </Box>
      </MantineAppShell.Header>
      {/* A column, so a short screen still puts its footer at the bottom of
          the window. The footer is in the flow, not fixed: four links and a
          switch need two rows at 375 px, and a fixed footer that tall would
          take a sixth of a phone's screen for good. */}
      <MantineAppShell.Main style={{ display: 'flex', flexDirection: 'column' }}>
        {/* the grid the prototype measured: content capped and centred, the
            header on the same column */}
        <Container size={1440} p={0} w="100%" style={{ flex: 1 }}>
          <Outlet />
        </Container>
        <Container size={1440} p={0} w="100%">
          {signedInScreen ? <SignedInFooter /> : <PublicFooter />}
        </Container>
      </MantineAppShell.Main>
    </MantineAppShell>
  )
}

function Header() {
  const { t } = useTranslation()
  const { status } = useSession()
  const signedIn = status === 'authenticated'

  return (
    <Container size={1440} h={HEADER_HEIGHT} px="md">
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
