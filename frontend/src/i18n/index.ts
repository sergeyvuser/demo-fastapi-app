import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import { bindDocumentLanguage, LANGUAGE_STORAGE_KEY, LANGUAGES } from './language'
import { resources } from './resources'

export const i18n = i18next.createInstance()

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // What turns a browser's `ru-RU` into `ru` and an unsupported `fr-FR`
    // into the fallback. `load: 'languageOnly'` is deliberately absent: it
    // was tried, and it leaves the detected `ru-RU` sitting in
    // `i18n.language` while `resolvedLanguage` says `ru` — a second answer to
    // "which language is this", which is the one thing to avoid here.
    supportedLngs: LANGUAGES,
    // An unreachable belt if the types did their job, and better than
    // rendering `alerts.card.triggerCount` at a user. Switched off in tests,
    // where it would be a mask instead of a belt.
    fallbackLng: 'en',
    detection: {
      // An explicit switch first, the browser's own preference second. No
      // querystring and no cookie: this choice belongs to one browser.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      // `changeLanguage` in language.ts writes the key, so the detector must
      // not also write it — one writer, or the two disagree about which value
      // is current.
      caches: [],
    },
    interpolation: {
      // React escapes everything it renders; escaping here too would turn an
      // apostrophe into `&#39;` on the screen.
      escapeValue: false,
    },
    // The belt above must never quietly hide what the types were supposed to
    // catch, so in development a missing key is loud. `saveMissing` is what
    // makes the handler run at all.
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (_languages, namespace, key) => {
      throw new Error(`i18n: missing key ${namespace}:${key}`)
    },
  })

bindDocumentLanguage(i18n)
