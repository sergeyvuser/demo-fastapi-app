import { createInstance, type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'

import type { Language } from '../i18n/language'
import { resources } from '../i18n/resources'

// Real i18next over the real catalogues — not a stub, so a test reads what a
// user reads. No detector: the language is an argument here.
//
// `fallbackLng: false` is load-bearing. In production it is an unreachable
// belt; in a test it is a mask, because a missing Russian key would render in
// English, the assertion would see a plausible string and go green — which is
// the exact hole the plural test exists to close.
export function createTestI18n(language: Language = 'en'): i18n {
  const instance = createInstance()

  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: false,
    resources,
    interpolation: { escapeValue: false },
    saveMissing: true,
    missingKeyHandler: (_languages, namespace, key) => {
      throw new Error(`i18n: missing key ${namespace}:${key}`)
    },
  })

  return instance
}
