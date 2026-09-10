import { BASE_PRICES } from './domain';

export interface Candle {
  /** "HH:mm" — 15-minute steps over the last 24 hours. */
  t: string;
  close: number;
}

/**
 * A day of fake closes at 15-minute steps, so a chart has a shape to argue about and the bottom axis
 * has real hours to label. Stands in for ticket 15's Bybit kline proxy, which stores nothing.
 */
export function fakeCandles(symbol: string): Candle[] {
  const base = BASE_PRICES[symbol] ?? 18;
  // floored to the hour, so the 15-minute steps land on :00 / :15 / :30 / :45 and the bottom axis
  // has whole hours to label
  const start = new Date(Math.floor((Date.now() - 24 * 3600_000) / 3600_000) * 3600_000);
  let price = base * 0.985;

  return Array.from({ length: 96 }, (_, i) => {
    price *= 1 + (Math.sin(i / 7) * 0.0018 + (Math.random() - 0.48) * 0.0025);
    const at = new Date(start.getTime() + i * 15 * 60_000);
    const t = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    return { t, close: Number(price.toFixed(price < 10 ? 6 : 2)) };
  });
}
