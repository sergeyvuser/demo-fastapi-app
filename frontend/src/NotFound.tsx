// Mantine exports a component called Alert, and this application is about
// Alerts: the domain type owns the bare name, the component never gets it.
// Every file imports it as MantineAlert, so the two can never collide.
import { Alert as MantineAlert, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { useSession } from './api/session'
import { usePageTitle } from './i18n/documentTitle'
import { ButtonLink } from './shell/links'

// Any address the router does not know — the edge answers every path with the
// application, so this is what a mistyped URL sees. It offers the nearest
// useful place: home for whoever is signed in, the Landing for anyone else.
export function NotFound() {
  const { t } = useTranslation()
  usePageTitle('notFound.title')
  const signedIn = useSession().status === 'authenticated'

  return (
    <MantineAlert color="gray" title={t('notFound.title')}>
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{t('notFound.body')}</Text>
        {signedIn ? (
          <ButtonLink to="/alerts" size="xs" variant="default">
            {t('notFound.toAlerts')}
          </ButtonLink>
        ) : (
          <ButtonLink to="/" size="xs" variant="default">
            {t('notFound.toLanding')}
          </ButtonLink>
        )}
      </Stack>
    </MantineAlert>
  )
}
