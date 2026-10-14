import { useDocumentTitle } from '@mantine/hooks'
import type { ParseKeys } from 'i18next'
import { useTranslation } from 'react-i18next'

// The tab title is what a screen reader announces on a switch and what lands
// in browser history, so it is translated — through one template, with the
// product name never translated, like a Symbol. From ticket 19 on, every route
// calls this with a key from its own branch of the catalogue.
export function usePageTitle(page: ParseKeys): void {
  const { t } = useTranslation()

  useDocumentTitle(t('common.documentTitle', { page: t(page) }))
}
