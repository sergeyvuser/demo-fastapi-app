import { Alert as MantineAlert } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../api/problem'

type FormLike = { setErrors: (errors: Record<string, string>) => void }

// Where a refusal from the API lands on a form. A field the server names gets
// its message under that field; everything else — a wrong password, a taken
// address, a rate limit — goes into one alert above the form. The server's
// prose is English and is shown as it is: the spec's interim position, until
// errors carry codes the catalogues can translate.
export function useServerError() {
  const { t } = useTranslation()
  const [message, setMessage] = useState<string | null>(null)

  return {
    message,
    clear: () => setMessage(null),
    show(error: unknown, form: FormLike, rename: Record<string, string> = {}) {
      if (!(error instanceof ApiError)) {
        // a network failure throws a TypeError from fetch, with no status
        setMessage(t('auth.errors.network'))
        return
      }
      const byField = error.fieldErrors.filter((item) => item.field)
      if (byField.length > 0) {
        form.setErrors(
          Object.fromEntries(
            byField.map((item) => [rename[item.field] ?? item.field, item.message]),
          ),
        )
      }
      if (byField.length === 0 || byField.length < error.fieldErrors.length) {
        setMessage(error.detail ?? t('auth.errors.unknown', { status: error.status }))
      }
    },
  }
}

export function ServerError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <MantineAlert color="red" variant="light" role="alert">
      {message}
    </MantineAlert>
  )
}
