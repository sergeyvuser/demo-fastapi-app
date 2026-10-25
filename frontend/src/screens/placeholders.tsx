import { Title } from '@mantine/core'
import type { ParseKeys } from 'i18next'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from '../i18n/documentTitle'

// The screens routed to but not yet built: a title each, enough to prove the
// route, the guard and the tab title. Tickets 25, 26 and 29 move each one out
// into a screen of its own.

function Placeholder({ title }: { title: ParseKeys }) {
  const { t } = useTranslation()
  usePageTitle(title)
  return (
    <Title order={1} size="h2">
      {t(title)}
    </Title>
  )
}

// Where the list's New Alert leads; the form itself is ticket 26.
export function NewAlert() {
  return <Placeholder title="alerts.newAlert" />
}

export function History() {
  return <Placeholder title="shell.history" />
}

export function Account() {
  return <Placeholder title="shell.account" />
}
