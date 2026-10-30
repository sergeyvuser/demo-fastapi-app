import { Stack, Switch, Text } from '@mantine/core'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../api/problem'
import { useDemo } from '../demo/demo'
import { resolvedLanguage } from '../i18n/language'
import { formatTimeOfDay } from '../i18n/time'
import { digestInstant, useDigestSwitch } from './account'

type Props = {
  enabled: boolean
  email: string
  isDemo: boolean
  // from GET /notifications; null until it answers
  hourUtc: number | null
}

// The one place the Digest is announced at all: the switch is the
// announcement, so its contents and its hour are said beside it, before
// anyone turns it on. The hour is UTC on the server and converted here — no
// time zone is stored on a User.
export function Digest({ enabled, email, isDemo, hourUtc }: Props) {
  const { t, i18n } = useTranslation()
  const language = resolvedLanguage(i18n)
  const toggle = useDigestSwitch()
  // while a change is in flight the switch shows what was asked for
  const checked = toggle.isPending ? toggle.variables : enabled
  const about = useId()

  return (
    <Stack gap="xs">
      {/* The contents are said beside the switch, not through its own
          `description`: Mantine puts that inside the <label>, so a screen
          reader would hear the whole paragraph as the switch's name, and
          then again as its description. */}
      <Switch
        checked={checked}
        disabled={toggle.isPending}
        onChange={(event) => toggle.mutate(event.currentTarget.checked)}
        label={t('account.digest.switch')}
        aria-describedby={about}
      />
      <Stack gap={4} id={about}>
        <Text size="sm" c="dimmed">
          {hourUtc === null
            ? t('account.digest.contentsNoTime', { email })
            : t('account.digest.contents', {
                email,
                time: formatTimeOfDay(digestInstant(hourUtc), language),
              })}
        </Text>
        <Text size="sm" c="dimmed">
          {t('account.digest.quiet')}
        </Text>
        {!checked && (
          <Text size="sm" c="dimmed">
            {t('account.digest.off')}
          </Text>
        )}
      </Stack>
      {isDemo && <DemoNote />}
      {toggle.isError && (
        <Text size="sm" c="red" role="alert">
          {toggle.error instanceof ApiError && toggle.error.status === 403
            ? t('account.digest.unverified')
            : t('account.digest.failed')}
        </Text>
      )}
    </Stack>
  )
}

// Live on the demo account, unlike the Linked chat: a Digest switched on by a
// stranger harms nobody but the project's own mailbox, and the nightly reset
// turns it back off. Said here, so it does not read as an oversight.
function DemoNote() {
  const { t, i18n } = useTranslation()
  const demo = useDemo()

  return (
    <Text size="sm" c="dimmed">
      {demo === null
        ? t('account.digest.demoNoTime')
        : t('account.digest.demo', {
            time: formatTimeOfDay(Date.parse(demo.resetsAt), resolvedLanguage(i18n)),
          })}
    </Text>
  )
}
