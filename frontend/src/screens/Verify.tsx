import { Button, Group, Loader, Text, Title } from '@mantine/core'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { $api } from '../api/client'
import { useSession } from '../api/session'
import { usePageTitle } from '../i18n/documentTitle'
import { ButtonLink } from '../shell/links'
import { Resend } from '../verification/Resend'
import { useVerification, type Outcome } from '../verification/verify'
import { AuthCard } from './AuthCard'

const route = getRouteApi('/verify')

// Signing in from here lands on the Alerts, which is what a confirmed address
// is for.
const AFTER_SIGN_IN = { redirect: '/alerts' }

// Where the letter's link lands. The token is read once and then taken out
// of the address bar, so it survives in no history entry, no shared link and
// no screenshot; the API sees it only in a request body (ticket 09).
export function Verify() {
  const { t } = useTranslation()
  usePageTitle('verification.title')
  const search = route.useSearch()
  const navigate = useNavigate()
  // Held here, because the URL is about to lose it.
  const [token] = useState(search.token)
  useEffect(() => {
    // replace, not push: Back must not return to the URL that carried it
    if (search.token !== undefined) void navigate({ to: '/verify', search: {}, replace: true })
  }, [search.token, navigate])

  const verification = useVerification(token)

  return (
    <AuthCard>
      {verification.isPending && (
        <Group gap="sm">
          <Loader size="sm" />
          <Text>{t('verification.checking')}</Text>
        </Group>
      )}
      {verification.isError && (
        <>
          <Text role="alert">{t('verification.failed')}</Text>
          <Button variant="default" onClick={() => void verification.refetch()}>
            {t('verification.retry')}
          </Button>
        </>
      )}
      {verification.isSuccess && <Result outcome={verification.data} />}
    </AuthCard>
  )
}

function Result({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation()
  const signedIn = useSession().status === 'authenticated'
  // the same /me the banner and the user menu read; only asked with a session
  const { data: me } = $api.useQuery('get', '/api/v1/users/me', undefined, {
    enabled: signedIn,
  })
  const confirmed = signedIn && me?.is_verified === true

  // The way in, whichever side of a session the person is on.
  const wayIn = signedIn ? (
    <ButtonLink to="/alerts">{t('verification.toAlerts')}</ButtonLink>
  ) : (
    <ButtonLink to="/login" search={AFTER_SIGN_IN}>
      {t('verification.signIn')}
    </ButtonLink>
  )

  // An old letter opened after a newer one worked: the link has expired, and
  // that no longer matters to anyone. What the person needs to hear is that
  // the address is confirmed — said alone, not beside "expired". Known only
  // with a session; without one, /me cannot be asked.
  const shown = outcome === 'expired' && confirmed ? 'confirmed' : outcome

  if (shown !== 'expired') {
    // Three wordings, one action. A person who opened a spent link should hear
    // that nothing went wrong, not that it worked now. None offers another
    // letter — the address is confirmed, and a letter cannot help.
    return (
      <>
        <Title order={1} size="h2">
          {t(`verification.${shown}.title`)}
        </Title>
        <Text>{t(`verification.${shown}.body`)}</Text>
        {wayIn}
      </>
    )
  }

  // Expired. Resend needs a session (impl 08), so it is offered right here only
  // to a person who has one; anyone else is told where it is once signed in.
  return (
    <>
      <Title order={1} size="h2">
        {t('verification.expired.title')}
      </Title>
      {signedIn ? (
        <>
          <Text>{t('verification.expired.bodySignedIn')}</Text>
          <Resend />
        </>
      ) : (
        <>
          <Text>{t('verification.expired.bodySignedOut')}</Text>
          {wayIn}
        </>
      )}
    </>
  )
}
