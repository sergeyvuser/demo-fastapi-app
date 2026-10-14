import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LANGUAGE_STORAGE_KEY } from './language'

// The instance the application actually boots with, detector and all — the
// one thing the test harness's own instance cannot stand in for. Each case
// imports it afresh, because detection happens once, at init.
async function boot() {
  vi.resetModules()
  return (await import('./index')).i18n
}

function browserAsks(...languages: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0])
}

describe('the language the application starts in', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.lang = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is the one remembered in storage, over the browser’s own preference', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru')
    browserAsks('en-US')

    const i18n = await boot()

    expect(i18n.resolvedLanguage).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')
  })

  it('is the browser’s preference when nothing is remembered yet', async () => {
    browserAsks('ru-RU', 'en-US')

    const i18n = await boot()

    // `ru-RU` resolves to `ru`: the catalogues are per language, not per
    // region.
    expect(i18n.resolvedLanguage).toBe('ru')
  })

  it('is English when the browser asks for a language we do not have', async () => {
    browserAsks('fr-FR')

    const i18n = await boot()

    expect(i18n.resolvedLanguage).toBe('en')
  })
})
