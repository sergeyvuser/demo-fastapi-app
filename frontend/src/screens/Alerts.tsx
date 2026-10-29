import {
  Box,
  Button,
  Center,
  Grid,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useMantineTheme,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useMatch, useNavigate, useSearch } from '@tanstack/react-router'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAlertActions } from '../alerts/actions'
import { AlertCard, type CardActions } from '../alerts/AlertCard'
import { AlertDetail } from '../alerts/AlertDetail'
import {
  countByState,
  filterByState,
  groupAlerts,
  GROUPINGS,
  narrowAlerts,
  parseSymbols,
  SLOT_COUNTER_FROM,
  SLOT_LIMIT,
  slotsUsed,
  sortAlerts,
  STATE_FILTERS,
  type Alert,
  type AlertsSearch,
  type Grouping,
  type StateFilter,
} from '../alerts/list'
import { useAlerts } from '../alerts/query'
import { SymbolFilter } from '../alerts/SymbolFilter'
import { usePageTitle } from '../i18n/documentTitle'
import { formatThreshold } from '../i18n/format'
import { resolvedLanguage } from '../i18n/language'
import { NotFound } from '../NotFound'
import { usePrecision } from '../prices/store'
import { ButtonLink } from '../shell/links'

// The signed-in home: the state of a person's own rules, each with its live
// price and how close it is to going off. One list in one column; the state
// control, the Symbol filter and the grouping only narrow and arrange it, and
// all three live in the URL. `/alerts/:id` is the same screen with one Alert
// opened beside the list.
export function Alerts() {
  const { t } = useTranslation()
  usePageTitle('shell.alerts')
  const navigate = useNavigate()
  const { data: alerts, isPending, isError, refetch } = useAlerts()
  const selectedId = useMatch({ from: '/signed-in/alerts/$id', shouldThrow: false })?.params.id
  // Here, not on a card: the write must outlive the card it removes, and the
  // list it lives in when the last card goes and the empty state replaces it.
  const { pause, resume, remove } = useAlertActions()
  const confirm = useDeleteConfirmation((alert) => {
    // An open screen of an Alert that is going would flash "not found".
    if (alert.id === selectedId) void navigate({ to: '/alerts', search: true, resetScroll: false })
    remove(alert)
  })
  const actions: CardActions = { pause, resume, askDelete: confirm.ask }

  let content: ReactNode
  if (isPending) {
    content = <ListSkeleton />
  } else if (isError) {
    content = (
      <Stack align="flex-start" gap="xs">
        <PageTitle />
        <Text c="dimmed">{t('alerts.loadFailed')}</Text>
        <Button variant="default" size="xs" onClick={() => void refetch()}>
          {t('alerts.retry')}
        </Button>
      </Stack>
    )
  } else if (alerts.length === 0) {
    content = <EmptyState />
  } else {
    content = <AlertList alerts={alerts} selectedId={selectedId} actions={actions} />
  }

  return (
    <>
      {content}
      {confirm.dialog}
    </>
  )
}

// Asked before a delete, every time: one mis-click must not take a rule and
// its history with it, and there is no Undo afterwards. Undo was rejected on
// its mechanics — the history goes with the Alert, so an Undo would have to
// delay the request, and a tab closed inside that delay silently un-deletes.
function useDeleteConfirmation(onConfirm: (alert: Alert) => void) {
  // Kept after closing, so the dialog's text does not empty while it fades.
  const [target, setTarget] = useState<Alert | null>(null)
  const [opened, setOpened] = useState(false)
  const close = () => setOpened(false)

  return {
    ask: (alert: Alert) => {
      setTarget(alert)
      setOpened(true)
    },
    dialog: (
      <DeleteDialog
        alert={target}
        opened={opened}
        onCancel={close}
        onConfirm={() => {
          close()
          if (target) onConfirm(target)
        }}
      />
    ),
  }
}

function DeleteDialog({
  alert,
  opened,
  onCancel,
  onConfirm,
}: {
  alert: Alert | null
  opened: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t, i18n } = useTranslation()
  const precision = usePrecision(alert?.symbol ?? '')
  const rule = alert
    ? t(`alerts.rule.${alert.condition}`, {
        threshold: formatThreshold(alert.threshold, precision, resolvedLanguage(i18n)),
      })
    : ''

  return (
    <Modal opened={opened} onClose={onCancel} title={t('alerts.confirm.title')} centered>
      <Text size="sm">{t('alerts.confirm.body', { symbol: alert?.symbol ?? '', rule })}</Text>
      <Group justify="flex-end" gap="sm" mt="lg">
        {/* the safe answer is the one a stray Enter gives */}
        <Button variant="default" onClick={onCancel} data-autofocus>
          {t('alerts.confirm.cancel')}
        </Button>
        <Button color="red" onClick={onConfirm}>
          {t('alerts.confirm.delete')}
        </Button>
      </Group>
    </Modal>
  )
}

type ListSearch = {
  state: StateFilter
  symbols: string[]
  grouping: Grouping
  update: (next: (previous: AlertsSearch) => AlertsSearch) => void
}

function useListSearch(): ListSearch {
  const search = useSearch({ from: '/signed-in/alerts' })
  const navigate = useNavigate({ from: '/alerts' })

  return {
    state: search.state ?? 'all',
    symbols: parseSymbols(search.symbols),
    grouping: search.group ?? 'none',
    // Replaced, not pushed: ten clicks on a filter are not ten pages for the
    // back button to walk through. `.` keeps the path, so an open Alert stays
    // open while the list beside it is narrowed.
    update: (next: (previous: AlertsSearch) => AlertsSearch) =>
      void navigate({ to: '.', search: next, replace: true }),
  }
}

function AlertList({
  alerts,
  selectedId,
  actions,
}: {
  alerts: readonly Alert[]
  selectedId: string | undefined
  actions: CardActions
}) {
  const { t } = useTranslation()
  const { state, symbols, grouping, update } = useListSearch()
  const theme = useMantineTheme()
  // Read at once, not after the first paint: on a desktop the panel would
  // otherwise mount under the card, then move — and draw its chart twice.
  const wide = useMediaQuery(`(min-width: ${theme.breakpoints.md})`, undefined, {
    getInitialValueInEffect: false,
  })

  const sorted = useMemo(() => sortAlerts(alerts), [alerts])
  // Offered: the Symbols this person has Alerts on, withdrawn ones included —
  // not the Subscription, most of which may have nothing to filter.
  const options = useMemo(() => [...new Set(alerts.map((a) => a.symbol))].sort(), [alerts])
  const narrowed = narrowAlerts(sorted, symbols)
  const counts = countByState(narrowed)
  const groups = groupAlerts(filterByState(narrowed, state), grouping)
  const used = slotsUsed(alerts)

  // The opened Alert, from the list this screen already holds: one source, so
  // a pause or a delete shows in the panel the moment it shows on the card.
  // An id the list does not have — deleted, or never this person's — is the
  // ordinary not-found state, in the panel's place.
  const selected = alerts.find((alert) => alert.id === selectedId)
  const panel =
    selectedId === undefined ? null : selected ? (
      <AlertDetail key={selected.id} alert={selected} />
    ) : (
      <NotFound />
    )
  // On a phone the panel opens under its card — or at the top, when no card
  // is there to open under: not found, or filtered out of view.
  const underCard =
    !wide &&
    selected !== undefined &&
    groups.some((group) => group.alerts.some((alert) => alert.id === selected.id))

  return (
    <Stack gap="md">
      <Toolbar
        counts={counts}
        state={state}
        onState={(value) =>
          update((previous) => ({ ...previous, state: value === 'all' ? undefined : value }))
        }
        grouping={grouping}
        onGrouping={(value) =>
          update((previous) => ({ ...previous, group: value === 'none' ? undefined : value }))
        }
        options={options}
        symbols={symbols}
        onSymbols={(value) =>
          update((previous) => ({
            ...previous,
            symbols: value.length > 0 ? value.join(',') : undefined,
          }))
        }
      />

      {/* Master–detail: the cards on the left at the width a card reads best
          at, the opened Alert on the right. */}
      <Grid gap="lg" align="flex-start">
        <Grid.Col span={{ base: 12, md: 6, lg: 5 }}>
          <Stack gap="sm">
            {!wide && !underCard && panel}
            {groups.every((group) => group.alerts.length === 0) ? (
              <Stack align="center" gap="xs" py="lg">
                <Text c="dimmed" size="sm">
                  {t('alerts.noMatch')}
                </Text>
                <Button variant="subtle" size="xs" onClick={() => update(() => ({}))}>
                  {t('alerts.showAll')}
                </Button>
              </Stack>
            ) : (
              groups.map((group) => (
                <Stack gap="sm" key={group.key ?? 'all'}>
                  {group.key !== null && (
                    <GroupHeading
                      grouping={grouping}
                      name={group.key}
                      count={group.alerts.length}
                    />
                  )}
                  {group.alerts.map((alert) => (
                    <Fragment key={alert.id}>
                      <AlertCard
                        alert={alert}
                        selected={alert.id === selectedId}
                        actions={actions}
                      />
                      {underCard && alert.id === selectedId && panel}
                    </Fragment>
                  ))}
                </Stack>
              ))
            )}

            {used >= SLOT_COUNTER_FROM && (
              <Text size="xs" c="dimmed" ta="center" mt="xs">
                {t('alerts.slots', { used, limit: SLOT_LIMIT })}
              </Text>
            )}
          </Stack>
        </Grid.Col>
        {wide && (
          <Grid.Col span={{ md: 6, lg: 7 }}>
            {/* level with the first card, and in view while the list scrolls */}
            <Box
              style={{
                position: 'sticky',
                top: 'calc(var(--app-shell-header-offset, 0rem) + var(--mantine-spacing-md))',
              }}
            >
              {panel ?? (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  {t('alerts.detail.hint')}
                </Text>
              )}
            </Box>
          </Grid.Col>
        )}
      </Grid>
    </Stack>
  )
}

// A Symbol is its own name and is never translated; a Condition is said in
// words. The count is how many cards follow, after every filter.
function GroupHeading({
  grouping,
  name,
  count,
}: {
  grouping: Grouping
  name: string
  count: number
}) {
  const { t } = useTranslation()
  const label =
    grouping === 'condition' ? t(`alerts.conditionGroup.${name as Alert['condition']}`) : name

  return (
    <Title order={2} size="xs" fw={700} tt="uppercase" c="dimmed" mt="xs">
      {`${label} · ${count}`}
    </Title>
  )
}

// Across the full width, in three rows: the title and the one primary action;
// the four states; the two controls that narrow the list. On a phone the two
// stack at full width, on a tablet each takes half the row, and on a desktop a
// quarter — one cell of the state control above them.
function Toolbar({
  counts,
  state,
  onState,
  grouping,
  onGrouping,
  options,
  symbols,
  onSymbols,
}: {
  counts: Record<StateFilter, number>
  state: StateFilter
  onState: (value: StateFilter) => void
  grouping: Grouping
  onGrouping: (value: Grouping) => void
  options: readonly string[]
  symbols: readonly string[]
  onSymbols: (value: string[]) => void
}) {
  const { t } = useTranslation()

  return (
    <Paper withBorder radius="md" p="sm">
      <Stack gap="sm">
        <Header />
        <SegmentedControl
          size="xs"
          fullWidth
          aria-label={t('alerts.filter.label')}
          value={state}
          onChange={(value) => onState(value)}
          data={STATE_FILTERS.map((value) => ({
            value,
            label: `${t(`alerts.filter.${value}`)} ${counts[value]}`,
          }))}
        />
        <Grid gap="xs">
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            <Select
              size="xs"
              aria-label={t('alerts.group.label')}
              value={grouping}
              onChange={(value) => value && onGrouping(value)}
              allowDeselect={false}
              data={GROUPINGS.map((value) => ({ value, label: t(`alerts.group.${value}`) }))}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            <SymbolFilter options={options} value={symbols} onChange={onSymbols} />
          </Grid.Col>
        </Grid>
      </Stack>
    </Paper>
  )
}

// The screen's title and New Alert. A button that navigates — never also an
// item in the header's navigation, at any width: a link and a primary button
// to one place are the same action offered twice.
function Header() {
  const { t } = useTranslation()

  return (
    <Group justify="space-between" align="center" wrap="nowrap">
      <PageTitle />
      <ButtonLink to="/alerts/new" size="sm" leftSection={<BellPlusIcon size={16} />}>
        {t('alerts.newAlert')}
      </ButtonLink>
    </Group>
  )
}

// Nothing yet: what an Alert is, in the domain's own words, and the one way
// to make one. No ready-made starter Alerts — they would invent Symbols and
// Thresholds the person never chose, and read as a demo, not an empty account.
// No toolbar either: there is nothing to filter, and its New Alert would be
// this screen's button twice.
function EmptyState() {
  const { t } = useTranslation()

  return (
    <Stack gap="md">
      <PageTitle />
      <Center mih={320}>
        <Stack align="center" gap="sm" maw={420}>
          <ThemeIcon size={56} radius="xl" variant="light">
            <BellPlusIcon size={28} />
          </ThemeIcon>
          <Title order={2} size="h3" ta="center">
            {t('alerts.empty.title')}
          </Title>
          <Text c="dimmed" ta="center" size="sm">
            {t('alerts.empty.body')}
          </Text>
          <ButtonLink to="/alerts/new" leftSection={<BellPlusIcon size={16} />}>
            {t('alerts.empty.action')}
          </ButtonLink>
        </Stack>
      </Center>
    </Stack>
  )
}

// The title stays put through loading: only what is not known yet is drawn
// as a skeleton, and the heading a screen reader lands on is there at once.
function PageTitle() {
  const { t } = useTranslation()

  return (
    <Title order={1} size="h3">
      {t('shell.alerts')}
    </Title>
  )
}

function ListSkeleton() {
  return (
    <Stack gap="md" aria-busy="true">
      <PageTitle />
      <Skeleton height={96} radius="md" />
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 6, lg: 5 }}>
          <Stack gap="sm">
            <Skeleton height={150} radius="md" />
            <Skeleton height={150} radius="md" />
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}

// Feather's bell with a plus, drawn in place: one more icon does not earn an
// icon library either. Decorative — the button beside it carries the name.
function BellPlusIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h11" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M19 15v6M16 18h6" />
    </svg>
  )
}
