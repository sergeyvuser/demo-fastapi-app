import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Menu,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconBellPlus,
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
  stateColor,
  stateLabel,
  type Alert,
} from '../../fake/domain';
import type { Quotes } from '../../fake/useTicker';

/**
 * VARIANT A — one Card per Alert, mobile first.
 *
 * Answers: the Threshold is a sentence and the live price is the big number under it; the distance
 * is one percentage plus a proximity bar; the number flashes on a Tick; Paused and Finished live
 * behind a filter in the same list; Trigger history is not on this screen at all.
 */
export function VariantA({
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
  const [filter, setFilter] = useState('all');

  const counts = {
    all: alerts.length,
    active: alerts.filter((a) => a.state === 'active').length,
    paused: alerts.filter((a) => a.state === 'paused').length,
    finished: alerts.filter(isFinished).length,
  };

  const shown = alerts.filter((alert) => {
    if (filter === 'all') return true;
    if (filter === 'finished') return isFinished(alert);
    return alert.state === filter;
  });

  if (alerts.length === 0) return <EmptyState onNew={onNew} />;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={2} size="h3">
          Alerts
        </Title>
        <Button leftSection={<IconBellPlus size={16} />} size="sm" onClick={onNew}>
          New Alert
        </Button>
      </Group>

      <SegmentedControl
        fullWidth
        size="xs"
        value={filter}
        onChange={setFilter}
        data={[
          { value: 'all', label: `All ${counts.all}` },
          { value: 'active', label: `Active ${counts.active}` },
          { value: 'paused', label: `Paused ${counts.paused}` },
          { value: 'finished', label: `Finished ${counts.finished}` },
        ]}
      />

      <Stack gap="sm">
        {shown.map((alert) => (
          <AlertCard key={alert.id} alert={alert} quotes={quotes} live={live} />
        ))}
      </Stack>

      <Text size="xs" c="dimmed" ta="center">
        {counts.active + counts.paused} of 20 Alerts used. Finished Alerts do not count.
      </Text>
    </Stack>
  );
}

function AlertCard({ alert, quotes, live }: { alert: Alert; quotes: Quotes; live: boolean }) {
  const quote = quotes[alert.symbol];
  const price = quote?.price ?? null;
  const distance = distancePct(alert, price);
  const finished = isFinished(alert);
  const dim = finished || alert.state === 'paused';

  // proximity: 100 % when the Condition holds, 0 % when the price is 10 % away or further
  const proximity =
    distance === null ? 0 : Math.max(0, Math.min(100, ((10 - distance) / 10) * 100));

  return (
    <Card withBorder padding="md" radius="md" style={{ opacity: dim ? 0.65 : 1 }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb={4}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={700} size="lg">
            {alert.symbol}
          </Text>
          {alert.state !== 'active' && (
            <Badge size="sm" variant="light" color={stateColor(alert.state)}>
              {stateLabel(alert.state)}
            </Badge>
          )}
        </Group>
        <RowMenu alert={alert} />
      </Group>

      <Text size="sm" c="dimmed" mb="sm">
        Notify when the price is {conditionWord(alert.condition)}{' '}
        <Text span fw={600} c="var(--mantine-color-text)">
          {formatPrice(alert.threshold)}
        </Text>
      </Text>

      <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed">
            Live price
          </Text>
          {price === null ? (
            <Text size="xl" fw={700} c="dimmed">
              —
            </Text>
          ) : (
            <Text
              key={live ? quote.seq : 'frozen'}
              size="xl"
              fw={700}
              c={live ? undefined : 'dimmed'}
              className={live ? (quote.dir === 1 ? 'tick-up' : quote.dir === -1 ? 'tick-down' : undefined) : undefined}
            >
              {formatPrice(price)}
            </Text>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <Text size="xs" c="dimmed">
            {distance === null ? 'no price yet' : distance <= 0 ? 'condition holds' : 'to go'}
          </Text>
          <Text size="md" fw={600} c={distance !== null && distance <= 0 ? 'teal' : undefined}>
            {distance === null ? '—' : `${distance <= 0 ? '' : '+'}${distance.toFixed(2)}%`}
          </Text>
        </div>
      </Group>

      <Progress
        value={proximity}
        size="xs"
        mt="xs"
        color={distance !== null && distance <= 0 ? 'teal' : 'blue'}
      />

      <Group gap="xs" mt="sm" wrap="wrap">
        <Badge size="xs" variant="default">
          {repeatLabel(alert.repeat_policy)}
        </Badge>
        {alert.cooldown_seconds !== null && (
          <Badge size="xs" variant="default">
            Cooldown {Math.round(alert.cooldown_seconds / 60)} min
          </Badge>
        )}
        {alert.expires_at && (
          <Badge size="xs" variant="default">
            {finished ? 'Expired' : 'Expires'} {formatRelative(alert.expires_at)}
          </Badge>
        )}
        <Text size="xs" c="dimmed">
          {alert.trigger_count === 0
            ? 'never triggered'
            : `${alert.trigger_count} Triggers, last ${formatRelative(alert.last_triggered_at!)}`}
        </Text>
      </Group>
    </Card>
  );
}

function RowMenu({ alert }: { alert: Alert }) {
  const finished = isFinished(alert);
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Actions">
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {finished ? (
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
  return (
    <Center mih={360}>
      <Stack align="center" gap="sm" maw={420}>
        <ThemeIcon size={56} radius="xl" variant="light">
          <IconBellPlus size={28} />
        </ThemeIcon>
        <Title order={3} ta="center">
          No Alerts yet
        </Title>
        <Text c="dimmed" ta="center" size="sm">
          An Alert watches one Symbol and tells you when its price crosses a Threshold. Create one and
          it starts watching the next Tick.
        </Text>
        <Button leftSection={<IconBellPlus size={16} />} onClick={onNew}>
          Create your first Alert
        </Button>
      </Stack>
    </Center>
  );
}
