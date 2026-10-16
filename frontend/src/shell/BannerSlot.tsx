import { Alert as MantineAlert, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { $api } from '../api/client'
import { Resend } from '../verification/Resend'

// The one slot above every signed-in screen. It holds at most one banner by
// construction — a single return, not two components that each decide for
// themselves. Ticket 23's "this account is shared" joins as a second branch;
// the demo account is always verified, so its branch never meets this one.
export function BannerSlot() {
  // the same query the user menu runs; the cache answers both
  const { data: me } = $api.useQuery('get', '/api/v1/users/me')

  if (me && !me.is_verified) return <VerificationBanner email={me.email} />
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
