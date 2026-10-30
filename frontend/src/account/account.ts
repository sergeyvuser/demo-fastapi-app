import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '../api/client'
import type { components } from '../api/generated/http'
import { ApiError } from '../api/problem'

type User = components['schemas']['UserRead']

// /users/me as openapi-react-query keys it. Every write on this screen answers
// with the User (or, for the unlink, implies one), and that answer is written
// straight into the cache: the menu, the banner and this screen read the same
// entry, so none of them shows the old state for a refetch's length.
const ME = ['get', '/api/v1/users/me']

// The largest number a chat id may be: the API's own ceiling, and the largest
// integer a browser holds exactly — a bigger one would be saved as a
// different number than the one typed.
const MAX_CHAT_ID = BigInt(Number.MAX_SAFE_INTEGER)

// What a person typed, as a chat id, or null when it cannot be one. Positive
// digits only: a group's id is negative and the API refuses it (private chats
// only), so a minus sign is refused here first, with a sentence that says so.
// Spaces around the number are forgiven — a copy from Telegram often has one.
export function parseChatId(typed: string): number | null {
  const digits = typed.trim()
  if (!/^\d+$/.test(digits)) return null
  const value = BigInt(digits)
  if (value === 0n || value > MAX_CHAT_ID) return null
  return Number(value)
}

// Why a save was refused, in the words the screen has a sentence for. Told
// apart by the RFC 9457 `type` the API sends, never by `detail`: the API's
// prose is English and has no contract.
export type Refusal =
  | { kind: 'notStarted' }
  | { kind: 'blocked' }
  | { kind: 'taken' }
  | { kind: 'unverified' }
  | { kind: 'limited'; retryAfter: number | null }
  | { kind: 'unavailable' }
  | { kind: 'network' }
  | { kind: 'other'; status: number; detail: string | null }

const REFUSAL_BY_TYPE: Record<string, Refusal['kind']> = {
  'urn:alerts:linked-chat:not-started': 'notStarted',
  'urn:alerts:linked-chat:blocked': 'blocked',
  'urn:alerts:linked-chat:taken': 'taken',
}

export function linkRefusal(error: unknown): Refusal {
  // a network failure throws a TypeError from fetch, with no status at all
  if (!(error instanceof ApiError)) return { kind: 'network' }
  const known = REFUSAL_BY_TYPE[error.type]
  if (known === 'notStarted' || known === 'blocked' || known === 'taken') return { kind: known }
  // The demo account is refused with a 403 too, but it never sees the form;
  // the one 403 a person here can meet is the unconfirmed address.
  if (error.status === 403) return { kind: 'unverified' }
  // only failed saves are metered, so this is "too many refusals", not "too fast"
  if (error.status === 429) return { kind: 'limited', retryAfter: error.retryAfter }
  if (error.status === 503) return { kind: 'unavailable' }
  return { kind: 'other', status: error.status, detail: error.detail }
}

function useWriteMe() {
  const queryClient = useQueryClient()
  return (update: (user: User) => User) =>
    queryClient.setQueriesData<User>({ queryKey: ME }, (user) => user && update(user))
}

// Saving a chat is proved by a message: the API answers only once Telegram
// has delivered a test message there, and the answer is the User with it.
export function useLinkChat() {
  const writeMe = useWriteMe()
  return useMutation({
    mutationFn: async (chatId: number) => {
      const { data } = await api.PUT('/api/v1/users/me/linked-chat', {
        body: { chat_id: chatId },
      })
      return data
    },
    onSuccess: (user) => {
      if (user) writeMe(() => user)
    },
  })
}

// Available at any time, verified or not: stopping Notifications must never
// be harder than starting them. Alerts are untouched — they still go off and
// still appear in History.
export function useUnlinkChat() {
  const writeMe = useWriteMe()
  return useMutation({
    mutationFn: async () => {
      await api.DELETE('/api/v1/users/me/linked-chat')
    },
    onSuccess: () => writeMe((user) => ({ ...user, telegram_chat_id: null })),
  })
}

// The Digest switch. The screen shows the value being sent while the request
// is in flight (`variables`) and the cached one otherwise, so a refusal puts
// the switch back by itself — there is no optimistic write to undo.
export function useDigestSwitch() {
  const writeMe = useWriteMe()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data } = await api.PUT('/api/v1/users/me/preferences', {
        body: { digest_enabled: enabled },
      })
      return data
    },
    onSuccess: (user) => {
      if (user) writeMe(() => user)
    },
  })
}

// The Digest's send hour as an instant today, for rendering in the reader's
// own zone. Today's date rather than a fixed one, so the offset is the one in
// force now — a fixed winter date would be an hour off all summer.
export function digestInstant(hourUtc: number, now: number = Date.now()): number {
  const today = new Date(now)
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hourUtc)
}
