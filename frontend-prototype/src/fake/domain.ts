// Fake domain data. The vocabulary is CONTEXT.md's, deliberately: Alert, Condition, Threshold,
// Trigger, Repeat policy, Expiry, Cooldown, Symbol, Subscription. No API is involved anywhere.

export type Condition = 'price_above' | 'price_below';
export type RepeatPolicy = 'once' | 'while_true' | 'on_cross';
export type AlertState = 'active' | 'paused' | 'completed' | 'expired';

export interface Alert {
  id: string;
  symbol: string;
  condition: Condition;
  threshold: number;
  repeat_policy: RepeatPolicy;
  /** null means "no debounce" (ticket 14 §1); meaningless for `once`. */
  cooldown_seconds: number | null;
  expires_at: string | null;
  /** Backend-derived display state (ticket 14 §4) — what every screen renders. */
  state: AlertState;
  finished_at: string | null;
  trigger_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

export interface Trigger {
  id: string;
  alert_id: string;
  symbol: string;
  condition: Condition;
  threshold: number;
  price: number;
  delivery: 'queued' | 'no_chat';
  created_at: string;
}

/** The Subscription: what the system streams. One system-wide choice, per CONTEXT.md. */
export const SUBSCRIPTION = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'BNBUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'LINKUSDT',
] as const;

/**
 * The reference price a live price is coloured against: the price 24 h ago.
 *
 * Exchanges do not colour a price by the direction of its last tick — that is the trades list and
 * the order book, where the flicker is the information. A ticker card is coloured against a fixed
 * reference (24 h ago), and a chart's last price against the open of the current candle; both are
 * stable for minutes or hours at a time. Bybit's `tickers.{symbol}` topic — the one the ingestor
 * already subscribes to — carries `prevPrice24h` and `price24hPcnt` beside the `lastPrice` we keep,
 * so this number is arriving and being discarded today.
 */
export const REFERENCE_PRICES: Record<string, number | null> = {
  BTCUSDT: 67_940.0, // up on the day
  ETHUSDT: 3_602.1, // down on the day
  SOLUSDT: 168.4,
  XRPUSDT: 0.6398,
  BNBUSDT: 601.2,
  DOGEUSDT: 0.1611,
  ADAUSDT: 0.4402,
  LINKUSDT: null,
};

export const BASE_PRICES: Record<string, number | null> = {
  BTCUSDT: 68_420.5,
  ETHUSDT: 3_512.44,
  SOLUSDT: 172.31,
  XRPUSDT: 0.6231,
  BNBUSDT: 604.9,
  DOGEUSDT: 0.1584,
  ADAUSDT: 0.4471,
  // ticket 06: a Symbol with no fresh Tick has a null price, and the UI must survive it.
  LINKUSDT: null,
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const daysAhead = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

export const ALERTS: Alert[] = [
  {
    id: 'a1',
    symbol: 'BTCUSDT',
    condition: 'price_above',
    threshold: 70_000,
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    expires_at: null,
    state: 'active',
    finished_at: null,
    trigger_count: 0,
    last_triggered_at: null,
    created_at: minutesAgo(60 * 26),
  },
  {
    id: 'a2',
    symbol: 'ETHUSDT',
    condition: 'price_below',
    threshold: 3_500,
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    expires_at: daysAhead(6),
    state: 'active',
    finished_at: null,
    trigger_count: 14,
    last_triggered_at: minutesAgo(37),
    created_at: minutesAgo(60 * 24 * 9),
  },
  {
    id: 'a3',
    symbol: 'SOLUSDT',
    condition: 'price_above',
    threshold: 175,
    repeat_policy: 'on_cross',
    cooldown_seconds: 300,
    expires_at: null,
    state: 'active',
    finished_at: null,
    trigger_count: 3,
    last_triggered_at: minutesAgo(8),
    created_at: minutesAgo(60 * 5),
  },
  {
    id: 'a4',
    symbol: 'DOGEUSDT',
    condition: 'price_above',
    threshold: 0.2,
    repeat_policy: 'once',
    cooldown_seconds: null,
    expires_at: daysAhead(0.4),
    state: 'active',
    finished_at: null,
    trigger_count: 0,
    last_triggered_at: null,
    created_at: minutesAgo(90),
  },
  {
    id: 'a5',
    symbol: 'XRPUSDT',
    condition: 'price_below',
    threshold: 0.55,
    repeat_policy: 'while_true',
    cooldown_seconds: 7200,
    expires_at: null,
    state: 'paused',
    finished_at: null,
    trigger_count: 2,
    last_triggered_at: minutesAgo(60 * 30),
    created_at: minutesAgo(60 * 24 * 21),
  },
  {
    id: 'a6',
    symbol: 'BNBUSDT',
    condition: 'price_above',
    threshold: 600,
    repeat_policy: 'once',
    cooldown_seconds: null,
    expires_at: null,
    state: 'completed',
    finished_at: minutesAgo(60 * 11),
    trigger_count: 1,
    last_triggered_at: minutesAgo(60 * 11),
    created_at: minutesAgo(60 * 24 * 3),
  },
  {
    id: 'a7',
    symbol: 'ADAUSDT',
    condition: 'price_below',
    threshold: 0.4,
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    expires_at: minutesAgo(60 * 20),
    state: 'expired',
    finished_at: minutesAgo(60 * 20),
    trigger_count: 0,
    last_triggered_at: null,
    created_at: minutesAgo(60 * 24 * 8),
  },
  {
    id: 'a8',
    symbol: 'LINKUSDT',
    condition: 'price_above',
    threshold: 18,
    repeat_policy: 'while_true',
    cooldown_seconds: 3600,
    expires_at: null,
    state: 'active',
    finished_at: null,
    trigger_count: 0,
    last_triggered_at: null,
    created_at: minutesAgo(20),
  },
];

/** The `many` dataset: what the list looks like at the per-user limit of 20 (ACTIVE + PAUSED). */
export const MANY_ALERTS: Alert[] = [
  ...ALERTS,
  ...Array.from({ length: 14 }, (_, i): Alert => {
    const symbol = SUBSCRIPTION[i % SUBSCRIPTION.length];
    const base = BASE_PRICES[symbol] ?? 18;
    const above = i % 2 === 0;
    return {
      id: `m${i}`,
      symbol,
      condition: above ? 'price_above' : 'price_below',
      threshold: Number((base * (above ? 1 + (i % 7) / 100 : 1 - (i % 7) / 100)).toPrecision(5)),
      repeat_policy: (['while_true', 'on_cross', 'once'] as const)[i % 3],
      cooldown_seconds: i % 3 === 2 ? null : 3600,
      expires_at: i % 5 === 0 ? daysAhead(1 + i) : null,
      state: i % 6 === 5 ? 'paused' : 'active',
      finished_at: null,
      trigger_count: i % 4,
      last_triggered_at: i % 4 ? minutesAgo(12 * (i + 1)) : null,
      created_at: minutesAgo(60 * (i + 2)),
    };
  }),
];

export const TRIGGERS: Trigger[] = [
  {
    id: 't1',
    alert_id: 'a3',
    symbol: 'SOLUSDT',
    condition: 'price_above',
    threshold: 175,
    price: 175.42,
    delivery: 'no_chat',
    created_at: minutesAgo(8),
  },
  {
    id: 't2',
    alert_id: 'a2',
    symbol: 'ETHUSDT',
    condition: 'price_below',
    threshold: 3_500,
    price: 3_498.11,
    delivery: 'queued',
    created_at: minutesAgo(37),
  },
  {
    id: 't3',
    alert_id: 'a2',
    symbol: 'ETHUSDT',
    condition: 'price_below',
    threshold: 3_500,
    price: 3_491.02,
    delivery: 'queued',
    created_at: minutesAgo(97),
  },
  {
    id: 't4',
    alert_id: 'a6',
    symbol: 'BNBUSDT',
    condition: 'price_above',
    threshold: 600,
    price: 601.37,
    delivery: 'queued',
    created_at: minutesAgo(60 * 11),
  },
  {
    id: 't5',
    alert_id: 'a3',
    symbol: 'SOLUSDT',
    condition: 'price_above',
    threshold: 175,
    price: 176.9,
    delivery: 'no_chat',
    created_at: minutesAgo(60 * 14),
  },
  {
    id: 't6',
    alert_id: 'a5',
    symbol: 'XRPUSDT',
    condition: 'price_below',
    threshold: 0.55,
    price: 0.5488,
    delivery: 'queued',
    created_at: minutesAgo(60 * 30),
  },
  {
    id: 't7',
    alert_id: 'a2',
    symbol: 'ETHUSDT',
    condition: 'price_below',
    threshold: 3_500,
    price: 3_477.8,
    delivery: 'queued',
    created_at: minutesAgo(60 * 44),
  },
];

// ---------------------------------------------------------------------------
// formatting helpers — Intl only, as the i18n boundary requires

const priceFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const smallPriceFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export function formatPrice(value: number): string {
  return value < 10 ? smallPriceFormat.format(value) : priceFormat.format(value);
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}

export function conditionSign(condition: Condition): string {
  return condition === 'price_above' ? '≥' : '≤';
}

export function conditionWord(condition: Condition): string {
  return condition === 'price_above' ? 'above' : 'below';
}

/**
 * How far the price has to move, in percent, before the Condition holds.
 * Negative means the Condition already holds.
 */
export function distancePct(alert: Alert, price: number | null): number | null {
  if (price === null) return null;
  const raw = ((alert.threshold - price) / price) * 100;
  return alert.condition === 'price_above' ? raw : -raw;
}

export function repeatLabel(policy: RepeatPolicy): string {
  return { once: 'Once', while_true: 'While true', on_cross: 'On cross' }[policy];
}

export function stateLabel(state: AlertState): string {
  return { active: 'Active', paused: 'Paused', completed: 'Completed', expired: 'Expired' }[state];
}

export function stateColor(state: AlertState): string {
  return { active: 'teal', paused: 'yellow', completed: 'blue', expired: 'gray' }[state];
}

export function isFinished(alert: Alert): boolean {
  return alert.state === 'completed' || alert.state === 'expired';
}

/**
 * The colour of a live price: measured against the 24 h reference, never against the last Tick.
 * Returns undefined when there is nothing to compare against, so the number renders in body text.
 */
export function priceColor(symbol: string, price: number | null): string | undefined {
  const reference = REFERENCE_PRICES[symbol];
  if (price === null || reference === null || reference === undefined) return undefined;
  if (price > reference) return 'teal';
  if (price < reference) return 'red';
  return undefined;
}

/** How much the price has moved since the reference, in percent. */
export function changePct(symbol: string, price: number | null): number | null {
  const reference = REFERENCE_PRICES[symbol];
  if (price === null || reference === null || reference === undefined) return null;
  return ((price - reference) / reference) * 100;
}
