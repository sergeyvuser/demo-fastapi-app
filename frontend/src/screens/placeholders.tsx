import { Title } from '@mantine/core'
import type { ParseKeys } from 'i18next'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from '../i18n/documentTitle'

// The screen routed to but not yet built: a title, enough to prove the route,
// the guard and the tab title. Ticket 29 moves it out into a screen of its own.

function Placeholder({ title }: { title: ParseKeys }) {
  const { t } = useTranslation()
  usePageTitle(title)
  return (
    <Title order={1} size="h2">
      {t(title)}
    </Title>
  )
}

export function Account() {
  return <Placeholder title="shell.account" />
}
