import { Alert, Button, Group, List, Stack, Text, TextInput } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ExternalLink } from '../shell/Footer'
import { linkRefusal, parseChatId, useLinkChat, useUnlinkChat, type Refusal } from './account'

type Props = {
  chatId: number | null
  isDemo: boolean
  // the bot's @username without the @; null while unknown or unanswered
  bot: string | null
}

// The Linked chat: where Notifications go. Instructions first and the
// third-party warning after them, in that order, because the order is the
// procedure — a person who skips Start is refused without knowing why.
export function LinkedChat({ chatId, isDemo, bot }: Props) {
  const { t } = useTranslation()

  return (
    <Stack gap="sm">
      <Text size="sm">{t('account.chat.purpose')}</Text>
      {!isDemo && (
        <Text size="sm" fw={500}>
          {chatId === null ? t('account.chat.notLinked') : t('account.chat.linked', { id: chatId })}
        </Text>
      )}
      <Steps bot={bot} />
      <Alert color="yellow" variant="light" title={t('account.chat.warningTitle')}>
        {t('account.chat.warning')}
      </Alert>
      {isDemo ? <DemoInstead /> : <ChatForm linked={chatId !== null} />}
    </Stack>
  )
}

function Steps({ bot }: { bot: string | null }) {
  const { t } = useTranslation()
  const handle = bot === null ? null : `@${bot}`

  return (
    <List type="ordered" size="sm" spacing="xs" aria-label={t('account.chat.stepsLabel')}>
      <List.Item>
        {handle === null ? (
          t('account.chat.stepStartUnnamed')
        ) : (
          <>
            {t('account.chat.stepStart', { bot: handle })}{' '}
            <ExternalLink href={`https://t.me/${bot}`}>
              {t('account.chat.openBot', { bot: handle })}
            </ExternalLink>
          </>
        )}
      </List.Item>
      <List.Item>{t('account.chat.stepNumber')}</List.Item>
    </List>
  )
}

// Where the input would be on the demo account: a block that says why, and
// what to do instead. Not a disabled input — that explains nothing, and some
// screen readers skip it entirely. The feature the product exists for stays
// legible where it cannot be used.
function DemoInstead() {
  const { t } = useTranslation()
  return (
    <Alert color="gray" variant="light">
      {t('account.chat.demo')}
    </Alert>
  )
}

function ChatForm({ linked }: { linked: boolean }) {
  const { t } = useTranslation()
  const link = useLinkChat()
  const unlink = useUnlinkChat()
  const [typed, setTyped] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    unlink.reset()
    const chatId = parseChatId(typed)
    setInvalid(chatId === null)
    if (chatId === null) {
      link.reset()
      return
    }
    link.mutate(chatId, { onSuccess: () => setTyped('') })
  }

  return (
    <Stack gap="xs">
      <form onSubmit={submit} noValidate>
        <Stack gap="xs" align="flex-start">
          <TextInput
            w="100%"
            maw={320}
            label={t('account.chat.field')}
            description={t('account.chat.fieldHint')}
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.currentTarget.value)
              setInvalid(false)
            }}
            error={invalid ? t('account.chat.errors.invalid') : null}
          />
          <Button type="submit" size="sm" loading={link.isPending}>
            {t('account.chat.save')}
          </Button>
        </Stack>
      </form>
      {link.isSuccess && <Said>{t('account.chat.saved')}</Said>}
      {link.isError && <RefusalSentence refusal={linkRefusal(link.error)} />}
      {linked && (
        <Group>
          <Button
            variant="default"
            size="sm"
            loading={unlink.isPending}
            onClick={() => {
              link.reset()
              unlink.mutate()
            }}
          >
            {t('account.chat.unlink')}
          </Button>
        </Group>
      )}
      {unlink.isSuccess && <Said>{t('account.chat.unlinked')}</Said>}
      {unlink.isError && <Failed>{t('account.chat.unlinkFailed')}</Failed>}
    </Stack>
  )
}

// A refusal is a refusal, said in its own words: each one asks for a
// different next step, which is why they are told apart at all.
function RefusalSentence({ refusal }: { refusal: Refusal }) {
  const { t } = useTranslation()
  switch (refusal.kind) {
    case 'notStarted':
      return <Failed>{t('account.chat.errors.notStarted')}</Failed>
    case 'blocked':
      return <Failed>{t('account.chat.errors.blocked')}</Failed>
    case 'taken':
      return <Failed>{t('account.chat.errors.taken')}</Failed>
    case 'unverified':
      return <Failed>{t('account.chat.errors.unverified')}</Failed>
    case 'limited':
      // A sentence, not a red line: nothing is broken, the budget refills.
      return (
        <Said>
          {refusal.retryAfter === null
            ? t('account.chat.errors.limitedSoon')
            : t('account.chat.errors.limited', {
                count: Math.max(1, Math.ceil(refusal.retryAfter / 60)),
              })}
        </Said>
      )
    case 'unavailable':
      return <Failed>{t('account.chat.errors.unavailable')}</Failed>
    case 'network':
      return <Failed>{t('auth.errors.network')}</Failed>
    case 'other':
      return (
        <Failed>{refusal.detail ?? t('auth.errors.unknown', { status: refusal.status })}</Failed>
      )
  }
}

// role="status": announced without taking the focus
function Said({ children }: { children: string }) {
  return (
    <Text size="sm" role="status">
      {children}
    </Text>
  )
}

function Failed({ children }: { children: string }) {
  return (
    <Text size="sm" c="red" role="alert">
      {children}
    </Text>
  )
}
