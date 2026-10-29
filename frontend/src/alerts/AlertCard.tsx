import { ActionIcon, Badge, Box, Card, Group, Menu, Stack, Text, Tooltip } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDistance, formatDuration, formatThreshold } from '../i18n/format'
import { resolvedLanguage } from '../i18n/language'
import { useInstant } from '../i18n/time'
import { CoinMark } from '../prices/CoinMark'
import { DayChange, Price, useStale } from '../prices/Price'
import { useQuote, useSymbols } from '../prices/store'
import { AnchorLink } from '../shell/links'
import { distanceColor, distanceTo, type Distance } from './distance'
import { CopyIcon, EditIcon, MoreIcon, PauseIcon, PlayIcon, TrashIcon } from './icons'
import { isFinished, isWithdrawn, type Alert, type AlertStatus } from './list'

// What a card can ask the screen to do. Delete only asks: the confirmation
// belongs to the screen, which outlives the card it removes.
export type CardActions = {
  pause: (alert: Alert) => void
  resume: (alert: Alert) => void
  askDelete: (alert: Alert) => void
}

// A click inside one of these belongs to that control, not to the card.
// The menu's items render in a portal, but React still bubbles their clicks
// through the card, so they are listed too.
const OWN_CLICKS = 'a, button, [role="menu"], [role="menuitem"]'

// The colour of each Status that gets a badge. Active gets none: it is the
// normal case, and a badge on every healthy card would be noise that hides
// the three that matter.
const STATUS_COLOR = {
  paused: 'yellow',
  completed: 'blue',
  expired: 'gray',
} as const satisfies Record<Exclude<AlertStatus, 'active'>, string>

// One Alert, top to bottom: what it watches and its rule, the live price, how
// far the price is from going off, how it behaves, and what it has done.
// Clicking it opens its own screen beside the list; the Symbol is the same
// thing as a link, for the keyboard.
export function AlertCard({
  alert,
  selected = false,
  actions,
}: {
  alert: Alert
  selected?: boolean
  actions: CardActions
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const language = resolvedLanguage(i18n)
  const quote = useQuote(alert.symbol)
  const withdrawn = isWithdrawn(alert.symbol, useSymbols())
  const stale = useStale()
  const distance = distanceTo(alert.condition, alert.threshold, quote?.price ?? null)
  const threshold = formatThreshold(alert.threshold, quote?.precision, language)
  // A rule the person switched off, or one the system took out of service:
  // still readable, visibly not working.
  const dimmed = alert.status !== 'active'

  const open = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(OWN_CLICKS)) return
    void navigate({ to: '/alerts/$id', params: { id: alert.id }, search: true })
  }

  return (
    <Card
      withBorder
      radius="md"
      padding="sm"
      onClick={open}
      style={{
        opacity: dimmed ? 0.7 : undefined,
        cursor: 'pointer',
        borderColor: selected ? 'var(--mantine-primary-color-filled)' : undefined,
      }}
      data-testid="alert-card"
      data-selected={selected || undefined}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <CoinMark symbol={alert.symbol} size={32} />
          <Box style={{ minWidth: 0 }}>
            <Group gap={6} wrap="wrap">
              <AnchorLink
                to="/alerts/$id"
                params={{ id: alert.id }}
                search
                fw={700}
                c="inherit"
                underline="hover"
              >
                {alert.symbol}
              </AnchorLink>
              {alert.status !== 'active' && (
                <Badge size="xs" variant="light" color={STATUS_COLOR[alert.status]}>
                  {t(`alerts.status.${alert.status}`)}
                </Badge>
              )}
              {withdrawn && (
                <Tooltip label={t('alerts.withdrawn.explained')} multiline w={240} withArrow>
                  <Badge size="xs" variant="light" color="orange">
                    {t('alerts.withdrawn.badge')}
                  </Badge>
                </Tooltip>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {t(`alerts.rule.${alert.condition}`, { threshold })}
            </Text>
          </Box>
        </Group>
        <Group gap={4} align="flex-start" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Stack gap={0} align="flex-end">
            <Price symbol={alert.symbol} fw={700} ta="right" />
            <DayChange symbol={alert.symbol} size="xs" caption />
          </Stack>
          <Controls alert={alert} actions={actions} />
        </Group>
      </Group>

      <DistanceAxis alert={alert} distance={distance} threshold={threshold} stale={stale} />

      <Group gap="xs" mt={6} wrap="wrap">
        <Badge size="xs" variant="light" color={distanceColor(distance, stale)}>
          {distance === null
            ? t('alerts.distance.none')
            : t(distance.holds ? 'alerts.distance.past' : 'alerts.distance.toGo', {
                distance: formatDistance(distance.move, language),
              })}
        </Badge>
        <Badge size="xs" variant="default">
          {t(`alerts.repeat.${alert.repeat_policy ?? 'while_true'}`)}
        </Badge>
        <CooldownBadge alert={alert} />
        <ExpiryBadge alert={alert} />
      </Group>

      <TriggerLine alert={alert} />
    </Card>
  )
}

// One control in plain sight, the rest behind a menu. In plain sight is the
// thing a person does most to a working Alert — pause it, or resume it — and,
// on a Finished one, the only way back to watching that price: a copy
// (ADR 0003). Edit is not offered on a Finished Alert; nothing could put it
// back to work.
function Controls({ alert, actions }: { alert: Alert; actions: CardActions }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const finished = isFinished(alert.status)
  const paused = alert.status === 'paused'
  const clone = () => void navigate({ to: '/alerts/new', search: { from: alert.id } })

  const primary = finished
    ? { label: t('alerts.actions.clone'), icon: <CopyIcon />, run: clone }
    : paused
      ? { label: t('alerts.actions.resume'), icon: <PlayIcon />, run: () => actions.resume(alert) }
      : { label: t('alerts.actions.pause'), icon: <PauseIcon />, run: () => actions.pause(alert) }

  return (
    <Group gap={2} wrap="nowrap">
      <Tooltip label={primary.label} withArrow>
        <ActionIcon variant="subtle" color="gray" aria-label={primary.label} onClick={primary.run}>
          {primary.icon}
        </ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={t('alerts.actions.more')}>
            <MoreIcon />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {!finished && (
            <Menu.Item
              leftSection={<EditIcon size={14} />}
              onClick={() => void navigate({ to: '/alerts/$id/edit', params: { id: alert.id } })}
            >
              {t('alerts.actions.edit')}
            </Menu.Item>
          )}
          <Menu.Item leftSection={<CopyIcon size={14} />} onClick={clone}>
            {t('alerts.actions.clone')}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<TrashIcon size={14} />}
            onClick={() => actions.askDelete(alert)}
          >
            {t('alerts.actions.delete')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}

// A null Cooldown is a choice ("no spacing between Triggers"), not missing
// data — except under `once`, where there is no second Trigger to space and
// the glossary says a Cooldown means nothing, so nothing is said.
function CooldownBadge({ alert }: { alert: Alert }) {
  const { t, i18n } = useTranslation()
  if (alert.repeat_policy === 'once') return null
  const seconds = alert.cooldown_seconds ?? null

  return (
    <Badge size="xs" variant="default">
      {seconds === null
        ? t('alerts.cooldown.none')
        : t('alerts.cooldown.some', {
            duration: formatDuration(seconds, resolvedLanguage(i18n)),
          })}
    </Badge>
  )
}

// When it stops watching, or when it stopped. A Completed Alert went off
// before its Expiry, so the deadline it never reached is no longer news.
function ExpiryBadge({ alert }: { alert: Alert }) {
  if (alert.expires_at === null || alert.status === 'completed') return null
  return <ExpiryText instant={alert.expires_at} past={isFinished(alert.status)} />
}

function ExpiryText({ instant, past }: { instant: string; past: boolean }) {
  const { t } = useTranslation()
  const { text, exact } = useInstant(instant)

  return (
    <Tooltip label={exact} withArrow>
      <Badge size="xs" variant="default">
        {t(past ? 'alerts.expiry.past' : 'alerts.expiry.future', { when: text })}
      </Badge>
    </Tooltip>
  )
}

// On a line of its own, last: what the rule has actually done.
function TriggerLine({ alert }: { alert: Alert }) {
  const { t } = useTranslation()

  if (alert.trigger_count === 0 || alert.last_triggered_at === null) {
    return (
      <Text size="xs" c="dimmed" mt={6}>
        {t('alerts.card.neverTriggered')}
      </Text>
    )
  }

  return (
    <Group gap={4} mt={6} wrap="wrap">
      <Text size="xs" c="dimmed">
        {t('alerts.card.triggerCount', { count: alert.trigger_count })}
      </Text>
      <Text size="xs" c="dimmed" aria-hidden>
        ·
      </Text>
      <LastTriggered instant={alert.last_triggered_at} />
    </Group>
  )
}

function LastTriggered({ instant }: { instant: string }) {
  const { t } = useTranslation()
  const { text, exact } = useInstant(instant, { past: true })

  return (
    <Tooltip label={exact} withArrow>
      <Text size="xs" c="dimmed">
        {t('alerts.card.lastTriggered', { when: text })}
      </Text>
    </Tooltip>
  )
}

const DOT = 10

// The gap between the price and the Threshold, drawn: a hairline at the
// Threshold, named by its value; a tinted band over the half where the
// Condition holds; a dot for the live price, pinned to an end when the price
// is off the ±4 % window. Decorative — the badge under it says the same in
// words and numbers, so a screen reader is not told twice.
function DistanceAxis({
  alert,
  distance,
  threshold,
  stale,
}: {
  alert: Alert
  distance: Distance | null
  threshold: string
  stale: boolean
}) {
  const above = alert.condition === 'price_above'
  const color = distanceColor(distance, stale)

  return (
    <Box
      aria-hidden
      mt={6}
      // the dot's radius on either side, so a pinned dot stays inside the card
      px={DOT / 2}
      style={{ opacity: distance === null ? 0.4 : undefined }}
      data-testid="distance-axis"
    >
      <Box pos="relative" h={28}>
        <Box
          pos="absolute"
          top={5}
          left={above ? '50%' : 0}
          w="50%"
          h={4}
          style={{ borderRadius: 2, background: 'var(--mantine-color-green-light)' }}
        />
        <Box
          pos="absolute"
          top={6}
          left={0}
          right={0}
          h={2}
          style={{ borderRadius: 1, background: 'var(--mantine-color-default-border)' }}
        />
        <Box
          pos="absolute"
          top={1}
          left="50%"
          w={1}
          h={12}
          style={{ background: 'var(--mantine-color-dimmed)' }}
        />
        {distance !== null && (
          <Box
            pos="absolute"
            top={2}
            left={`${distance.position * 100}%`}
            w={DOT}
            h={DOT}
            ml={-DOT / 2}
            data-position={distance.position}
            style={{
              borderRadius: '50%',
              border: '2px solid var(--mantine-color-body)',
              background: `var(--mantine-color-${color}-filled)`,
            }}
          />
        )}
        <Text
          pos="absolute"
          bottom={0}
          left="50%"
          fz={10}
          c="dimmed"
          style={{ transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
        >
          {threshold}
        </Text>
      </Box>
    </Box>
  )
}
