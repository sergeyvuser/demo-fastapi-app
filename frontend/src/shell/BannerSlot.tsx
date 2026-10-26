import { Alert as MantineAlert, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { $api } from '../api/client'
import { DemoBanner } from '../demo/DemoBanner'
import { Resend } from '../verification/Resend'

// The one slot above every signed-in screen. It holds at most one banner by
// construction — one chain of returns, not two components that each decide
// for themselves. The Demo account is permanently verified, so in practice its
// branch never meets the verification one; should it ever, the account's
// nature wins: the letter goes to a mailbox nobody signed in to it can read.
export function BannerSlot() {
  // the same query the user menu runs; the cache answers both
  const { data: me } = $api.useQuery('get', '/api/v1/users/me')

  if (!me) return null
  if (me.is_demo) return <DemoBanner />
  if (!me.is_verified) return <VerificationBanner email={me.email} />
  return null
}

// Not a lock-out: the API lets an unverified User sign in and read, and
// refuses only the creation of an Alert. The banner says so and offers the
// way out, for a letter that went to spam or never came.
function VerificationBanner({ email }: { email: string }) {
  const { t } = useTranslation()

  return (
    <MantineAlert color="yellow" variant="light" mb="md" title={t('verification.banner.title')}>
      <Stack gap="xs">
        <Text size="sm">{t('verification.banner.body', { email })}</Text>
        <Resend />
      </Stack>
    </MantineAlert>
  )
}
