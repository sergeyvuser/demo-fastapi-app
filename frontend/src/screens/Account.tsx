import { Badge, Button, Group, Paper, Skeleton, Stack, Text, Title } from '@mantine/core'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Digest } from '../account/Digest'
import { LinkedChat } from '../account/LinkedChat'
import { $api } from '../api/client'
import { usePageTitle } from '../i18n/documentTitle'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { Resend } from '../verification/Resend'

// Everything about the person's own account the product can show them, in one
// place: the address and whether it is confirmed, where Notifications go, the
// Digest, and the language.
export function Account() {
  const { t } = useTranslation()
  usePageTitle('shell.account')
  const me = $api.useQuery('get', '/api/v1/users/me')
  // The bot to start and the Digest's hour. Waited for, so "the name could not
  // be loaded" is never said while it is merely loading; a failure is not
  // waited out — each sentence that needs one has a version without it.
  const notifications = $api.useQuery('get', '/api/v1/notifications')
  const facts = notifications.data

  if (me.isPending || notifications.isPending) return <AccountSkeleton />
  if (me.isError) {
    return (
      <Stack align="flex-start" gap="xs">
        <PageTitle />
        <Text c="dimmed">{t('account.loadFailed')}</Text>
        <Button variant="default" size="xs" onClick={() => void me.refetch()}>
          {t('account.retry')}
        </Button>
      </Stack>
    )
  }

  const user = me.data
  return (
    <Stack gap="md" maw={720}>
      <PageTitle />
      <Section title={t('account.address.title')}>
        <Group gap="xs">
          <Text style={{ overflowWrap: 'anywhere' }}>{user.email}</Text>
          <Badge color={user.is_verified ? 'green' : 'yellow'} variant="light">
            {user.is_verified ? t('account.address.verified') : t('account.address.unverified')}
          </Badge>
        </Group>
        {!user.is_verified && (
          <>
            <Text size="sm" c="dimmed">
              {t('account.address.unverifiedBody')}
            </Text>
            <Resend />
          </>
        )}
      </Section>
      <Section title={t('account.chat.title')}>
        <LinkedChat
          chatId={user.telegram_chat_id}
          isDemo={user.is_demo}
          bot={facts?.telegram_bot ?? null}
        />
      </Section>
      <Section title={t('account.digest.title')}>
        <Digest
          enabled={user.digest_enabled}
          email={user.email}
          isDemo={user.is_demo}
          hourUtc={facts?.digest_hour_utc ?? null}
        />
      </Section>
      <Section title={t('account.language.title')}>
        <Text size="sm" c="dimmed">
          {t('account.language.body')}
        </Text>
        <div>
          <LanguageSwitch />
        </div>
      </Section>
    </Stack>
  )
}

function PageTitle() {
  const { t } = useTranslation()
  return (
    <Title order={1} size="h2">
      {t('shell.account')}
    </Title>
  )
}

// A landmark named by its own heading, so a screen reader can jump between the
// four parts of the screen by name.
function Section({ title, children }: { title: string; children: ReactNode }) {
  const heading = useId()
  return (
    <Paper withBorder radius="md" p="md" component="section" aria-labelledby={heading}>
      <Stack gap="sm">
        <Title order={2} size="h4" id={heading}>
          {title}
        </Title>
        {children}
      </Stack>
    </Paper>
  )
}

function AccountSkeleton() {
  return (
    <Stack gap="md" maw={720}>
      <PageTitle />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} h={120} radius="md" />
      ))}
    </Stack>
  )
}
