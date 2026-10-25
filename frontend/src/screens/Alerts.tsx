import {
  Button,
  Center,
  Grid,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AlertCard } from '../alerts/AlertCard'
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
import { ButtonLink } from '../shell/links'

// The signed-in home: the state of a person's own rules, each with its live
// price and how close it is to going off. One list in one column; the state
// control, the Symbol filter and the grouping only narrow and arrange it, and
// all three live in the URL.
export function Alerts() {
  const { t } = useTranslation()
  usePageTitle('shell.alerts')
  const { data: alerts, isPending, isError, refetch } = useAlerts()

  if (isPending) return <ListSkeleton />
  if (isError) {
    return (
      <Stack align="flex-start" gap="xs">
        <PageTitle />
        <Text c="dimmed">{t('alerts.loadFailed')}</Text>
        <Button variant="default" size="xs" onClick={() => void refetch()}>
          {t('alerts.retry')}
        </Button>
      </Stack>
    )
  }
  if (alerts.length === 0) return <EmptyState />
  return <AlertList alerts={alerts} />
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
    // back button to walk through.
    update: (next: (previous: AlertsSearch) => AlertsSearch) =>
      void navigate({ search: next, replace: true }),
  }
}

function AlertList({ alerts }: { alerts: readonly Alert[] }) {
  const { t } = useTranslation()
  const { state, symbols, grouping, update } = useListSearch()

  const sorted = useMemo(() => sortAlerts(alerts), [alerts])
  // Offered: the Symbols this person has Alerts on, withdrawn ones included —
  // not the Subscription, most of which may have nothing to filter.
  const options = useMemo(() => [...new Set(alerts.map((a) => a.symbol))].sort(), [alerts])
  const narrowed = narrowAlerts(sorted, symbols)
  const counts = countByState(narrowed)
  const groups = groupAlerts(filterByState(narrowed, state), grouping)
  const used = slotsUsed(alerts)

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

      {/* The left column of the master–detail layout: ticket 27 opens the
          picked Alert's chart beside it. Until then the column stands alone,
          at the width a card reads best at. */}
      <Grid gap="lg" align="flex-start">
        <Grid.Col span={{ base: 12, md: 6, lg: 5 }}>
          <Stack gap="sm">
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
                    <AlertCard key={alert.id} alert={alert} />
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
