import { Anchor, Collapse, List, Alert as MantineAlert, Stack, Text } from '@mantine/core'
import { useDisclosure, useId } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'

import { resolvedLanguage } from '../i18n/language'
import { useNow } from '../i18n/now'
import { formatRelative, formatTimeOfDay } from '../i18n/time'
import { useDemo } from './demo'

// Demo is a property of the account, not of a session: this banner is shown
// to the account, every time, and speaks only in advance. Nothing here
// explains a change after the fact — on a shared account "it vanished" and
// "someone deleted it" look the same, and any explanation would be a guess.
//
// One sentence, the rest behind a disclosure. The limit and the barred Linked
// chat are said where they happen (the create form, the Account screen), not
// here: a banner listing five things is a banner nobody reads.
export function DemoBanner() {
  const { t, i18n } = useTranslation()
  const demo = useDemo()
  const now = useNow()
  const [open, { toggle }] = useDisclosure(false)
  const detailsId = useId()

  const language = resolvedLanguage(i18n)
  const resetsAt = demo ? Date.parse(demo.resetsAt) : null
  // A reset already behind us is about to be replaced by the next one; until
  // that answer lands the sentence leaves the time out rather than say "ago".
  const upcoming = resetsAt !== null && resetsAt > now ? resetsAt : null

  return (
    <MantineAlert color="blue" variant="light" mb="md">
      <Stack gap="xs">
        <Text size="sm">
          {upcoming === null
            ? t('demo.banner.shared')
            : t('demo.banner.sharedResets', { when: formatRelative(upcoming, now, language) })}
        </Text>
        <Anchor
          component="button"
          type="button"
          size="sm"
          ta="start"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={toggle}
        >
          {t('demo.banner.more')}
        </Anchor>
        <Collapse expanded={open} id={detailsId}>
          <List size="sm" spacing={4}>
            <List.Item>{t('demo.banner.others')}</List.Item>
            {resetsAt !== null && (
              <List.Item>
                {t('demo.banner.reset', { time: formatTimeOfDay(resetsAt, language) })}
              </List.Item>
            )}
            <List.Item>{t('demo.banner.own')}</List.Item>
          </List>
        </Collapse>
      </Stack>
    </MantineAlert>
  )
}
