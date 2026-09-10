import { useEffect, useRef, useState } from 'react';
import { BASE_PRICES, SUBSCRIPTION } from './domain';

export interface Quote {
  /** null when no fresh Tick exists for the Symbol (ticket 06). */
  price: number | null;
  /** Direction of the last change: used by the variants that flash. */
  dir: 1 | -1 | 0;
  /** Increments on every change, so a component can key an animation off it. */
  seq: number;
}

export type Quotes = Record<string, Quote>;

const INTERVAL_MS = 250; // ticket 07's sampler period, so the screen sees what the socket sends

function initial(): Quotes {
  return Object.fromEntries(
    SUBSCRIPTION.map((symbol) => [symbol, { price: BASE_PRICES[symbol] ?? null, dir: 0, seq: 0 }]),
  );
}

/**
 * A fake price feed: a random walk with a slow drift, sampled every 250 ms.
 * `live = false` freezes it, which is what a dropped socket looks like to the screen.
 */
export function useTicker(live: boolean): Quotes {
  const [quotes, setQuotes] = useState<Quotes>(initial);
  const driftRef = useRef<Record<string, number>>(
    Object.fromEntries(SUBSCRIPTION.map((s, i) => [s, (i % 3) - 1])),
  );

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setQuotes((previous) => {
        const next: Quotes = { ...previous };
        for (const symbol of SUBSCRIPTION) {
          const current = previous[symbol];
          if (current.price === null) continue; // stays null: nothing streams it

          // slow drift, re-rolled rarely, plus per-tick noise
          if (Math.random() < 0.02) driftRef.current[symbol] = Math.random() * 2 - 1;
          const drift = driftRef.current[symbol] * 0.0004;
          const noise = (Math.random() * 2 - 1) * 0.0006;
          const factor = 1 + drift + noise;
          const price = current.price * factor;

          // not every sample moves the price the exchange reports
          if (Math.random() < 0.25) {
            next[symbol] = current;
            continue;
          }

          next[symbol] = {
            price,
            dir: price > current.price ? 1 : price < current.price ? -1 : 0,
            seq: current.seq + 1,
          };
        }
        return next;
      });
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [live]);

  return quotes;
}
