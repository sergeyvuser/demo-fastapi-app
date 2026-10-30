import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, getSession, startSession } from '../api/session'
import { LANGUAGE_STORAGE_KEY } from '../i18n/language'
import { en } from '../i18n/resources'
import { createAppRouter } from '../router'
import { renderWithProviders } from '../testing/render'

type User = {
  id: string
  username: string
  email: string
  is_active: boolean
  is_verified: boolean
  telegram_chat_id: number | null
  digest_enabled: boolean
  is_demo: boolean
}

let me: User
let bot: string | null
let answers: Record<string, (body: unknown) => Response>
const sent: { route: string; body: unknown }[] = []

function problem(status: number, type: string, headers: Record<string, string> = {}) {
  return () => Response.json({ type, status, detail: 'English prose' }, { status, headers })
}

beforeEach(() => {
  me = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'alice',
    email: 'alice@example.com',
    is_active: true,
    is_verified: true,
    telegram_chat_id: null,
    digest_enabled: false,
    is_demo: false,
  }
  bot = 'alerts_bot'
  sent.length = 0
  answers = {
    'GET /api/v1/users/me': () => Response.json(me),
    'GET /api/v1/notifications': () => Response.json({ telegram_bot: bot, digest_hour_utc: 8 }),
    'GET /api/v1/demo': () =>
      Response.json({
        enabled: true,
        email: 'demo@example.com',
        password: 'demo-password',
        resets_at: new Date(Date.UTC(2099, 0, 1, 4)).toISOString(),
      }),
    'PUT /api/v1/users/me/linked-chat': (body) => {
      me = { ...me, telegram_chat_id: (body as { chat_id: number }).chat_id }
      return Response.json(me)
    },
    'DELETE /api/v1/users/me/linked-chat': () => {
      me = { ...me, telegram_chat_id: null }
      return new Response(null, { status: 204 })
    },
    'PUT /api/v1/users/me/preferences': (body) => {
      me = { ...me, ...(body as { digest_enabled: boolean }) }
      return Response.json(me)
    },
  }
  vi.stubGlobal('fetch', async (input: Request) => {
    const route = `${input.method} ${new URL(input.url).pathname}`
    const body: unknown =
      input.method === 'GET' || input.method === 'DELETE' ? null : await input.json()
    sent.push({ route, body })
    const answer = answers[route]
    return answer ? answer(body) : new Promise(() => {})
  })
  startSession('access', 900)
})

afterEach(() => {
  vi.unstubAllGlobals()
  endSession()
  localStorage.removeItem(LANGUAGE_STORAGE_KEY)
})

function renderAccount() {
  const router = createAppRouter(
    { session: { boot: () => Promise.resolve(), current: getSession } },
    createMemoryHistory({ initialEntries: ['/account'] }),
  )
  return renderWithProviders(<RouterProvider router={router} />)
}

const writes = (route: string) => sent.filter((request) => request.route === route)

describe('the address', () => {
  it('shows the address and that it is confirmed', async () => {
    const { i18n } = renderAccount()

    const section = await screen.findByRole('region', { name: i18n.t('account.address.title') })
    expect(within(section).getByText('alice@example.com')).toBeInTheDocument()
    expect(within(section).getByText(i18n.t('account.address.verified'))).toBeInTheDocument()
    expect(within(section).queryByRole('button')).toBeNull()
  })

  it('offers another letter while it is not confirmed', async () => {
    me.is_verified = false
    const { i18n } = renderAccount()

    const section = await screen.findByRole('region', { name: i18n.t('account.address.title') })
    expect(within(section).getByText(i18n.t('account.address.unverified'))).toBeInTheDocument()
    expect(
      within(section).getByRole('button', { name: i18n.t('verification.resend.action') }),
    ).toBeInTheDocument()
  })
})

describe('the Linked chat', () => {
  async function chatSection(i18n: ReturnType<typeof renderAccount>['i18n']) {
    return screen.findByRole('region', { name: i18n.t('account.chat.title') })
  }

  it('says start the bot first, then get the number, then warns — in that order', async () => {
    const { i18n } = renderAccount()
    const section = await chatSection(i18n)

    const steps = within(section).getAllByRole('listitem')
    expect(steps[0]).toHaveTextContent(i18n.t('account.chat.stepStart', { bot: '@alerts_bot' }))
    expect(steps[1]).toHaveTextContent(i18n.t('account.chat.stepNumber'))
    const warning = within(section).getByText(i18n.t('account.chat.warning'))
    // the warning follows the steps, and the field follows the warning
    expect(
      steps[1].compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const field = within(section).getByRole('textbox', { name: i18n.t('account.chat.field') })
    expect(warning.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const open = within(section).getByRole('link', {
      name: i18n.t('account.chat.openBot', { bot: '@alerts_bot' }),
    })
    expect(open).toHaveAttribute('href', 'https://t.me/alerts_bot')
  })

  it('still gives the steps when Telegram could not name the bot', async () => {
    bot = null
    const { i18n } = renderAccount()
    const section = await chatSection(i18n)

    expect(
      await within(section).findByText(i18n.t('account.chat.stepStartUnnamed')),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('link')).toBeNull()
  })

  it('saves a typed id once Telegram took the test message', async () => {
    const { i18n } = renderAccount()
    const section = await chatSection(i18n)

    fireEvent.change(within(section).getByRole('textbox', { name: i18n.t('account.chat.field') }), {
      target: { value: ' 123456789 ' },
    })
    fireEvent.click(within(section).getByRole('button', { name: i18n.t('account.chat.save') }))

    expect(await within(section).findByText(i18n.t('account.chat.saved'))).toBeInTheDocument()
    expect(
      within(section).getByText(i18n.t('account.chat.linked', { id: 123456789 })),
    ).toBeInTheDocument()
    expect(writes('PUT /api/v1/users/me/linked-chat')).toEqual([
      { route: 'PUT /api/v1/users/me/linked-chat', body: { chat_id: 123456789 } },
    ])
  })

  it('refuses a group id in the field, before asking anyone', async () => {
    const { i18n } = renderAccount()
    const section = await chatSection(i18n)

    fireEvent.change(within(section).getByRole('textbox', { name: i18n.t('account.chat.field') }), {
      target: { value: '-1001234567890' },
    })
    fireEvent.click(within(section).getByRole('button', { name: i18n.t('account.chat.save') }))

    expect(
      await within(section).findByText(i18n.t('account.chat.errors.invalid')),
    ).toBeInTheDocument()
    expect(writes('PUT /api/v1/users/me/linked-chat')).toEqual([])
  })

  it.each([
    ['urn:alerts:linked-chat:not-started', 400, 'account.chat.errors.notStarted'],
    ['urn:alerts:linked-chat:blocked', 400, 'account.chat.errors.blocked'],
    ['urn:alerts:linked-chat:taken', 409, 'account.chat.errors.taken'],
  ] as const)('surfaces %s as a refusal and saves nothing', async (type, status, sentence) => {
    answers['PUT /api/v1/users/me/linked-chat'] = problem(status, type)
    const { i18n } = renderAccount()
    const section = await chatSection(i18n)

    fireEvent.change(within(section).getByRole('textbox', { name: i18n.t('account.chat.field') }), {
      target: { value: '123456789' },
    })
    fireEvent.click(within(section).getByRole('button', { name: i18n.t('account.chat.save') }))

    expect(await within(section).findByText(i18n.t(sentence))).toHaveAttribute('role', 'alert')
    expect(within(section).getByText(i18n.t('account.chat.notLinked'))).toBeInTheDocument()
    // the server's English is never what the person reads
    expect(within(section).queryByText('English prose')).toBeNull()
  })

  it('states the refusal budget as a wait, not as a failure', async () => {
    answers['PUT /api/v1/users/me/linked-chat'] = problem(429, 'about:blank', {
      'Retry-After': '1790',
    })
    const { i18n } = renderAccount()
    const section = await chatSection(i18n)

    fireEvent.change(within(section).getByRole('textbox', { name: i18n.t('account.chat.field') }), {
      target: { value: '123456789' },
    })
    fireEvent.click(within(section).getByRole('button', { name: i18n.t('account.chat.save') }))

    const sentence = await within(section).findByText(
      i18n.t('account.chat.errors.limited', { count: 30 }),
    )
    expect(sentence).toHaveAttribute('role', 'status')
  })

  it('can be cleared at any time, unconfirmed address included', async () => {
    me.telegram_chat_id = 777
    me.is_verified = false
    const { i18n } = renderAccount()
    const section = await chatSection(i18n)

    fireEvent.click(within(section).getByRole('button', { name: i18n.t('account.chat.unlink') }))

    expect(await within(section).findByText(i18n.t('account.chat.unlinked'))).toBeInTheDocument()
    expect(within(section).getByText(i18n.t('account.chat.notLinked'))).toBeInTheDocument()
    expect(writes('DELETE /api/v1/users/me/linked-chat')).toHaveLength(1)
  })
})

// The demo block's wording is asserted as literal English, not through the
// catalogue: what the screen says instead of an input is the decision.
describe('the Linked chat on the demo account', () => {
  beforeEach(() => {
    me = { ...me, email: 'demo@example.com', is_demo: true }
  })

  it('keeps the label and the instructions, and explains instead of an input', async () => {
    const { i18n, container } = renderAccount()
    const section = await screen.findByRole('region', { name: i18n.t('account.chat.title') })

    expect(within(section).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(section).getByText(
        'The demo account cannot link a Telegram chat. It is shared, so a chat linked here ' +
          'would receive the Notifications of everyone who signs in. To try Notifications, ' +
          'create an account of your own and link your chat there.',
      ),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('textbox')).toBeNull()
    expect(within(section).queryByRole('button')).toBeNull()
    // not a disabled input: that explains nothing, and some readers skip it
    expect(container.querySelector('input:disabled, textarea:disabled')).toBeNull()
  })
})

describe('the Digest', () => {
  async function digestSwitch(i18n: ReturnType<typeof renderAccount>['i18n']) {
    return screen.findByRole('switch', { name: i18n.t('account.digest.switch') })
  }

  it('is off until turned on, and says what it holds and when it comes', async () => {
    const { i18n } = renderAccount()

    const toggle = await digestSwitch(i18n)
    expect(toggle).not.toBeChecked()
    // 08:00 UTC, in the reader's zone — the suite is pinned to UTC
    const contents = i18n.t('account.digest.contents', {
      email: 'alice@example.com',
      time: '8:00 AM',
    })
    expect(screen.getByText(contents)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('account.digest.quiet'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('account.digest.off'))).toBeInTheDocument()
    // read out with the switch, as its description — not folded into its name
    expect(toggle).toHaveAccessibleName(i18n.t('account.digest.switch'))
    expect(toggle).toHaveAccessibleDescription(expect.stringContaining(contents))
  })

  // The toggle is the announcement: nothing else in the product says the
  // Digest exists, so no other catalogue entry may name it.
  it('is announced nowhere else', () => {
    const elsewhere = Object.entries(en)
      .filter(([feature]) => feature !== 'account')
      .map(([, strings]) => JSON.stringify(strings))
    expect(elsewhere.filter((strings) => /digest/i.test(strings))).toEqual([])
  })

  it('turns on', async () => {
    const { i18n } = renderAccount()

    fireEvent.click(await digestSwitch(i18n))

    await waitFor(async () => expect(await digestSwitch(i18n)).toBeChecked())
    expect(writes('PUT /api/v1/users/me/preferences')).toEqual([
      { route: 'PUT /api/v1/users/me/preferences', body: { digest_enabled: true } },
    ])
  })

  it('goes back to off when the change is refused', async () => {
    answers['PUT /api/v1/users/me/preferences'] = problem(403, 'about:blank')
    const { i18n } = renderAccount()

    fireEvent.click(await digestSwitch(i18n))

    expect(await screen.findByText(i18n.t('account.digest.unverified'))).toBeInTheDocument()
    expect(await digestSwitch(i18n)).not.toBeChecked()
  })

  it('is live on the demo account, and says why it never reaches anyone there', async () => {
    me = { ...me, email: 'demo@example.com', is_demo: true }
    const { i18n } = renderAccount()

    const toggle = await digestSwitch(i18n)
    expect(toggle).toBeEnabled()
    expect(
      await screen.findByText(
        "On the demo account the Digest goes to the project's own mailbox, which nobody " +
          'signed in here can read, and the switch is turned back off every day at 4:00 AM.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(toggle)
    await waitFor(async () => expect(await digestSwitch(i18n)).toBeChecked())
  })
})

describe('the language', () => {
  it('changes the language and remembers it', async () => {
    const { i18n } = renderAccount()
    const section = await screen.findByRole('region', { name: i18n.t('account.language.title') })

    fireEvent.click(within(section).getByText(i18n.t('common.language.ru')))

    expect(await screen.findByRole('heading', { name: 'Аккаунт' })).toBeInTheDocument()
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru')
  })
})
