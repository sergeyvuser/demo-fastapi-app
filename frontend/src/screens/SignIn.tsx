import { Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { signIn } from '../api/auth'
import { usePageTitle } from '../i18n/documentTitle'
import { AnchorLink } from '../shell/links'
import { AuthCard } from './AuthCard'
import { ServerError, useServerError } from './ServerError'

const route = getRouteApi('/login')

export function SignIn() {
  const { t } = useTranslation()
  usePageTitle('auth.signIn.title')
  const { redirect, expired } = route.useSearch()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const server = useServerError()

  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (value) => (value.trim() ? null : t('auth.errors.emailRequired')),
      password: (value) => (value ? null : t('auth.errors.passwordRequired')),
    },
  })

  const submit = form.onSubmit(async ({ email, password }) => {
    setSubmitting(true)
    server.clear()
    try {
      await signIn(email.trim(), password)
      // `href`, not `to`: the target came through the URL and is a string
      // the type checker cannot know is a route. safeRedirect vetted it.
      await navigate({ href: redirect ?? '/alerts' })
    } catch (error) {
      // the OAuth2 form calls the e-mail `username`
      server.show(error, form, { username: 'email' })
      setSubmitting(false)
    }
  })

  return (
    <AuthCard>
      <Title order={1} size="h2">
        {t('auth.signIn.title')}
      </Title>
      {expired && <Text c="dimmed">{t('auth.signIn.expired')}</Text>}
      <form onSubmit={submit} noValidate>
        <Stack gap="sm">
          <ServerError message={server.message} />
          <TextInput
            label={t('auth.fields.email')}
            type="email"
            autoComplete="email"
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label={t('auth.fields.password')}
            autoComplete="current-password"
            {...form.getInputProps('password')}
          />
          <Button type="submit" loading={submitting} fullWidth mt="xs">
            {t('auth.signIn.submit')}
          </Button>
        </Stack>
      </form>
      <Text size="sm">
        {t('auth.signIn.noAccount')}{' '}
        <AnchorLink to="/register">{t('auth.signUp.title')}</AnchorLink>
      </Text>
    </AuthCard>
  )
}
