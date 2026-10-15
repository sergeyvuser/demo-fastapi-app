import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession } from '../api/session'
import { resetPrices } from '../prices/store'
import { createAppRouter } from '../router'
import { AUTHOR } from '../shell/Footer'
import { renderWithProviders } from '../testing/render'

type Item = {
  symbol: string
  price: string | null
  reference_price: string | null
  precision: number
}

const BTC: Item = { symbol: 'BTCUSDT', price: '81794.5', reference_price: '80000', precision: 1 }
const ETH: Item = { symbol: 'ETHUSDT', price: null, reference_price: '2514.57', precision: 2 }

let symbolRequests = 0
let items: Item[] = [BTC, ETH]
// the API not answering the symbols list at all
let symbolsDown = false
const sockets = vi.fn()

beforeEach(() => {
  symbolRequests = 0
  items = [BTC, ETH]
  symbolsDown = false
  sockets.mockClear()
  vi.stubGlobal('fetch', (input: Request) => {
    if (new URL(input.url).pathname === '/api/v1/symbols') {
      symbolRequests += 1
      if (symbolsDown) return Promise.resolve(new Response(null, { status: 503 }))
      return Promise.resolve(Response.json({ items }))
    }
    return Promise.resolve(new Response(null, { status: 401 }))
  })
  // Any socket the page tried to open would be recorded here.
  vi.stubGlobal('WebSocket', sockets)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetPrices()
  endSession()
})

function renderLanding(language: 'en' | 'ru' = 'en') {
  const router = createAppRouter(
    // an anonymous visitor: the boot has settled and found nothing
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: ['/'] }),
  )
  return renderWithProviders(<RouterProvider router={router} />, language)
}

describe('the Landing', () => {
  it('polls the symbols list every ten seconds and opens no socket', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderLanding()
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(symbolRequests).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(symbolRequests).toBe(2)

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(symbolRequests).toBe(3)
    expect(sockets).not.toHaveBeenCalled()
  })

  it('shows a moved price after the next poll, in the strip and the card alike', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderLanding()
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(screen.getAllByText('81,794.5')).toHaveLength(2)

    items = [{ ...BTC, price: '81900.0' }, ETH]
    await act(() => vi.advanceTimersByTimeAsync(10_000))

    expect(screen.getAllByText('81,900.0')).toHaveLength(2)
    expect(screen.queryByText('81,794.5')).toBeNull()
  })

  it('says a missing price in words rather than as zero or a blank', async () => {
    const { i18n } = renderLanding()

    // ETH arrives without a price: once in the strip, once on its card
    expect(await screen.findAllByText(i18n.t('prices.noFreshPrice'))).toHaveLength(2)
    expect(screen.queryByText('0.00')).toBeNull()
  })

  it('defines an Alert and offers the way in', async () => {
    const { i18n } = renderLanding()

    expect(
      await screen.findByRole('heading', { level: 1, name: i18n.t('common.productName') }),
    ).toBeInTheDocument()
    expect(screen.getByText(i18n.t('landing.lede'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: i18n.t('landing.register') })).toHaveAttribute(
      'href',
      '/register',
    )
    // the language switch is in the footer
    expect(
      screen.getByRole('radiogroup', { name: i18n.t('common.language.switchLabel') }),
    ).toBeInTheDocument()
  })

  it('names the author in a footer whose links open safely', async () => {
    const { i18n } = renderLanding('ru')
    const footer = within(await screen.findByRole('contentinfo'))

    // the label is translated; the name is not
    expect(footer.getByText(i18n.t('shell.footer.author', { name: AUTHOR.name }))).toBeVisible()
    expect(footer.getByText(new RegExp(AUTHOR.name))).toBeVisible()
    expect(footer.getByRole('link', { name: i18n.t('shell.footer.source') })).toHaveAttribute(
      'href',
      AUTHOR.source,
    )

    const links = footer.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://vorobev.dev',
      'https://github.com/sergeyvuser',
      'https://t.me/Sergei_Vorobev',
      'https://github.com/sergeyvuser/demo-fastapi-app',
    ])
    for (const link of links) expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

// A skeleton that never resolves says "loading" about a server that is not
// answering; the cards and the strip say what is true instead.
describe('the Landing when the symbols list cannot be fetched', () => {
  it('says so in words, and shows the prices once the server answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    symbolsDown = true
    const { i18n } = renderLanding()
    await act(() => vi.advanceTimersByTimeAsync(100))

    // in the strip and where the cards would be
    expect(screen.getAllByText(i18n.t('prices.unavailable'))).toHaveLength(2)

    symbolsDown = false
    await act(() => vi.advanceTimersByTimeAsync(10_000))

    expect(screen.getAllByText('81,794.5')).toHaveLength(2)
    expect(screen.queryByText(i18n.t('prices.unavailable'))).toBeNull()
  })
})
