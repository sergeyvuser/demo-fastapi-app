import { LineChart } from '@mantine/charts'
import { Box, Skeleton, Text } from '@mantine/core'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { YAxisTickContentProps } from 'recharts'

import { $api } from '../api/client'
import { formatPrice, formatThreshold } from '../i18n/format'
import { resolvedLanguage } from '../i18n/language'
import { formatTimeOfDay } from '../i18n/time'
import { usePrecision, useSampledPrice } from '../prices/store'
import { hourTicks, priceAxis, toPoints, type PriceTick, type TickKind } from './chart'

const HEIGHT = 240

// One line, of closes, in the brand colour.
const SERIES = [{ name: 'close', color: 'aurora.6' }]

// What each named value is painted in: its own line's colour, so the number
// on the axis and the line across the plot read as one thing.
const LABEL_COLOR: Record<TickKind, string> = {
  round: 'currentColor',
  threshold: 'var(--mantine-color-red-6)',
  live: 'var(--mantine-color-gray-6)',
}

type Props = {
  symbol: string
  // the number the person is typing; null while it does not parse
  threshold: number | null
}

// The last 24 hours of one Symbol, with the Threshold across it. Shown beside
// the Threshold field and on the Alert's own screen — the two places where it
// changes a decision — and nowhere else.
//
// Memoised and fed only primitives: the form re-renders on every keystroke,
// and this must redraw when the Threshold or the sampled price moves, not
// whenever its parent does.
export const PriceChart = memo(function PriceChart({ symbol, threshold }: Props) {
  const { t } = useTranslation()
  // The candles are not live at all: one fetch, and the server caches for a
  // minute anyway. Failing is a state of this box and of nothing else.
  const candles = $api.useQuery(
    'get',
    '/api/v1/symbols/{symbol}/candles',
    { params: { path: { symbol } } },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  )

  if (candles.isPending) return <Skeleton h={HEIGHT} data-testid="chart-loading" />
  if (candles.isError || candles.data.items.length === 0) {
    return (
      <Box h={HEIGHT} display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text size="sm" c="dimmed" ta="center" maw={280} role="status">
          {t('alertForm.chart.unavailable')}
        </Text>
      </Box>
    )
  }
  return <Plot symbol={symbol} threshold={threshold} candles={candles.data.items} />
})

type PlotProps = Props & {
  candles: Parameters<typeof toPoints>[0]
}

function Plot({ symbol, threshold, candles }: PlotProps) {
  const { i18n } = useTranslation()
  const language = resolvedLanguage(i18n)
  // At most once a second: the card's number beside the field runs at full
  // rate, and both read the same store.
  const sampled = useSampledPrice(symbol)
  const precision = usePrecision(symbol)
  const live = sampled === null ? null : Number(sampled)

  const points = useMemo(() => toPoints(candles), [candles])
  const from = points[0].time
  const to = points[points.length - 1].time
  const times = useMemo(() => hourTicks(from, to), [from, to])
  const axis = priceAxis(
    points.map((point) => point.close),
    threshold,
    live,
  )
  const kinds = new Map(axis.ticks.map((tick) => [tick.value, tick.kind]))

  // A round tick shows the digits it has (`0.52`, `71,000`); the two named
  // values show the Symbol's precision, as everywhere else they appear.
  const label = (tick: PriceTick) =>
    tick.kind === 'threshold'
      ? formatThreshold(String(tick.value), precision, language)
      : formatPrice(
          tick.value,
          tick.kind === 'live' ? (precision ?? 2) : (String(tick.value).split('.')[1]?.length ?? 0),
          language,
        )

  const referenceLines = []
  if (threshold !== null) {
    referenceLines.push({ y: threshold, color: 'red.6', strokeDasharray: '6 4', strokeWidth: 1.5 })
  }
  if (live !== null) referenceLines.push({ y: live, color: 'gray.6', strokeWidth: 1 })

  return (
    <LineChart
      h={HEIGHT}
      data={points}
      dataKey="time"
      series={SERIES}
      curveType="linear"
      withDots={false}
      withTooltip={false}
      gridAxis="none"
      referenceLines={referenceLines}
      // The animation would replay on every once-a-second redraw.
      lineProps={{ isAnimationActive: false }}
      // room above the top tick, whose label is centred on the plot's edge
      lineChartProps={{ margin: { top: 10, right: 10 } }}
      data-testid="price-chart"
      xAxisProps={{
        type: 'number',
        scale: 'time',
        domain: [from, to],
        ticks: times,
        interval: 0,
        axisLine: true,
        tickLine: true,
        tickFormatter: (time: number) => formatTimeOfDay(time, language),
      }}
      yAxisProps={{
        type: 'number',
        domain: axis.domain,
        // sorted by priceAxis; an unsorted array loses ticks without a word
        ticks: axis.ticks.map((tick) => tick.value),
        interval: 0,
        axisLine: true,
        tickLine: true,
        width: 72,
        tick: ({ x, y, payload }: YAxisTickContentProps) => {
          const value = Number(payload.value)
          const kind = kinds.get(value) ?? 'round'
          return (
            <text
              x={x}
              y={y}
              dy={4}
              textAnchor="end"
              fontSize={11}
              fontWeight={kind === 'round' ? 400 : 700}
              fill={LABEL_COLOR[kind]}
              data-kind={kind}
            >
              {label({ value, kind })}
            </text>
          )
        },
      }}
    />
  )
}
