import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Grid,
  Group,
  Menu,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconBellPlus,
  IconChartLine,
  IconCopy,
  IconDots,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { PriceChart } from '../../charts/PriceChart';
import { fakeCandles } from '../../fake/candles';
import {
  changePct,
  conditionWord,
  distancePct,
  formatPrice,
  formatRelative,
  isFinished,
  priceColor,
  repeatLabel,
  stateColor,
  stateLabel,
  type Alert,
  type Trigger,
} from '../../fake/domain';
import type { Quotes } from '../../fake/useTicker';
import { SymbolIcon } from '../../shell/SymbolIcon';
import { SymbolPicker } from '../../shell/SymbolPicker';

const TRIGGERS_IN_PANEL = 5;

type GroupBy = 'none' | 'symbol' | 'condition';

/**
 * VARIANT D — variant A after two rounds of feedback.
 *
 * The toolbar (title, filters, New Alert) spans the full width; below it the list is one column and
 * the selected Alert's chart opens beside it, starting level with the first card. On a phone the
 * chart opens under the card it belongs to.
 */
export function VariantD({
  alerts,
  quotes,
  triggers,
  live,
  onNew,
  onHistory,
}: {
  alerts: Alert[];
  quotes: Quotes;
  triggers: Trigger[];
  live: boolean;
  onNew: () => void;
  onHistory: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [selected, setSelected] = useState<string | null>(null);

  const counts = {
    all: alerts.length,
    active: alerts.filter((a) => a.state === 'active').length,
    paused: alerts.filter((a) => a.state === 'paused').length,
    finished: alerts.filter(isFinished).length,
  };

  const symbols = useMemo(() => [...new Set(alerts.map((a) => a.symbol))].sort(), [alerts]);

  const shown = alerts.filter((alert) => {
    if (symbolFilter.length > 0 && !symbolFilter.includes(alert.symbol)) return false;
    if (filter === 'all') return true;
    if (filter === 'finished') return isFinished(alert);
    return alert.state === filter;
  });

  const groups = groupAlerts(shown, groupBy);
  const selectedAlert = alerts.find((alert) => alert.id === selected) ?? null;

  const detail = selectedAlert && (
    <DetailPanel
      alert={selectedAlert}
      quotes={quotes}
      triggers={triggers.filter((trigger) => trigger.alert_id === selectedAlert.id)}
      onClose={() => setSelected(null)}
      onHistory={onHistory}
    />
  );

  return (
    <Stack gap="md">
      {/* one toolbar across the whole width, in three rows: the title and the primary action, then
          the states, then the two controls that narrow the list */}
      <Paper withBorder radius="md" p="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Title order={2} size="h3">
              Alerts
            </Title>
            <Button leftSection={<IconBellPlus size={16} />} size="sm" onClick={onNew}>
              New Alert
            </Button>
          </Group>

          <SegmentedControl
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

          {/* stacked and full width on a phone; two halves of the row on a tablet; a quarter of the
              row each — one cell of the filter above — once the container stops growing */}
          <Grid gutter="xs">
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              <Select
                size="xs"
                w="100%"
                value={groupBy}
                onChange={(value) => value && setGroupBy(value as GroupBy)}
                allowDeselect={false}
                data={[
                  { value: 'none', label: 'No grouping' },
                  { value: 'symbol', label: 'Group by Symbol' },
                  { value: 'condition', label: 'Group by Condition' },
                ]}
                comboboxProps={{ withinPortal: true }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              <SymbolPicker data={symbols} value={symbolFilter} onChange={setSymbolFilter} />
            </Grid.Col>
          </Grid>
        </Stack>
      </Paper>

      {alerts.length === 0 ? (
        <EmptyState onNew={onNew} />
      ) : (
        <Grid gutter="lg" align="flex-start">
          <Grid.Col span={{ base: 12, md: 6, lg: 5 }}>
            <Stack gap="sm">
              {groups.map((group) => (
                <Stack gap="sm" key={group.title ?? 'all'}>
                  {group.title && (
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="xs">
                      {group.title} · {group.alerts.length}
                    </Text>
                  )}
                  {group.alerts.map((alert) => (
                    <div key={alert.id}>
                      <AlertCard
                        alert={alert}
                        quotes={quotes}
                        live={live}
                        selected={alert.id === selected}
                        onSelect={() => setSelected(alert.id === selected ? null : alert.id)}
                      />
                      {alert.id === selected && (
                        <Box hiddenFrom="md" mt="xs">
                          {detail}
                        </Box>
                      )}
                    </div>
                  ))}
                </Stack>
              ))}

              <Text size="xs" c="dimmed" ta="center">
                {counts.active + counts.paused} of 20 Alerts used. Finished Alerts do not count.
              </Text>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 7 }} visibleFrom="md">
            {selectedAlert ? (
              detail
            ) : (
              <Center mih={320}>
                <Stack align="center" gap={6}>
                  <ThemeIcon size={44} radius="xl" variant="light" color="gray">
                    <IconChartLine size={22} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" ta="center" maw={260}>
                    Select an Alert to see its chart and its own Trigger history.
                  </Text>
                </Stack>
              </Center>
            )}
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}

function groupAlerts(alerts: Alert[], groupBy: GroupBy): { title: string | null; alerts: Alert[] }[] {
  if (groupBy === 'none') return [{ title: null, alerts }];

  const key = (alert: Alert) =>
    groupBy === 'symbol' ? alert.symbol : `Price ${conditionWord(alert.condition)} the Threshold`;

  const buckets = new Map<string, Alert[]>();
  for (const alert of alerts) buckets.set(key(alert), [...(buckets.get(key(alert)) ?? []), alert]);
  return [...buckets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, grouped]) => ({ title, alerts: grouped }));
}

function AlertCard({
  alert,
  quotes,
  live,
  selected,
  onSelect,
}: {
  alert: Alert;
  quotes: Quotes;
  live: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const quote = quotes[alert.symbol];
  const price = quote?.price ?? null;
  const distance = distancePct(alert, price);
  const change = changePct(alert.symbol, price);
  const finished = isFinished(alert);
  const dim = finished || alert.state === 'paused';

  // the badge is coloured by whether the Condition holds, so it agrees with the green zone on the
  // axis below it — for a `below` Alert, standing under the Threshold is the green case, not the red
  const holds = distance !== null && distance <= 0;

  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      style={{
        opacity: dim ? 0.7 : 1,
        cursor: 'pointer',
        userSelect: 'none',
        borderColor: selected ? 'var(--mantine-primary-color-filled)' : undefined,
        borderWidth: selected ? 2 : 1,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <SymbolIcon symbol={alert.symbol} />
            <div style={{ minWidth: 0 }}>
              <Group gap={6} wrap="nowrap">
                <Text fw={700}>{alert.symbol}</Text>
                {alert.state !== 'active' && (
                  <Badge size="xs" variant="light" color={stateColor(alert.state)}>
                    {stateLabel(alert.state)}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {conditionWord(alert.condition)} {formatPrice(alert.threshold)}
              </Text>
            </div>
          </Group>

          <Group gap={2} wrap="nowrap" align="flex-start">
            <div style={{ textAlign: 'right' }}>
              {/* coloured against the 24 h reference, so it holds its colour for hours */}
              <Text fw={700} c={live ? priceColor(alert.symbol, price) : 'dimmed'}>
                {price === null ? '—' : formatPrice(price)}
              </Text>
              <Text size="xs" c={change === null ? 'dimmed' : change >= 0 ? 'teal' : 'red'}>
                {change === null ? 'no price' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h`}
              </Text>
            </div>
            <RowMenu alert={alert} />
          </Group>
        </Group>

        <Box mt={6}>
          <DistanceAxis alert={alert} price={price} live={live} />
        </Box>

        <Group gap="xs" mt={6} wrap="wrap">
          <Badge size="xs" variant="light" color={distance === null ? 'gray' : holds ? 'teal' : 'red'}>
            {distance === null
              ? 'no price'
              : holds
                ? `${Math.abs(distance).toFixed(2)}% past`
                : `${distance.toFixed(2)}% away`}
          </Badge>
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
        </Group>

        {/* the Trigger line gets a line of its own, under everything else */}
        <Text size="xs" c="dimmed" mt={6}>
          {alert.trigger_count === 0
            ? 'Never triggered'
            : `${alert.trigger_count} Triggers · last ${formatRelative(alert.last_triggered_at!)}`}
        </Text>
      </div>
    </Card>
  );
}

/**
 * The gap between price and Threshold, drawn. Window is the Threshold ±4 %. The Threshold is marked
 * by a hairline and named by its value — the word "Threshold" said nothing the number does not.
 */
function DistanceAxis({ alert, price, live }: { alert: Alert; price: number | null; live: boolean }) {
  const window = alert.threshold * 0.04;
  const raw = price === null ? 0 : 50 + ((price - alert.threshold) / window) * 50;
  const position = Math.max(2, Math.min(98, raw));
  const above = alert.condition === 'price_above';
  const holds = price !== null && (above ? price >= alert.threshold : price <= alert.threshold);

  return (
    <Box style={{ position: 'relative', height: 26, opacity: price === null ? 0.35 : live ? 1 : 0.5 }}>
      <Box
        style={{
          position: 'absolute',
          top: 5,
          left: above ? '50%' : 0,
          width: '50%',
          height: 4,
          borderRadius: 2,
          background: 'var(--mantine-color-teal-light)',
        }}
      />
      <Box
        style={{
          position: 'absolute',
          top: 6,
          left: 0,
          right: 0,
          height: 2,
          borderRadius: 1,
          background: 'var(--mantine-color-default-border)',
        }}
      />
      <Box
        style={{
          position: 'absolute',
          top: 2,
          left: '50%',
          width: 1,
          height: 10,
          background: 'var(--mantine-color-dimmed)',
        }}
      />
      {price !== null && (
        <Box
          className="price-marker"
          style={{
            position: 'absolute',
            top: 2,
            left: `${position}%`,
            width: 10,
            height: 10,
            marginLeft: -5,
            borderRadius: '50%',
            border: '2px solid var(--mantine-color-body)',
            background: `var(--mantine-color-${holds ? 'teal' : 'blue'}-6)`,
          }}
        />
      )}
      <Text
        size="10px"
        c="dimmed"
        style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}
      >
        {formatPrice(alert.threshold)}
      </Text>
    </Box>
  );
}

function DetailPanel({
  alert,
  quotes,
  triggers,
  onClose,
  onHistory,
}: {
  alert: Alert;
  quotes: Quotes;
  triggers: Trigger[];
  onClose: () => void;
  onHistory: () => void;
}) {
  const candles = useMemo(() => fakeCandles(alert.symbol), [alert.symbol]);
  const price = quotes[alert.symbol]?.price ?? null;

  return (
    <Stack gap="md">
      {/* no header: the Symbol, the price and the Threshold are all on the card that opened this */}
      <Card withBorder radius="md" padding="md" pos="relative">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}
        >
          <IconX size={14} />
        </ActionIcon>
        <PriceChart candles={candles} threshold={alert.threshold} livePrice={price} />
      </Card>

      <Card withBorder radius="md" padding="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600} size="sm">
            Triggers of this Alert
          </Text>
          <Button variant="subtle" size="compact-xs" onClick={onHistory}>
            See all in History
          </Button>
        </Group>

        {triggers.length === 0 ? (
          <Text size="sm" c="dimmed">
            This Alert has not gone off yet.
          </Text>
        ) : (
          <Stack gap="xs">
            {triggers.slice(0, TRIGGERS_IN_PANEL).map((trigger) => (
              <Group key={trigger.id} gap="xs" justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <ThemeIcon
                    size={20}
                    radius="xl"
                    variant="light"
                    color={trigger.condition === 'price_above' ? 'teal' : 'red'}
                  >
                    {trigger.condition === 'price_above' ? (
                      <IconArrowUp size={11} />
                    ) : (
                      <IconArrowDown size={11} />
                    )}
                  </ThemeIcon>
                  <Text size="sm">at {formatPrice(trigger.price)}</Text>
                  {trigger.delivery === 'no_chat' && (
                    <Badge size="xs" color="gray" variant="light">
                      not sent
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {formatRelative(trigger.created_at)}
                </Text>
              </Group>
            ))}
            {triggers.length > TRIGGERS_IN_PANEL && (
              <Text size="xs" c="dimmed">
                {triggers.length - TRIGGERS_IN_PANEL} older Triggers not shown here.
              </Text>
            )}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

function RowMenu({ alert }: { alert: Alert }) {
  const finished = isFinished(alert);
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Actions"
          onClick={(event) => event.stopPropagation()}
        >
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
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
