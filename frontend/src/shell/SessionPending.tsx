import { useTranslation } from 'react-i18next'

import { useRefreshUnanswered } from '../api/session'
import { ServerError } from '../screens/ServerError'
import { ContentSkeleton } from './ContentSkeleton'

// What a signed-in route shows while the guard waits for the boot refresh.
// The outline of the content, as long as an answer is on its way; once an
// attempt has gone unanswered, the truth instead — a skeleton about a server
// that is not answering would be loading forever. Nothing to click: the
// session retries on its own, and the guard lets the screen in, or sends the
// person to sign in, the moment the server answers.
export function SessionPending() {
  const { t } = useTranslation()
  const unanswered = useRefreshUnanswered()

  if (!unanswered) return <ContentSkeleton />
  return <ServerError message={t('shell.unreachable')} />
}
