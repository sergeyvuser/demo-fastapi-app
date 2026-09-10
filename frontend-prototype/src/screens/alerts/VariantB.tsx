import {
  ActionIcon,
  Badge,
  Button,
  Chip,
  Grid,
  Group,
  Menu,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
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
  conditionSign,
  distancePct,
  formatPrice,
  formatRelative,
  isFinished,
  repeatLabel,
  stateColor,
  stateLabel,
  type Alert,
  type Trigger,
} from '../../fake/domain';
import type { Quotes } from '../../fake/useTicker';

/**
 * VARIANT B — a dense data table with a Trigger rail beside it.
 *
 * Answers: Threshold, price and distance are three adjacent columns and nothing else competes with
 * them; a Tick changes the number silently, with only a small arrow saying which way it went;
 * Paused and Finished are a Status column plus chips, so all Alerts stay in one grid; the Trigger
 * history does belong on this screen, as a rail. At 375 px the table scrolls sideways — on purpose,
 * so the cost is visible rather than argued about.
 */
export function VariantB({
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
  const [filters, setFilters] = useState<string[]>([]);

  const shown = alerts.filter((alert) => {
    if (filters.length === 0) return true;
    if (filters.includes('finished') && isFinished(alert)) return true;
    return filters.includes(alert.state);
  });

  return (
    <Grid gutter="md">
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap">
            <Title order={2} size="h3">
              Alerts
            </Title>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {alerts.filter((a) => !isFinished(a)).length}/20
              </Text>
              <Button size="xs" leftSection={<IconBellPlus size={14} />} onClick={onNew}>
                New Alert
              </Button>
            </Group>
          </Group>

          <Chip.Group multiple value={filters} onChange={setFilters}>
            <Group gap="xs">
              <Chip size="xs" value="active">
                Active
              </Chip>
              <Chip size="xs" value="paused">
                Paused
              </Chip>
              <Chip size="xs" value="finished">
                Finished
              </Chip>
            </Group>
          </Chip.Group>

          <Paper withBorder radius="md">
            {alerts.length === 0 ? (
              <Stack gap="xs" p="xl" align="center">
                <Text fw={600}>No Alerts</Text>
                <Text size="sm" c="dimmed" ta="center">
                  Nothing is being watched on this account yet.
                </Text>
                <Button size="xs" mt="xs" leftSection={<IconBellPlus size={14} />} onClick={onNew}>
                  New Alert
                </Button>
              </Stack>
            ) : (
              <Table.ScrollContainer minWidth={820} type="native">
                <Table verticalSpacing="xs" horizontalSpacing="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Symbol</Table.Th>
                      <Table.Th>Condition</Table.Th>
                      <Table.Th ta="right">Threshold</Table.Th>
                      <Table.Th ta="right">Price</Table.Th>
                      <Table.Th ta="right">Distance</Table.Th>
                      <Table.Th>Repeat</Table.Th>
                      <Table.Th>Expiry</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {shown.map((alert) => (
                      <Row key={alert.id} alert={alert} quotes={quotes} live={live} />
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>
        </Stack>
      </Grid.Col>

      <Grid.Col span={{ base: 12, lg: 4 }}>
        <TriggerRail triggers={triggers} onHistory={onHistory} />
      </Grid.Col>
    </Grid>
  );
}

function Row({ alert, quotes, live }: { alert: Alert; quotes: Quotes; live: boolean }) {
  const quote = quotes[alert.symbol];
  const price = quote?.price ?? null;
  const distance = distancePct(alert, price);
  const holds = distance !== null && distance <= 0;

  return (
    <Table.Tr opacity={isFinished(alert) ? 0.55 : 1}>
      <Table.Td fw={600}>{alert.symbol}</Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          price {conditionSign(alert.condition)}
        </Text>
      </Table.Td>
      <Table.Td ta="right" fw={600}>
        {formatPrice(alert.threshold)}
      </Table.Td>
      <Table.Td ta="right" c={live && price !== null ? undefined : 'dimmed'}>
        <Group gap={4} justify="flex-end" wrap="nowrap">
          <Text size="sm" c={quote?.dir === 1 ? 'teal' : quote?.dir === -1 ? 'red' : 'dimmed'}>
            {quote?.dir === 1 ? '▲' : quote?.dir === -1 ? '▼' : '·'}
          </Text>
          <Text size="sm">{price === null ? '—' : formatPrice(price)}</Text>
        </Group>
      </Table.Td>
      <Table.Td ta="right">
        <Text size="sm" fw={600} c={holds ? 'teal' : undefined}>
          {distance === null ? '—' : `${distance <= 0 ? '' : '+'}${distance.toFixed(2)}%`}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {repeatLabel(alert.repeat_policy)}
          {alert.cooldown_seconds !== null && ` · ${Math.round(alert.cooldown_seconds / 60)}m`}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {alert.expires_at ? formatRelative(alert.expires_at) : '—'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge size="xs" variant="light" color={stateColor(alert.state)}>
          {stateLabel(alert.state)}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Actions">
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {isFinished(alert) ? (
              <Menu.Item leftSection={<IconCopy size={14} />}>Clone</Menu.Item>
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
      </Table.Td>
    </Table.Tr>
  );
}

function TriggerRail({ triggers, onHistory }: { triggers: Trigger[]; onHistory: () => void }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Recent Triggers</Text>
        <Button variant="subtle" size="compact-xs" onClick={onHistory}>
          See all
        </Button>
      </Group>
      {triggers.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing has gone off yet.
        </Text>
      ) : (
        <Stack gap="sm">
          {triggers.slice(0, 8).map((trigger) => (
            <Group key={trigger.id} justify="space-between" gap="xs" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  {trigger.symbol}{' '}
                  <Text span size="sm" fw={400} c="dimmed">
                    {conditionSign(trigger.condition)} {formatPrice(trigger.threshold)}
                  </Text>
                </Text>
                <Text size="xs" c="dimmed">
                  at {formatPrice(trigger.price)} · {formatRelative(trigger.created_at)}
                </Text>
              </div>
              {trigger.delivery === 'no_chat' && (
                <Tooltip label="No Linked chat, so no Notification was sent">
                  <Badge size="xs" color="gray" variant="light">
                    not sent
                  </Badge>
                </Tooltip>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
