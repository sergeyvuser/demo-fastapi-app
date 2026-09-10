import {
  Alert as MantineAlert,
  Anchor,
  AppShell,
  Avatar,
  Badge,
  Box,
  Burger,
  Button,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconBellRinging } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { changePct, formatPrice, priceColor, SUBSCRIPTION } from '../fake/domain';
import type { Quotes } from '../fake/useTicker';
import type { Params, Screen } from '../prototype/params';
import { SymbolIcon } from './SymbolIcon';

// Two destinations, not three: New Alert is a button on the Alerts screen, at every width. A link
// in the navigation and a primary button on the screen it leads to are the same action twice.
const NAV: { key: Screen; label: string }[] = [
  { key: 'alerts', label: 'Alerts' },
  { key: 'history', label: 'History' },
];

interface Props {
  params: Params;
  update: (patch: Partial<Params>) => void;
  quotes: Quotes;
  showTicker: boolean;
  children: ReactNode;
}

/**
 * The application frame from ticket 03: three destinations, the ticker strip on every screen, and
 * the unverified banner over a read-only app. Shared by all variants — what differs is what each
 * one puts inside it.
 */
export function Shell({ params, update, quotes, showTicker, children }: Props) {
  const headerHeight = showTicker ? 92 : 56;

  return (
    <AppShell header={{ height: headerHeight }} padding="md">
      <AppShell.Header>
        {/* the header is capped and centred on the same grid as the content under it */}
        <Group h={56} px="md" justify="space-between" wrap="nowrap" maw={1440} mx="auto">
          <Group gap="sm" wrap="nowrap">
            <Burger size="sm" opened={false} hiddenFrom="sm" aria-label="Menu" />
            <Group gap={6} wrap="nowrap">
              <IconBellRinging size={20} />
              <Text fw={700} style={{ whiteSpace: 'nowrap' }}>
                Crypto Alerts
              </Text>
            </Group>
            <Group gap="md" visibleFrom="sm" ml="md">
              {NAV.map((item) => (
                <Anchor
                  key={item.key}
                  component="button"
                  type="button"
                  underline="never"
                  c={params.screen === item.key ? undefined : 'dimmed'}
                  fw={params.screen === item.key ? 600 : 400}
                  onClick={() => update({ screen: item.key })}
                >
                  {item.label}
                </Anchor>
              ))}
            </Group>
          </Group>

          <Group gap="xs" wrap="nowrap">
            {/* At 375 px only two destinations fit beside the brand; New Alert is reached from the
                screen's own button, which is where a phone user's thumb already is. */}
            <Group gap={4} hiddenFrom="sm" wrap="nowrap">
              {NAV.map((item) => (
                <Button
                  key={item.key}
                  size="compact-xs"
                  variant={params.screen === item.key ? 'light' : 'subtle'}
                  onClick={() => update({ screen: item.key })}
                >
                  {item.label}
                </Button>
              ))}
            </Group>
            <Tooltip label="demo@vorobev.dev">
              <Avatar size={28} radius="xl" color="blue">
                D
              </Avatar>
            </Tooltip>
          </Group>
        </Group>

        {showTicker && <TickerStrip quotes={quotes} live={params.live} />}
      </AppShell.Header>

      <AppShell.Main>
        {!params.verified && (
          <MantineAlert
            icon={<IconAlertTriangle size={18} />}
            color="yellow"
            variant="light"
            mb="md"
            title="Verify your e-mail to create Alerts"
          >
            <Group justify="space-between" gap="sm" wrap="wrap">
              <Text size="sm">
                We sent a link to demo@vorobev.dev. Until you follow it the app is read-only.
              </Text>
              <Button size="xs" variant="white">
                Send it again
              </Button>
            </Group>
          </MantineAlert>
        )}
        {/* a cap, because a card stretched across a 2560 px monitor is unreadable */}
        <Box pb={72} maw={1440} mx="auto">
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

function TickerStrip({ quotes, live }: { quotes: Quotes; live: boolean }) {
  return (
    <ScrollArea h={36} type="never" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Group gap="lg" px="md" h={36} wrap="nowrap" maw={1440} mx="auto" style={{ opacity: live ? 1 : 0.45 }}>
        {!live && (
          <Badge size="xs" color="gray" variant="light" style={{ flexShrink: 0 }}>
            reconnecting…
          </Badge>
        )}
        {SUBSCRIPTION.map((symbol) => {
          const quote = quotes[symbol];
          const change = changePct(symbol, quote.price);
          return (
            <Group key={symbol} gap={5} wrap="nowrap" style={{ flexShrink: 0 }}>
              <SymbolIcon symbol={symbol} size={18} />
              <Text size="xs" c="dimmed" fw={600}>
                {symbol.replace('USDT', '')}
              </Text>
              {/* coloured against the 24 h reference, like an exchange's ticker — not by the
                  direction of the last Tick, which is the trades list's job and flickers */}
              <Text size="xs" fw={600} c={priceColor(symbol, quote.price)}>
                {quote.price === null ? '—' : formatPrice(quote.price)}
              </Text>
              {change !== null && (
                <Text size="xs" c={change >= 0 ? 'teal' : 'red'}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(2)}%
                </Text>
              )}
            </Group>
          );
        })}
      </Group>
    </ScrollArea>
  );
}
