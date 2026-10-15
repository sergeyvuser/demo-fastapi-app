import { Group, Text, type TextProps } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { formatChange, formatPrice } from '../i18n/format'
import { resolvedLanguage } from '../i18n/language'
import { useRealtimeStatus } from '../realtime/status'
import { dayChange, DIRECTION_COLOR } from './change'
import { useQuote } from './store'

type Props = TextProps & { symbol: string }

type DayChangeProps = Props & {
  // "24 h" written beside the number, where there is room to say what it is
  caption?: boolean
}

// Tabular figures, or every Tick nudges whatever sits beside the number.
const FIGURES = { fontVariantNumeric: 'tabular-nums' } as const

// A socket that should be live and is not. The number stays where it is —
// blanking it would throw away what the person knew a second ago — but it is
// greyed, because bright would claim it is still moving. The strip says why.
function useStale(): boolean {
  return useRealtimeStatus() === 'down'
}

// The live price of one Symbol, in the reader's number format and at the
// Symbol's own precision. A missing price is said in words — never drawn as
// 0, a dash or the last number seen: each of those is a claim about the market.
export function Price({ symbol, ...props }: Props) {
  const { t, i18n } = useTranslation()
  const quote = useQuote(symbol)
  const stale = useStale()

  if (quote?.price == null) {
    return (
      <Text c="dimmed" {...props}>
        {t('prices.noFreshPrice')}
      </Text>
    )
  }

  return (
    // after the spread: staleness is not something a caller may override
    <Text style={FIGURES} {...props} c={stale ? 'dimmed' : props.c}>
      {formatPrice(quote.price, quote.precision, resolvedLanguage(i18n))}
    </Text>
  )
}

// The change since 24 hours ago, coloured by it. Nothing at all when either
// price is missing: an empty slot is honest, a "0.00%" is not. Grey while
// stale, like the price: green or red says which way the market is going now.
export function DayChange({ symbol, caption = false, ...props }: DayChangeProps) {
  const { t, i18n } = useTranslation()
  const quote = useQuote(symbol)
  const stale = useStale()
  const change = quote ? dayChange(quote.price, quote.referencePrice) : null

  if (change === null) return null

  const value = (
    <Text
      style={FIGURES}
      title={t('prices.dayChangeTitle')}
      {...props}
      c={stale ? 'dimmed' : DIRECTION_COLOR[change.direction]}
    >
      {formatChange(change.ratio, resolvedLanguage(i18n))}
    </Text>
  )
  if (!caption) return value

  return (
    <Group gap={6} wrap="nowrap">
      {value}
      <Text size={props.size} c="dimmed">
        {t('prices.dayChange')}
      </Text>
    </Group>
  )
}
