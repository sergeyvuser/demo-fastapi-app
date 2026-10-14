import type { i18n } from 'i18next'

export const LANGUAGES = ['en', 'ru'] as const

export type Language = (typeof LANGUAGES)[number]

// The language lives in the browser and never on a User: a server field cannot
// reach the public screens, costs a migration, and on the shared demo account
// would let one stranger switch the language for everyone at once.
export const LANGUAGE_STORAGE_KEY = 'alerts.language'

export function isLanguage(value: string | undefined): value is Language {
  return LANGUAGES.includes(value as Language)
}

// The single source every `Intl` formatter derives from. i18next types
// `resolvedLanguage` as possibly undefined — it is, until init finishes — and
// a formatter given `undefined` quietly falls back to the machine's locale,
// which is how the two drift apart.
export function resolvedLanguage(instance: i18n): Language {
  return isLanguage(instance.resolvedLanguage) ? instance.resolvedLanguage : LANGUAGES[0]
}

// The detector only reads this key (`caches: []`), so this is the one place
// that writes it — which is what a test can drive and what the e2e suite
// seeds before the bundle boots.
export async function changeLanguage(instance: i18n, language: Language): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // A browser with storage denied still gets to switch for this tab; the
    // choice simply does not survive a reload.
  }
  await instance.changeLanguage(language)
}

// Rewritten by the same effect that changes the language, or a screen reader
// pronounces Russian with English phonetics.
export function bindDocumentLanguage(instance: i18n): void {
  const apply = (language: string) => {
    document.documentElement.lang = language
  }
  instance.on('languageChanged', apply)
  if (instance.resolvedLanguage) apply(instance.resolvedLanguage)
}
