import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession } from '../api/session'
import { formatTimeOfDay } from '../i18n/time'
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
// anything else the page asks, by path; unknown paths answer 401
let answers: Record<string, (request: Request) => Response | Promise<Response>>

beforeEach(() => {
  symbolRequests = 0
  items = [BTC, ETH]
  symbolsDown = false
  answers = {}
  sockets.mockClear()
  vi.stubGlobal('fetch', (input: Request | string) => {
    // the boot refresh is a plain fetch of a path, not a Request
    const request = typeof input === 'string' ? new Request(input) : input
    const { pathname } = new URL(request.url)
    if (pathname === '/api/v1/symbols') {
      symbolRequests += 1
      if (symbolsDown) return Promise.resolve(new Response(null, { status: 503 }))
      return Promise.resolve(Response.json({ items }))
    }
    const answer = answers[pathname]
    if (answer) return Promise.resolve(answer(request))
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

const DEMO_EMAIL = 'demo@example.com'
const DEMO_PASSWORD = 'demo-password'

function publishedDemo() {
  return {
    enabled: true,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    resets_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  }
}

describe('the Landing with a Demo account', () => {
  it('shows the pair in plain text and copies it as it reads', async () => {
    const demo = publishedDemo()
    answers['/api/v1/demo'] = () => Response.json(demo)
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { i18n } = renderLanding()

    try {
      const main = within(await screen.findByRole('main'))
      await main.findByRole('button', { name: i18n.t('demo.entry.signIn') })
      const time = formatTimeOfDay(Date.parse(demo.resets_at), 'en')
      expect(main.getByText(i18n.t('demo.entry.body', { time }))).toBeInTheDocument()
      // both on screen as text, one above the other
      const pair = main.getByText(new RegExp(DEMO_EMAIL))
      expect(pair.textContent).toBe(`${DEMO_EMAIL}\n${DEMO_PASSWORD}`)

      fireEvent.click(main.getByRole('button', { name: i18n.t('demo.entry.copy') }))
      expect(writeText).toHaveBeenCalledWith(`${DEMO_EMAIL}\n${DEMO_PASSWORD}`)
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('signs in through the ordinary login and lands on the Alerts, under the banner', async () => {
    answers['/api/v1/demo'] = () => Response.json(publishedDemo())
    let login: URLSearchParams | null = null
    answers['/api/v1/auth/login'] = async (request) => {
      const raw = await request.text()
      // In a browser the body is URL-encoded. Here it arrives as JSON:
      // openapi-fetch picks its encoding by `headers.get instanceof Function`,
      // and under the `vmThreads` pool Node's Headers come from another realm,
      // so the check fails. A trap of the test pool, not of the client.
      login = new URLSearchParams(
        raw.startsWith('{') ? (JSON.parse(raw) as Record<string, string>) : raw,
      )
      return Response.json({ access_token: 'access', token_type: 'bearer', expires_in: 900 })
    }
    answers['/api/v1/users/me'] = () =>
      Response.json({
        id: '00000000-0000-4000-8000-000000000001',
        username: 'demo',
        email: DEMO_EMAIL,
        is_active: true,
        is_verified: true,
        telegram_chat_id: null,
        digest_enabled: false,
        is_demo: true,
      })
    answers['/api/v1/alerts'] = () => Response.json({ items: [], total: 0, skip: 0, limit: 100 })
    const { i18n } = renderLanding()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('demo.entry.signIn') }))

    expect(await screen.findByText(/^This is the shared demo account/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: i18n.t('shell.alerts') })).toBeInTheDocument()
    // the published pair, in the OAuth2 form the sign-in screen sends
    expect(login!.get('username')).toBe(DEMO_EMAIL)
    expect(login!.get('password')).toBe(DEMO_PASSWORD)
  })

  it('says why the sign-in failed, beside the button', async () => {
    answers['/api/v1/demo'] = () => Response.json(publishedDemo())
    answers['/api/v1/auth/login'] = () =>
      Response.json(
        { type: 'about:blank', status: 429, detail: 'Too many login attempts' },
        { status: 429 },
      )
    const { i18n } = renderLanding()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('demo.entry.signIn') }))

    expect(await screen.findByText('Too many login attempts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('demo.entry.signIn') })).toBeEnabled()
  })
})

describe('the Landing without a Demo account', () => {
  it('offers no button and no paragraph', async () => {
    let asked = 0
    answers['/api/v1/demo'] = () => {
      asked += 1
      return Response.json({ enabled: false, email: null, password: null, resets_at: null })
    }
    const { i18n } = renderLanding()

    await screen.findByRole('link', { name: i18n.t('landing.register') })
    await vi.waitFor(() => expect(asked).toBe(1))
    // let the answer render, if it were going to render anything
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

    expect(screen.queryByRole('button', { name: i18n.t('demo.entry.signIn') })).toBeNull()
    expect(screen.queryByText(i18n.t('demo.entry.title'))).toBeNull()
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
