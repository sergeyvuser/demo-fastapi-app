import { Button, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../api/problem'
import { useResendVerification } from './verify'

// The "send it again" button and what it has to say afterwards. One component
// for the banner and the Verification landing, so the two never word the same
// answer differently.
export function Resend() {
  const { t } = useTranslation()
  const resend = useResendVerification()

  return (
    <Stack gap={6} align="flex-start">
      <Button
        size="xs"
        variant="default"
        loading={resend.isPending}
        onClick={() => resend.mutate()}
      >
        {t('verification.resend.action')}
      </Button>
      {resend.isSuccess && <Feedback>{t('verification.resend.sent')}</Feedback>}
      {resend.isError && <ResendRefusal error={resend.error} />}
    </Stack>
  )
}

function ResendRefusal({ error }: { error: Error }) {
  const { t } = useTranslation()
  if (error instanceof ApiError && error.status === 409) {
    return <Feedback>{t('verification.resend.already')}</Feedback>
  }
  // The limit is a sentence, not a red error: nothing is broken, and the
  // letters already sent are still on their way.
  if (error instanceof ApiError && error.status === 429) {
    return (
      <Feedback>
        {error.retryAfter === null
          ? t('verification.resend.limitedSoon')
          : t('verification.resend.limited', {
              count: Math.max(1, Math.ceil(error.retryAfter / 60)),
            })}
      </Feedback>
    )
  }
  return (
    <Text size="sm" c="red" role="alert">
      {t('verification.resend.failed')}
    </Text>
  )
}

function Feedback({ children }: { children: string }) {
  // role="status": announced by a screen reader without taking the focus
  return (
    <Text size="sm" role="status">
      {children}
    </Text>
  )
}
