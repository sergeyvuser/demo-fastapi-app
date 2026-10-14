import { Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { signIn } from '../api/auth'
import { api } from '../api/client'
import { usePageTitle } from '../i18n/documentTitle'
import { AnchorLink } from '../shell/links'
import { AuthCard } from './AuthCard'
import { ServerError, useServerError } from './ServerError'

// Mirrors UserCreate. The server is the judge and its 422 lands on the same
// fields; these only spare a round trip for the obvious, and say it in the
// reader's language, which the server's prose does not.
const USERNAME = /^[a-zA-Z0-9_-]{3,32}$/
const PASSWORD_MIN = 8

export function SignUp() {
  const { t } = useTranslation()
  usePageTitle('auth.signUp.title')
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const server = useServerError()

  const form = useForm({
    initialValues: { username: '', email: '', password: '' },
    validate: {
      username: (value) => (USERNAME.test(value) ? null : t('auth.errors.username')),
      email: (value) => (value.trim() ? null : t('auth.errors.emailRequired')),
      password: (value) =>
        value.length >= PASSWORD_MIN
          ? null
          : t('auth.errors.passwordLength', { count: PASSWORD_MIN }),
    },
  })

  const submit = form.onSubmit(async ({ username, email, password }) => {
    setSubmitting(true)
    server.clear()
    try {
      await api.POST('/api/v1/auth/register', {
        body: { username, email: email.trim(), password },
      })
    } catch (error) {
      server.show(error, form)
      setSubmitting(false)
      return
    }
    // Registration answers with the User and no token. The password is in
    // hand, and an unverified User may sign in and read, so asking for it a
    // second time would be ceremony. What is left to say goes into a toast.
    try {
      await signIn(email.trim(), password)
    } catch {
      // The account exists; only the automatic sign-in failed (a rate limit,
      // the network). The sign-in screen is the honest next step.
      await navigate({ to: '/login' })
      return
    }
    notifications.show({
      title: t('auth.signUp.letterSentTitle'),
      message: t('auth.signUp.letterSent', { email: email.trim() }),
      autoClose: 10_000,
    })
    await navigate({ to: '/alerts' })
  })

  return (
    <AuthCard>
      <Title order={1} size="h2">
        {t('auth.signUp.title')}
      </Title>
      <form onSubmit={submit} noValidate>
        <Stack gap="sm">
          <ServerError message={server.message} />
          <TextInput
            label={t('auth.fields.username')}
            description={t('auth.fields.usernameHint')}
            autoComplete="username"
            {...form.getInputProps('username')}
          />
          <TextInput
            label={t('auth.fields.email')}
            type="email"
            autoComplete="email"
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label={t('auth.fields.password')}
            description={t('auth.fields.passwordHint', { count: PASSWORD_MIN })}
            autoComplete="new-password"
            {...form.getInputProps('password')}
          />
          <Button type="submit" loading={submitting} fullWidth mt="xs">
            {t('auth.signUp.submit')}
          </Button>
        </Stack>
      </form>
      <Text size="sm">
        {t('auth.signUp.haveAccount')}{' '}
        <AnchorLink to="/login" search={{}}>
          {t('auth.signIn.title')}
        </AnchorLink>
      </Text>
    </AuthCard>
  )
}
