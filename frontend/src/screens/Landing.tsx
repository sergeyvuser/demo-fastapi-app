import { Card, Group, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core'
import { useDocumentTitle } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'

import { useSession } from '../api/session'
import { DemoEntry } from '../demo/DemoEntry'
import { CoinMark } from '../prices/CoinMark'
import { DayChange, Price } from '../prices/Price'
import { usePricesUnavailable, useSymbols } from '../prices/store'
import { ButtonLink } from '../shell/links'

// The shop window: what this is, in one sentence, and proof that it is alive.
// The cards read the same price store as the strip above them — the Landing
// fetches nothing of its own.
export function Landing() {
  const { t } = useTranslation()
  // The tab is the product's name alone — "Crypto Alerts · Crypto Alerts" is
  // what the page template would make of it.
  useDocumentTitle(t('common.productName'))

  return (
    <Stack gap={48} py="xl">
      <Stack gap="md" maw={640}>
        <Title order={1}>{t('common.productName')}</Title>
        <Text size="lg">{t('landing.lede')}</Text>
        <Actions />
      </Stack>
      <Stack gap="md">
        <Title order={2} size="h4">
          {t('landing.pricesTitle')}
        </Title>
        <PriceCards />
      </Stack>
    </Stack>
  )
}

// A signed-in visitor is offered their Alerts, not an account they already
// have. While the boot is still deciding, the anonymous pair shows: it is
// what a first visit needs, and a first visit is what waits longest for an
// answer that is "no".
function Actions() {
  const { t } = useTranslation()
  const { status } = useSession()

  if (status === 'authenticated') {
    return (
      <Group>
        <ButtonLink to="/alerts">{t('landing.openAlerts')}</ButtonLink>
      </Group>
    )
  }

  return (
    <Stack gap="xl">
      <Group>
        <ButtonLink to="/register">{t('landing.register')}</ButtonLink>
        <ButtonLink to="/login" variant="default">
          {t('landing.signIn')}
        </ButtonLink>
      </Group>
      <DemoEntry />
    </Stack>
  )
}

function PriceCards() {
  const { t } = useTranslation()
  const symbols = useSymbols()
  const unavailable = usePricesUnavailable()

  // said in words, where the cards would be; the strip above says it too
  if (symbols === null && unavailable) {
    return <Text c="dimmed">{t('prices.unavailable')}</Text>
  }

  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
      {symbols === null
        ? [0, 1].map((index) => <Skeleton key={index} height={112} radius="md" />)
        : symbols.map((symbol) => <PriceCard key={symbol} symbol={symbol} />)}
    </SimpleGrid>
  )
}

function PriceCard({ symbol }: { symbol: string }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Group gap="sm" wrap="nowrap">
        <CoinMark symbol={symbol} size={36} />
        <Text fw={600}>{symbol}</Text>
      </Group>
      <Price symbol={symbol} mt="sm" fz={26} fw={700} lh={1.2} />
      {/* the row keeps its height when there is no change to show, so the
          cards in a grid stay level */}
      <Group mih={22}>
        <DayChange symbol={symbol} size="sm" fw={600} caption />
      </Group>
    </Card>
  )
}
