import { SegmentedControl } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { changeLanguage, isLanguage, LANGUAGES, resolvedLanguage } from './language'

// The autonyms are catalogue strings like any other, and identical in both
// files: a Russian reader looks for "Русский", not for "Russian".
const LABEL_KEY = {
  en: 'common.language.en',
  ru: 'common.language.ru',
} as const

// Mantine's accessible labels are our own catalogue strings — the library
// carries defaults only in two modules this application does not use, so
// nothing warns when one is left out.
export function LanguageSwitch() {
  const { t, i18n } = useTranslation()

  return (
    <SegmentedControl
      size="xs"
      aria-label={t('common.language.switchLabel')}
      value={resolvedLanguage(i18n)}
      onChange={(value) => {
        if (isLanguage(value)) void changeLanguage(i18n, value)
      }}
      data={LANGUAGES.map((language) => ({
        value: language,
        label: t(LABEL_KEY[language]),
      }))}
    />
  )
}
