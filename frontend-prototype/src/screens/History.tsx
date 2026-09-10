import {
  Badge,
  Button,
  Center,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconHistory } from '@tabler/icons-react';
import { useState } from 'react';
import { conditionSign, formatPrice, type Trigger } from '../fake/domain';

const dayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });

/**
 * The per-user Trigger feed from ticket 05 — keyset-paginated, newest first, grouped by day.
 * This is the screen that makes an account with no Linked chat legible.
 */
export function History({ triggers }: { triggers: Trigger[] }) {
  const [pages, setPages] = useState(1);
  const shown = triggers.slice(0, pages * 10);

  if (triggers.length === 0) {
    return (
      <Center mih={360}>
        <Stack align="center" gap="sm" maw={420}>
          <ThemeIcon size={56} radius="xl" variant="light" color="gray">
            <IconHistory size={28} />
          </ThemeIcon>
          <Title order={3} ta="center">
            No Triggers yet
          </Title>
          <Text c="dimmed" ta="center" size="sm">
            Every time one of your Alerts goes off it is recorded here, whether or not a Notification
            could be delivered.
          </Text>
        </Stack>
      </Center>
    );
  }

  const days = new Map<string, Trigger[]>();
  for (const trigger of shown) {
    const key = dayFormat.format(new Date(trigger.created_at));
    days.set(key, [...(days.get(key) ?? []), trigger]);
  }

  return (
    <Stack gap="lg" maw={720}>
      <Title order={2} size="h3">
        History
      </Title>

      {[...days].map(([day, dayTriggers]) => (
        <div key={day}>
          <Text size="sm" fw={600} c="dimmed" mb="xs">
            {day}
          </Text>
          <Paper withBorder radius="md" p="md">
            <Timeline bulletSize={22} lineWidth={2}>
              {dayTriggers.map((trigger) => (
                <Timeline.Item
                  key={trigger.id}
                  bullet={
                    <ThemeIcon
                      size={22}
                      radius="xl"
                      variant="light"
                      color={trigger.condition === 'price_above' ? 'teal' : 'red'}
                    >
                      {trigger.condition === 'price_above' ? (
                        <IconArrowUp size={12} />
                      ) : (
                        <IconArrowDown size={12} />
                      )}
                    </ThemeIcon>
                  }
                  title={
                    <Group gap="xs" justify="space-between" wrap="nowrap">
                      <Text fw={600} size="sm">
                        {trigger.symbol} at {formatPrice(trigger.price)}
                      </Text>
                      <Group gap="xs" wrap="nowrap">
                        {trigger.delivery === 'no_chat' && (
                          <Tooltip label="No Linked chat, so the Notification had nowhere to go">
                            <Badge size="xs" color="gray" variant="light">
                              not delivered
                            </Badge>
                          </Tooltip>
                        )}
                        <Text size="xs" c="dimmed">
                          {timeFormat.format(new Date(trigger.created_at))}
                        </Text>
                      </Group>
                    </Group>
                  }
                >
                  <Text size="xs" c="dimmed">
                    Condition: price {conditionSign(trigger.condition)} {formatPrice(trigger.threshold)}
                  </Text>
                </Timeline.Item>
              ))}
            </Timeline>
          </Paper>
        </div>
      ))}

      {shown.length < triggers.length && (
        <Group justify="center">
          <Button variant="default" onClick={() => setPages((p) => p + 1)}>
            Load older Triggers
          </Button>
        </Group>
      )}
    </Stack>
  );
}
