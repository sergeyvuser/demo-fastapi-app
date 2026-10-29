import {
  Box,
  CloseButton,
  Divider,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { RECENT_LIMIT, useRecentTriggers } from '../history/feed'
import { TriggerRow } from '../history/TriggerRow'
import { formatThreshold } from '../i18n/format'
import { resolvedLanguage } from '../i18n/language'
import { usePrecision } from '../prices/store'
import { AnchorLink } from '../shell/links'
import type { Alert } from './list'
import { PriceChart } from './PriceChart'

// One Alert, opened beside the list: what this rule has been doing. Its chart
// with the Threshold across it, then its own latest Triggers — the global feed
// stays a screen of its own. No header: the Symbol, the price and the rule are
// all on the card that opened it, so only a close control sits in the corner.
export function AlertDetail({ alert }: { alert: Alert }) {
  const { t, i18n } = useTranslation()
  const precision = usePrecision(alert.symbol)
  const rule = t(`alerts.rule.${alert.condition}`, {
    threshold: formatThreshold(alert.threshold, precision, resolvedLanguage(i18n)),
  })

  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      component="section"
      aria-label={`${alert.symbol} ${rule}`}
      data-testid="alert-detail"
    >
      <Stack gap="sm">
        <Box pos="relative">
          <CloseDetail />
          {/* the person's Threshold, not a number being typed: never null */}
          <PriceChart symbol={alert.symbol} threshold={Number(alert.threshold)} />
        </Box>
        <RecentTriggers alert={alert} />
      </Stack>
    </Paper>
  )
}

// Back to the list as it was: the filters in the URL stay, only the id goes.
function CloseDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <CloseButton
      size="sm"
      pos="absolute"
      top={0}
      right={0}
      style={{ zIndex: 1 }}
      aria-label={t('alerts.detail.close')}
      onClick={() => void navigate({ to: '/alerts', search: true, resetScroll: false })}
    />
  )
}

function RecentTriggers({ alert }: { alert: Alert }) {
  const { t } = useTranslation()
  const triggers = useRecentTriggers(alert.id)

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="baseline" gap="xs">
        <Title order={2} size="sm">
          {t('alerts.detail.recent')}
        </Title>
        {/* the rest lives in History, narrowed to this Alert */}
        {alert.trigger_count > 0 && (
          <AnchorLink to="/history" search={{ alert: alert.id }} size="xs">
            {t('alerts.detail.seeAll', { count: alert.trigger_count })}
          </AnchorLink>
        )}
      </Group>
      {triggers.isPending ? (
        <Skeleton h={RECENT_LIMIT * 24} />
      ) : triggers.isError ? (
        <Text size="sm" c="dimmed">
          {t('alerts.detail.triggersFailed')}
        </Text>
      ) : triggers.data.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('alerts.detail.noTriggers')}
        </Text>
      ) : (
        <Box role="list">
          {triggers.data.map((trigger, index) => (
            <Fragment key={trigger.id}>
              {index > 0 && <Divider my="xs" />}
              <div role="listitem">
                <TriggerRow trigger={trigger} />
              </div>
            </Fragment>
          ))}
        </Box>
      )}
    </Stack>
  )
}
