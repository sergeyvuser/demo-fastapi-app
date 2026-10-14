// Mantine exports a component called Alert, and this application is about
// Alerts: the domain type owns the bare name, the component never gets it.
// Every file imports it as MantineAlert, so the two can never collide.
import { Alert as MantineAlert } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from './i18n/documentTitle'

export function NotFound() {
  const { t } = useTranslation()
  usePageTitle('notFound.title')

  return (
    <MantineAlert color="gray" title={t('notFound.title')}>
      {t('notFound.body')}
    </MantineAlert>
  )
}
