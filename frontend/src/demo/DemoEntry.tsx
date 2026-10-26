import { Button, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { signIn } from '../api/auth'
import { ApiError } from '../api/problem'
import { resolvedLanguage } from '../i18n/language'
import { formatTimeOfDay } from '../i18n/time'
import { ServerError } from '../screens/ServerError'
import { useDemo, type PublishedDemo } from './demo'

// The Landing's way to look without registering. Absent wherever no Demo
// account exists — the bundle compiles no environment values, so asking the
// API is the only way to know, and a hardcoded button would point development
// at an account that is not there.
export function DemoEntry() {
  const demo = useDemo()
  return demo ? <Entry demo={demo} /> : null
}

function Entry({ demo }: { demo: PublishedDemo }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const time = formatTimeOfDay(Date.parse(demo.resetsAt), resolvedLanguage(i18n))
  // Copied as it reads: what is on the screen is what lands in the clipboard.
  const pair = `${demo.email}\n${demo.password}`

  // The ordinary sign-in, not a door of its own: the same `signIn` the form
  // calls, the same endpoint, rate limiter, token and refresh cookie. A
  // dedicated demo login would be a second way to mint tokens.
  async function enter() {
    setSubmitting(true)
    setError(null)
    try {
      await signIn(demo.email, demo.password)
      await navigate({ to: '/alerts' })
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? (failure.detail ?? t('auth.errors.unknown', { status: failure.status }))
          : t('auth.errors.network'),
      )
      setSubmitting(false)
    }
  }

  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        {t('demo.entry.title')}
      </Title>
      <Text>{t('demo.entry.body', { time })}</Text>
      {/* in plain text, beside the button: a visible shared password is the
          shortest explanation of why the account behaves as it does, and the
          same pair works in curl */}
      <Stack gap={4}>
        <Text size="sm" c="dimmed">
          {t('demo.entry.credentials')}
        </Text>
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Code block>{pair}</Code>
          <CopyButton value={pair}>
            {({ copied, copy }) => (
              <Button variant="subtle" size="xs" onClick={copy}>
                {copied ? t('demo.entry.copied') : t('demo.entry.copy')}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
      <ServerError message={error} />
      <Group>
        <Button variant="light" loading={submitting} onClick={() => void enter()}>
          {t('demo.entry.signIn')}
        </Button>
      </Group>
    </Stack>
  )
}
