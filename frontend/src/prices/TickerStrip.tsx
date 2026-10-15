import { Group, Loader, ScrollArea, Skeleton, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { useRealtimeStatus } from '../realtime/status'
import { CoinMark } from './CoinMark'
import { DayChange, Price } from './Price'
import { useSymbols } from './store'

// Exported for the shell, which reserves this much of the header for it.
export const STRIP_HEIGHT = 36

// The market at a glance, on every screen: one item per streamed Symbol.
// Horizontal and scrollable rather than wrapped — two Symbols fit at 375 px,
// eight would not, and a strip that grows a second row pushes the page down
// whenever the Subscription changes.
export function TickerStrip() {
  const { t } = useTranslation()
  const symbols = useSymbols()

  return (
    <ScrollArea type="never">
      <Group
        component="section"
        aria-label={t('prices.strip')}
        h={STRIP_HEIGHT}
        gap="lg"
        wrap="nowrap"
        px="md"
      >
        <Reconnecting />
        {symbols === null
          ? [0, 1].map((index) => <Skeleton key={index} height={14} width={160} />)
          : symbols.map((symbol) => <TickerItem key={symbol} symbol={symbol} />)}
      </Group>
    </ScrollArea>
  )
}

// The reason every price on the page is grey, said once: the strip is on
// every screen, and one word per Alert row would be noise. First in the strip,
// so a phone sees it without scrolling it. A status region, so a screen
// reader hears it come and go.
function Reconnecting() {
  const { t } = useTranslation()
  const down = useRealtimeStatus() === 'down'

  // The region is always there — one that appears together with its text is
  // not announced — but `contents` gives it no box, so while empty it takes
  // no gap in the strip.
  return (
    <div role="status" style={{ display: 'contents' }}>
      {down && (
        <Group gap={6} wrap="nowrap" style={{ whiteSpace: 'nowrap' }}>
          <Loader size={12} />
          <Text size="xs" c="dimmed">
            {t('prices.reconnecting')}
          </Text>
        </Group>
      )}
    </div>
  )
}

function TickerItem({ symbol }: { symbol: string }) {
  return (
    <Group gap={6} wrap="nowrap" style={{ whiteSpace: 'nowrap' }}>
      <CoinMark symbol={symbol} size={18} />
      <Text size="xs" fw={600}>
        {symbol}
      </Text>
      <Price symbol={symbol} size="xs" />
      <DayChange symbol={symbol} size="xs" />
    </Group>
  )
}
