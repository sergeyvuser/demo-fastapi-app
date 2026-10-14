import { fireEvent, screen } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderWithProviders } from '../testing/render'
import { bindDocumentLanguage, LANGUAGE_STORAGE_KEY } from './language'
import { LanguageSwitch } from './LanguageSwitch'

// Russian never opens a browser: the switch is storage plus a re-render, which
// jsdom covers completely, and a sixth e2e spec would cost minutes in the path
// that gates production.

function Probe() {
  const { t } = useTranslation()

  return <p>{t('notFound.title')}</p>
}

describe('the language switch', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it('offers each language under its own name', () => {
    const { i18n } = renderWithProviders(<LanguageSwitch />)

    // Autonyms: both catalogues spell them the same way, because a Russian
    // reader looks for "Русский" and not for "Russian".
    expect(screen.getByRole('radio', { name: i18n.t('common.language.en') })).toBeChecked()
    expect(screen.getByRole('radio', { name: i18n.t('common.language.ru') })).not.toBeChecked()
  })

  it('carries an accessible label out of the catalogue', () => {
    const { i18n } = renderWithProviders(<LanguageSwitch />)

    expect(screen.getByLabelText(i18n.t('common.language.switchLabel'))).toBeInTheDocument()
  })

  it('switches the interface, remembers the choice and renames the document', async () => {
    const { i18n } = renderWithProviders(
      <>
        <LanguageSwitch />
        <Probe />
      </>,
    )
    bindDocumentLanguage(i18n)

    fireEvent.click(screen.getByRole('radio', { name: i18n.t('common.language.ru') }))

    // Through the catalogue, not through literal Russian: the wording of this
    // screen is free to change without turning this test red.
    expect(await screen.findByText(i18n.getFixedT('ru')('notFound.title'))).toBeInTheDocument()
    // The one writer of the key — the detector only reads it, and the e2e
    // suite seeds it before the bundle boots.
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru')
    // Or a screen reader pronounces Russian with English phonetics.
    expect(document.documentElement.lang).toBe('ru')
  })
})
