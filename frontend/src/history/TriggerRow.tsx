import { Badge, Box, Group, Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { formatThreshold } from '../i18n/format'
import { resolvedLanguage } from '../i18n/language'
import { useInstant } from '../i18n/time'
import { CoinMark } from '../prices/CoinMark'
import { useQuote } from '../prices/store'
import { AnchorLink } from '../shell/links'
import type { Trigger } from './feed'

// One occasion an Alert went off: what it watched, the rule as it stood then,
// what the market actually did, and when. Everything comes from the Trigger
// itself — a snapshot, so an Alert edited since does not rewrite its past —
// and through props, so the Alert's own screen (ticket 27) lists the same
// row without a second component.
export function TriggerRow({ trigger }: { trigger: Trigger }) {
  const { t, i18n } = useTranslation()
  const language = resolvedLanguage(i18n)
  // Only the Symbol's display precision is read from the live store. A
  // Symbol that has left the Subscription has none, and then the numbers
  // keep the digits they were stored with.
  const precision = useQuote(trigger.symbol)?.precision
  const threshold = formatThreshold(trigger.threshold, precision, language)
  const price = formatThreshold(trigger.price, precision, language)
  const noChat = trigger.delivery === 'no_chat'

  return (
    <Group
      align="flex-start"
      wrap="nowrap"
      gap="xs"
      data-testid="trigger-row"
      data-trigger-id={trigger.id}
    >
      <CoinMark symbol={trigger.symbol} size={28} />
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Group justify="space-between" align="baseline" wrap="nowrap" gap="xs">
          <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
            <Text fw={700}>{trigger.symbol}</Text>
            {noChat && (
              <Badge size="xs" variant="light" color="orange">
                {t('history.noChat.badge')}
              </Badge>
            )}
          </Group>
          <FiredAt instant={trigger.triggered_at} />
        </Group>
        <Text size="sm">
          {t(`alerts.rule.${trigger.condition}`, { threshold })}
          <Text span c="dimmed" aria-hidden>
            {' · '}
          </Text>
          {/* the price that went through the Threshold: what the market did,
              beside what the rule said */}
          <Text span fw={600}>
            {t('history.firedAt', { price })}
          </Text>
        </Text>
        {noChat && <NoChat />}
      </Box>
    </Group>
  )
}

function FiredAt({ instant }: { instant: string }) {
  const { text, exact } = useInstant(instant, { past: true })

  return (
    <Tooltip label={exact} withArrow>
      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
        <time dateTime={instant}>{text}</time>
      </Text>
    </Tooltip>
  )
}

// Said in words, not left to a badge or a tooltip: this is the one row a
// person cannot otherwise account for — the Alert fired and Telegram stayed
// silent — and the sentence says why and where to fix it.
function NoChat() {
  const { t } = useTranslation()

  return (
    <Text size="xs" c="dimmed" mt={2}>
      {t('history.noChat.explained')}{' '}
      <AnchorLink to="/account" size="xs">
        {t('history.noChat.action')}
      </AnchorLink>
    </Text>
  )
}
