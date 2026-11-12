import { expect, request } from '@playwright/test'

import { MAILPIT_URL } from './stack.ts'

// Mailpit is a participant in the suite, not a developer tool: the
// Verification letter is read out of it. The letter is sent by the worker, so
// it arrives some time after the registration answered — every read retries.

type SearchResult = { messages: { ID: string }[] }
type Message = { Text: string }

// Once, before the suite (global-setup.ts) — never between specs. Each spec
// searches for its own fresh address, so leftovers cannot be mistaken for its
// letter, and clearing in the middle of a run would race a worker still
// sending one.
export async function clearMailbox(): Promise<void> {
  const api = await request.newContext({ baseURL: MAILPIT_URL })
  try {
    const response = await api.delete('/api/v1/messages')
    expect(response.ok(), `Mailpit at ${MAILPIT_URL} did not clear the mailbox`).toBe(true)
  } finally {
    await api.dispose()
  }
}

// The link of the Verification letter sent to `email`, exactly as the user
// would click it. The origin in it is the API's PUBLIC_URL; the spec opens it
// as it is, so a link the browser cannot follow fails here and not in prod.
export async function verificationLink(email: string): Promise<string> {
  const api = await request.newContext({ baseURL: MAILPIT_URL })
  try {
    let link: string | undefined
    await expect(async () => {
      const search = await api.get('/api/v1/search', { params: { query: `to:"${email}"` } })
      expect(search.ok()).toBe(true)
      const { messages } = (await search.json()) as SearchResult
      expect(messages, `no letter to ${email} in Mailpit yet`).toHaveLength(1)

      const message = await api.get(`/api/v1/message/${messages[0].ID}`)
      const { Text } = (await message.json()) as Message
      link = Text.match(/https?:\/\/\S+\/verify\?token=[\w-]+/)?.[0]
      expect(link, 'the letter carries no /verify link').toBeDefined()
    }).toPass({ timeout: 20_000 })
    return link!
  } finally {
    await api.dispose()
  }
}
