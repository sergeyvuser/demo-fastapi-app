import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { api } from '../api/client'
import { ApiError } from '../api/problem'
import type { Alert } from './list'
import { ALERTS_QUERY_KEY } from './query'

// Pause, resume and delete: the only writes the list makes optimistically.
// Each is one field the client already knows the answer to — unlike create
// and edit, where the server invents the derived state and the deadline — so
// the list can move with the click and be corrected if the server refuses.

// One Alert as openapi-react-query keys it, without its parameters, so it
// matches every Alert at once (the edit screen's copy).
const ONE_ALERT_KEY = ['get', '/api/v1/alerts/{alert_id}'] as const

// Every query that lists Triggers: the History feed, a filtered feed, and the
// five on an Alert's own screen. A deleted Alert takes its Triggers with it.
const TRIGGERS_KEY = ['triggers'] as const

// Shared by every write here, so the last one to settle can tell it is last.
const WRITE_KEY = ['alerts', 'write'] as const

export type Switchable = 'active' | 'paused'

// The list with one Alert's Status replaced, every other Alert untouched.
export function withStatus(alerts: readonly Alert[], id: string, status: Alert['status']): Alert[] {
  return alerts.map((alert) => (alert.id === id ? { ...alert, status } : alert))
}

export function withoutAlert(alerts: readonly Alert[], id: string): Alert[] {
  return alerts.filter((alert) => alert.id !== id)
}

// Put back after a refused delete. The screen sorts on render, so where it
// goes in the array does not matter; that it is not there twice does.
export function restoreAlert(alerts: readonly Alert[], alert: Alert): Alert[] {
  return [...withoutAlert(alerts, alert.id), alert]
}

// A `404` on delete means the row is already gone — another tab, another
// person on the demo account. That is the outcome the person asked for, so
// it is a success: arguing with reality would put back a card for an Alert
// that no longer exists.
export async function deleteAlert(id: string): Promise<void> {
  try {
    await api.DELETE('/api/v1/alerts/{alert_id}', { params: { path: { alert_id: id } } })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return
    throw error
  }
}

export async function setAlertStatus(id: string, status: Switchable): Promise<void> {
  await api.PATCH('/api/v1/alerts/{alert_id}', {
    params: { path: { alert_id: id } },
    body: { status },
  })
}

function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

// Why it failed, in the words available: the server's own sentence when it
// gave one (a Finished Alert cannot be resumed), ours otherwise.
function reasonOf(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiError)) return t('auth.errors.network')
  return error.detail ?? t('auth.errors.unknown', { status: error.status })
}

// Refetch once the last overlapping write has settled, never before: a
// refetch started while a second click is still in flight would bring back
// the state from before that click and flicker the card through it.
function settle(queryClient: QueryClient) {
  if (queryClient.isMutating({ mutationKey: WRITE_KEY }) === 1) {
    void queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY })
  }
}

function updateList(queryClient: QueryClient, update: (alerts: Alert[]) => Alert[]) {
  queryClient.setQueryData<Alert[]>(ALERTS_QUERY_KEY, (alerts) => alerts && update(alerts))
}

// Called once by the screen that stays mounted, not by a card: a deleted card
// unmounts at once, and the write it started must still be able to roll back.
export function useAlertActions() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const status = useMutation({
    mutationKey: WRITE_KEY,
    mutationFn: ({ alert, to }: { alert: Alert; to: Switchable }) => setAlertStatus(alert.id, to),
    onMutate: async ({ alert, to }) => {
      // an older list arriving now would overwrite the click
      await queryClient.cancelQueries({ queryKey: ALERTS_QUERY_KEY })
      updateList(queryClient, (alerts) => withStatus(alerts, alert.id, to))
    },
    onError: (error, { alert, to }) => {
      if (isGone(error)) {
        // Deleted elsewhere: there is nothing to roll back to.
        updateList(queryClient, (alerts) => withoutAlert(alerts, alert.id))
        notifications.show({ color: 'red', message: t('alerts.actions.gone') })
        return
      }
      // Only this Alert, only its Status: a click on another card since must
      // survive this one's failure.
      updateList(queryClient, (alerts) => withStatus(alerts, alert.id, alert.status))
      notifications.show({
        color: 'red',
        title: t(to === 'paused' ? 'alerts.actions.pauseFailed' : 'alerts.actions.resumeFailed', {
          symbol: alert.symbol,
        }),
        message: reasonOf(error, t),
      })
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ONE_ALERT_KEY }),
    onSettled: () => settle(queryClient),
  })

  const remove = useMutation({
    mutationKey: WRITE_KEY,
    mutationFn: (alert: Alert) => deleteAlert(alert.id),
    onMutate: async (alert) => {
      await queryClient.cancelQueries({ queryKey: ALERTS_QUERY_KEY })
      updateList(queryClient, (alerts) => withoutAlert(alerts, alert.id))
    },
    onError: (error, alert) => {
      updateList(queryClient, (alerts) => restoreAlert(alerts, alert))
      notifications.show({
        color: 'red',
        title: t('alerts.actions.deleteFailed', { symbol: alert.symbol }),
        message: reasonOf(error, t),
      })
    },
    onSuccess: (_, alert) => {
      queryClient.removeQueries({
        queryKey: [...ONE_ALERT_KEY, { params: { path: { alert_id: alert.id } } }],
      })
      void queryClient.invalidateQueries({ queryKey: TRIGGERS_KEY })
    },
    onSettled: () => settle(queryClient),
  })

  return {
    pause: (alert: Alert) => status.mutate({ alert, to: 'paused' }),
    resume: (alert: Alert) => status.mutate({ alert, to: 'active' }),
    remove: (alert: Alert) => remove.mutate(alert),
  }
}

export type AlertActions = ReturnType<typeof useAlertActions>
