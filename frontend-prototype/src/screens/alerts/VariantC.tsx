import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Menu,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconBellPlus,
  IconChevronDown,
  IconCopy,
  IconDots,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react';
import { useState } from 'react';
import {
  conditionWord,
  distancePct,
  formatPrice,
  formatRelative,
  isFinished,
  repeatLabel,
  type Alert,
} from '../../fake/domain';
import type { Quotes } from '../../fake/useTicker';

/**
 * VARIANT C — a board grouped by state, where each Alert draws the gap between price and Threshold
 * as a short axis.
 *
 * Answers: the distance is a picture rather than a percentage, so a row is read at a glance instead
 * of compared digit by digit; a Tick moves the marker and nothing flashes; Paused and Finished are
 * their own sections, Finished collapsed and offering Clone; the Trigger history is a caption on
 * each row ("3 Triggers, last 8 minutes ago") and nowhere else. This variant also drops the ticker
 * strip: every row already carries its Symbol's live price.
 */
export function VariantC({
  alerts,
  quotes,
  live,
  onNew,
}: {
  alerts: Alert[];
  quotes: Quotes;
  live: boolean;
  onNew: () => void;
}) {
  const active = alerts.filter((a) => a.state === 'active');
  const paused = alerts.filter((a) => a.state === 'paused');
  const finished = alerts.filter(isFinished);

  if (alerts.length === 0) return <EmptyState onNew={onNew} />;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2} size="h3">
          Alerts
        </Title>
        <Button leftSection={<IconBellPlus size={16} />} onClick={onNew}>
          New Alert
        </Button>
      </Group>

      <Section title="Watching" count={active.length}>
        <Stack gap="xs">
          {active.map((alert) => (
            <AlertRow key={alert.id} alert={alert} quotes={quotes} live={live} />
          ))}
        </Stack>
      </Section>

      {paused.length > 0 && (
        <Section title="Paused" count={paused.length} hint="Switched off by you. No Triggers until resumed.">
          <Stack gap="xs">
            {paused.map((alert) => (
              <AlertRow key={alert.id} alert={alert} quotes={quotes} live={live} />
            ))}
          </Stack>
        </Section>
      )}

      {finished.length > 0 && (
        <CollapsedSection
          title="Finished"
          count={finished.length}
          hint="Ended by the system and cannot be resumed — clone one to watch that price again."
        >
          <Stack gap="xs">
            {finished.map((alert) => (
              <AlertRow key={alert.id} alert={alert} quotes={quotes} live={live} />
            ))}
          </Stack>
        </CollapsedSection>
      )}
    </Stack>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Group gap="xs" mb={6} align="baseline">
        <Text fw={700} size="sm" tt="uppercase" c="dimmed">
          {title}
        </Text>
        <Text size="sm" c="dimmed">
          {count}
        </Text>
      </Group>
      {hint && (
        <Text size="xs" c="dimmed" mb="xs">
          {hint}
        </Text>
      )}
      {children}
    </div>
  );
}

function CollapsedSection({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <UnstyledButton onClick={() => setOpen((o) => !o)} mb={6}>
        <Group gap="xs" align="baseline">
          <IconChevronDown
            size={14}
            style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 150ms' }}
          />
          <Text fw={700} size="sm" tt="uppercase" c="dimmed">
            {title}
          </Text>
          <Text size="sm" c="dimmed">
            {count}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Text size="xs" c="dimmed" mb="xs">
          {hint}
        </Text>
        {children}
      </Collapse>
    </div>
  );
}

function AlertRow({ alert, quotes, live }: { alert: Alert; quotes: Quotes; live: boolean }) {
  const quote = quotes[alert.symbol];
  const price = quote?.price ?? null;
  const distance = distancePct(alert, price);
  const holds = distance !== null && distance <= 0;

  return (
    <Paper withBorder radius="md" p="sm" opacity={isFinished(alert) ? 0.6 : 1}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Box style={{ minWidth: 96 }}>
          <Text fw={700}>{alert.symbol}</Text>
          <Text size="xs" c="dimmed">
            {conditionWord(alert.condition)} {formatPrice(alert.threshold)}
          </Text>
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }} visibleFrom="xs">
          <DistanceAxis alert={alert} price={price} live={live} />
        </Box>

        <Group gap={2} wrap="nowrap" align="flex-start">
          <Box style={{ textAlign: 'right', minWidth: 84 }}>
            <Text fw={600} c={price === null || !live ? 'dimmed' : holds ? 'teal' : undefined}>
              {price === null ? '—' : formatPrice(price)}
            </Text>
            <Text size="xs" c="dimmed">
              {distance === null ? 'no price' : holds ? 'condition holds' : `${distance.toFixed(2)}% away`}
            </Text>
          </Box>
          <RowMenu alert={alert} />
        </Group>
      </Group>

      <Box hiddenFrom="xs" mt="xs">
        <DistanceAxis alert={alert} price={price} live={live} />
      </Box>

      <Group gap="xs" mt={6} wrap="wrap">
        <Badge size="xs" variant="default">
          {repeatLabel(alert.repeat_policy)}
        </Badge>
        {alert.expires_at && (
          <Badge size="xs" variant="default">
            expires {formatRelative(alert.expires_at)}
          </Badge>
        )}
        <Text size="xs" c="dimmed">
          {alert.trigger_count === 0
            ? 'no Triggers yet'
            : `${alert.trigger_count} Triggers · last ${formatRelative(alert.last_triggered_at!)}`}
        </Text>
      </Group>
    </Paper>
  );
}

/** The gap between price and Threshold, drawn. The window is the Threshold ±4 %. */
function DistanceAxis({ alert, price, live }: { alert: Alert; price: number | null; live: boolean }) {
  const window = alert.threshold * 0.04;
  const raw = price === null ? 0 : 50 + ((price - alert.threshold) / window) * 50;
  const position = Math.max(2, Math.min(98, raw));
  const above = alert.condition === 'price_above';

  return (
    <Box style={{ position: 'relative', height: 34, opacity: price === null ? 0.35 : live ? 1 : 0.5 }}>
      {/* the half of the axis in which the Condition holds */}
      <Box
        style={{
          position: 'absolute',
          top: 14,
          left: above ? '50%' : 0,
          width: '50%',
          height: 6,
          borderRadius: 3,
          background: 'var(--mantine-color-teal-light)',
        }}
      />
      <Box
        style={{
          position: 'absolute',
          top: 16,
          left: 0,
          right: 0,
          height: 2,
          background: 'var(--mantine-color-default-border)',
        }}
      />
      {/* the Threshold */}
      <Box
        style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          width: 2,
          height: 14,
          background: 'var(--mantine-color-text)',
        }}
      />
      {/* the live price */}
      {price !== null && (
        <Box
          className="price-marker"
          style={{
            position: 'absolute',
            top: 11,
            left: `${position}%`,
            width: 12,
            height: 12,
            marginLeft: -6,
            borderRadius: '50%',
            border: '2px solid var(--mantine-color-body)',
            background: `var(--mantine-color-${
              (above && price >= alert.threshold) || (!above && price <= alert.threshold) ? 'teal' : 'blue'
            }-6)`,
          }}
        />
      )}
      <Text size="9px" c="dimmed" style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}>
        Threshold
      </Text>
    </Box>
  );
}

function RowMenu({ alert }: { alert: Alert }) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Actions">
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {isFinished(alert) ? (
          <Menu.Item leftSection={<IconCopy size={14} />}>Clone into a new Alert</Menu.Item>
        ) : (
          <>
            <Menu.Item
              leftSection={
                alert.state === 'paused' ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />
              }
            >
              {alert.state === 'paused' ? 'Resume' : 'Pause'}
            </Menu.Item>
            <Menu.Item leftSection={<IconPencil size={14} />}>Edit</Menu.Item>
          </>
        )}
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={14} />}>
          Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const starters = [
    { symbol: 'BTCUSDT', word: 'above', threshold: 70000 },
    { symbol: 'ETHUSDT', word: 'below', threshold: 3000 },
    { symbol: 'SOLUSDT', word: 'above', threshold: 200 },
  ];
  return (
    <Stack gap="md" maw={560}>
      <Title order={2} size="h3">
        Nothing is being watched yet
      </Title>
      <Text c="dimmed" size="sm">
        An Alert watches one Symbol and tells you when its price crosses a Threshold. Start from one of
        these, or write your own.
      </Text>
      <Stack gap="xs">
        {starters.map((starter) => (
          <Paper key={starter.symbol} withBorder radius="md" p="sm">
            <Group justify="space-between">
              <div>
                <Text fw={600}>{starter.symbol}</Text>
                <Text size="xs" c="dimmed">
                  price {starter.word} {formatPrice(starter.threshold)}
                </Text>
              </div>
              <Button size="xs" variant="light" onClick={onNew}>
                Use this
              </Button>
            </Group>
          </Paper>
        ))}
      </Stack>
      <Button leftSection={<IconBellPlus size={16} />} variant="default" onClick={onNew}>
        Write my own
      </Button>
    </Stack>
  );
}
