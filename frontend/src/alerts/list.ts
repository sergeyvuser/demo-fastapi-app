import type { components } from '../api/generated/http'
import type { Condition } from './distance'

export type Alert = components['schemas']['AlertRead']
export type AlertStatus = components['schemas']['AlertStatus']

// The four positions of the state control. Finished is one of them although
// it is two Statuses: Completed and Expired are both "the system took it out
// of service", and the badge on the card already says which.
export const STATE_FILTERS = ['all', 'active', 'paused', 'finished'] as const
export type StateFilter = (typeof STATE_FILTERS)[number]

export const GROUPINGS = ['none', 'symbol', 'condition'] as const
export type Grouping = (typeof GROUPINGS)[number]

// The account's limit and where the counter starts to show. The limit is the
// server's `MAX_ALERTS_PER_USER`; the counter appears five short of it for
// every account, so the refusal at twenty never arrives as a surprise.
export const SLOT_LIMIT = 20
export const SLOT_COUNTER_FROM = 15

// A Status, as the backend derived it — never recomputed here. Expiry is the
// server's arithmetic on the server's clock, and a client that re-derived it
// would disagree with the server for as long as the two clocks do.
export function isFinished(status: AlertStatus): boolean {
  return status === 'completed' || status === 'expired'
}

function matchesState(alert: Alert, state: StateFilter): boolean {
  if (state === 'all') return true
  if (state === 'finished') return isFinished(alert.status)
  return alert.status === state
}

// The list's state, as it travels in the URL: defaults are left out, so
// `/alerts` is the whole list ungrouped and a link only says what differs.
export type AlertsSearch = {
  state?: Exclude<StateFilter, 'all'>
  // comma-separated: `BTCUSDT,ETHUSDT` reads better in an address bar than
  // the JSON array the router would write for a list
  symbols?: string
  group?: Exclude<Grouping, 'none'>
}

const SYMBOL = /^[A-Z0-9]{5,20}$/

// What the router accepts from an address bar, which anyone can type into.
// Anything unknown is dropped rather than refused: a stale bookmark should
// open the list, not an error.
export function validateAlertsSearch(search: Record<string, unknown>): AlertsSearch {
  const state = STATE_FILTERS.find((value) => value !== 'all' && value === search.state)
  const group = GROUPINGS.find((value) => value !== 'none' && value === search.group)
  const symbols = parseSymbols(search.symbols)

  return {
    state: state as AlertsSearch['state'],
    symbols: symbols.length > 0 ? symbols.join(',') : undefined,
    group: group as AlertsSearch['group'],
  }
}

export function parseSymbols(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const symbols = value.split(',').filter((symbol) => SYMBOL.test(symbol))
  return [...new Set(symbols)]
}

// Newest first: the Alert a person has just made is the one they look for.
// The API orders by id, which for a UUID is no order at all.
export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// The Symbol filter first, then the state. Counts are taken between the two,
// so each number on the state control is what clicking it would show.
export function narrowAlerts(alerts: readonly Alert[], symbols: readonly string[]): Alert[] {
  if (symbols.length === 0) return [...alerts]
  return alerts.filter((alert) => symbols.includes(alert.symbol))
}

export function filterByState(alerts: readonly Alert[], state: StateFilter): Alert[] {
  return alerts.filter((alert) => matchesState(alert, state))
}

export function countByState(alerts: readonly Alert[]): Record<StateFilter, number> {
  return {
    all: alerts.length,
    active: filterByState(alerts, 'active').length,
    paused: filterByState(alerts, 'paused').length,
    finished: filterByState(alerts, 'finished').length,
  }
}

// How many of the twenty slots are taken: Active and Paused. A Finished Alert
// is exempt, which is the point of saying so under the list.
//
// Counted from the derived Status; the server counts the stored one. They
// differ only for an Alert past its Expiry that the nightly sweep has not yet
// recorded, which reads `expired` here and still holds its slot there — one
// slot, for at most a day.
export function slotsUsed(alerts: readonly Alert[]): number {
  return alerts.filter((alert) => !isFinished(alert.status)).length
}

export type AlertGroup = {
  // `null` for the single group of an ungrouped list
  key: string | null
  alerts: Alert[]
}

const CONDITION_ORDER: readonly Condition[] = ['price_above', 'price_below']

// Groups keep the list's own order inside them. Symbols are alphabetical;
// Conditions go above, then below, the order the create form offers them in.
export function groupAlerts(alerts: readonly Alert[], grouping: Grouping): AlertGroup[] {
  if (grouping === 'none') return [{ key: null, alerts: [...alerts] }]

  const buckets = new Map<string, Alert[]>()
  for (const alert of alerts) {
    const key = grouping === 'symbol' ? alert.symbol : alert.condition
    buckets.set(key, [...(buckets.get(key) ?? []), alert])
  }

  const order = (key: string) =>
    grouping === 'condition' ? CONDITION_ORDER.indexOf(key as Condition) : 0
  return [...buckets]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([key, grouped]) => ({ key, alerts: grouped }))
}

// A Symbol that has left the Subscription. Not a Status: a configuration
// change is not the end of an Alert's life, so it earns no migration and no
// job — only this badge, derived from the list the screen already holds. Never
// said while that list is still loading.
export function isWithdrawn(symbol: string, subscription: readonly string[] | null): boolean {
  return subscription !== null && !subscription.includes(symbol)
}
