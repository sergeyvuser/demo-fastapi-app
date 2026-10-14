import { Title } from '@mantine/core'
import type { ParseKeys } from 'i18next'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from '../i18n/documentTitle'

// The three screens routed to but not yet built: a title each, enough to
// prove the route, the guard and the tab title. Tickets 24, 25 and 29 move
// each one out into a screen of its own.

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
