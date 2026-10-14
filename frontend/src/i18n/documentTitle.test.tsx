import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../testing/render'
import { usePageTitle } from './documentTitle'

function Screen() {
  usePageTitle('notFound.title')

  return null
}

describe('a route’s document title', () => {
  it('comes out of the catalogue through one template', () => {
    renderWithProviders(<Screen />)

    expect(document.title).toBe('Page not found · Crypto Alerts')
  })

  it('translates the page and never the product', () => {
    renderWithProviders(<Screen />, 'ru')

    expect(document.title).toBe('Страница не найдена · Crypto Alerts')
  })
})
