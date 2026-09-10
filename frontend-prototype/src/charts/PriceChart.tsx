import { LineChart } from '@mantine/charts';
import { memo, useEffect, useRef, useState } from 'react';
import type { Candle } from '../fake/candles';
import { formatPrice } from '../fake/domain';

/**
 * The Symbol's last 24 h with the Threshold drawn across it, and the live price as a second line.
 *
 * Two things are deliberate here and belong in the spec:
 *
 * 1. The candle series is *not* live. It comes from ticket 15's kline proxy and changes once a
 *    candle, so the heavy part of the SVG is redrawn rarely.
 * 2. The live price is throttled to 1 Hz before it reaches the chart. At the socket's own 250 ms it
 *    redraws the whole plot four times a second and the tab stops responding — measured, not
 *    feared. This is ticket 10's decision made visible: Ticks belong in a small store whose readers
 *    are the few elements that actually show a price.
 */
const LIVE_PRICE_HZ_MS = 1000;

interface TickProps {
  x: number;
  y: number;
  payload: { value: number };
}

export interface PriceChartProps {
  candles: Candle[];
  threshold: number;
  livePrice?: number | null;
  height?: number;
}

export function PriceChart({ candles, threshold, livePrice = null, height = 240 }: PriceChartProps) {
  const throttled = useThrottled(livePrice, LIVE_PRICE_HZ_MS);
  return <Plot candles={candles} threshold={threshold} livePrice={throttled} height={height} />;
}

const Plot = memo(function Plot({ candles, threshold, livePrice, height }: Required<PriceChartProps>) {
  const closes = candles.map((candle) => candle.close);
  const low = Math.min(...closes, threshold, livePrice ?? Infinity);
  const high = Math.max(...closes, threshold, livePrice ?? -Infinity);
  const pad = (high - low) * 0.1 || high * 0.01;
  const domain: [number, number] = [low - pad, high + pad];

  // round numbers on the left, with the Threshold and the live price sitting among them
  const span = high - low;
  const showLive = livePrice !== null && farFrom(livePrice, threshold, span);
  const ticks = [
    ...niceTicks(domain[0], domain[1]).filter(
      (tick) => farFrom(tick, threshold, span) && (!showLive || farFrom(tick, livePrice, span)),
    ),
    threshold,
    ...(showLive ? [livePrice] : []),
  ].sort((a, b) => a - b); // recharts drops ticks that arrive out of order
  // one label every four hours along the bottom
  const xTicks = candles.filter((candle) => candle.t.endsWith(':00') && Number(candle.t.slice(0, 2)) % 4 === 0)
    .map((candle) => candle.t);

  return (
    <LineChart
      h={height}
      data={candles}
      dataKey="t"
      withDots={false}
      withXAxis
      gridAxis="y"
      strokeDasharray="3 3"
      valueFormatter={formatPrice}
      xAxisProps={{ ticks: xTicks, axisLine: true, tickLine: true, minTickGap: 0 }}
      yAxisProps={{
        domain,
        ticks,
        axisLine: true,
        tickLine: true,
        width: 76,
        // the Threshold and the live price are painted in the colours of their own lines, so each
        // number and the line it belongs to read as one thing
        tick: (props: TickProps) => {
          const value = props.payload.value;
          const isThreshold = value === threshold;
          const isLive = showLive && value === livePrice;
          return (
            <text
              x={props.x}
              y={props.y}
              dy={4}
              textAnchor="end"
              fontSize={11}
              fontWeight={isThreshold || isLive ? 700 : 400}
              fill={
                isThreshold
                  ? 'var(--mantine-color-red-6)'
                  : isLive
                    ? 'var(--mantine-color-gray-6)'
                    : 'var(--mantine-color-dimmed)'
              }
            >
              {formatPrice(value)}
            </text>
          );
        },
      }}
      series={[{ name: 'close', color: 'blue.6', label: 'Close' }]}
      referenceLines={[
        { y: threshold, color: 'red.6', strokeDasharray: '4 4' },
        ...(livePrice === null ? [] : [{ y: livePrice, color: 'gray.5' }]),
      ]}
    />
  );
});

/** Ticks at 1 / 2 / 2.5 / 5 × 10ⁿ, the steps that read as round numbers. */
function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = first; value <= max; value += step) out.push(Number(value.toFixed(8)));
  return out;
}

/** Drop an axis tick that would print on top of the Threshold's label. */
function farFrom(tick: number, threshold: number, span: number): boolean {
  return Math.abs(tick - threshold) > span * 0.08;
}

function useThrottled<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastAt = useRef(0);

  useEffect(() => {
    const wait = Math.max(0, ms - (Date.now() - lastAt.current));
    const id = setTimeout(() => {
      lastAt.current = Date.now();
      setThrottled(value);
    }, wait);
    return () => clearTimeout(id);
  }, [value, ms]);

  return throttled;
}
