import { Title } from '@mantine/core'
import { useDocumentTitle } from '@mantine/hooks'
import type { ParseKeys } from 'i18next'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from '../i18n/documentTitle'

// The four screens this ticket routes to but does not build: a title each,
// enough to prove the route, the guard and the tab title. Tickets 21, 24, 25
// and 29 move each one out into a screen of its own.

function Placeholder({ title }: { title: ParseKeys }) {
  const { t } = useTranslation()
  usePageTitle(title)
  return (
    <Title order={1} size="h2">
      {t(title)}
    </Title>
  )
}

export function Alerts() {
  return <Placeholder title="shell.alerts" />
}

export function History() {
  return <Placeholder title="shell.history" />
}

export function Account() {
  return <Placeholder title="shell.account" />
}

// The Landing's tab is the product's name alone — "Crypto Alerts · Crypto
// Alerts" is what the page template would make of it. Ticket 21 fills it.
export function Landing() {
  const { t } = useTranslation()
  useDocumentTitle(t('common.productName'))
  return (
    <Title order={1} size="h2">
      {t('common.productName')}
    </Title>
  )
}
