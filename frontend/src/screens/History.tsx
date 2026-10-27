import { Box, Button, Divider, Paper, Skeleton, Stack, Text, Title } from '@mantine/core'
import { Fragment, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useTriggerFeed, type Trigger } from '../history/feed'
import { TriggerRow } from '../history/TriggerRow'
import { usePageTitle } from '../i18n/documentTitle'

// How far below the window the next page is asked for: early enough that a
// reader scrolling at a normal pace never waits at the bottom.
const PREFETCH_MARGIN = '600px'

// Every occasion one of this person's Alerts went off, newest first, so they
// can see what the system did while they were away. Older pages load as the
// reader nears the end, over the server's keyset cursor — which is what keeps
// the feed honest while new Triggers arrive at its head.
export function History() {
  const { t } = useTranslation()
  usePageTitle('shell.history')
  const feed = useTriggerFeed()

  if (feed.isPending) return <FeedSkeleton />
  if (feed.isError) {
    return (
      <Stack align="flex-start" gap="xs">
        <PageTitle />
        <Text c="dimmed">{t('history.loadFailed')}</Text>
        <Button variant="default" size="xs" onClick={() => void feed.refetch()}>
          {t('history.retry')}
        </Button>
      </Stack>
    )
  }

  const triggers = feed.data
  return (
    <Stack gap="md" maw={720}>
      <PageTitle />
      {triggers.length === 0 ? (
        <Text c="dimmed">{t('history.empty')}</Text>
      ) : (
        <>
          <TriggerList triggers={triggers} />
          <FeedEnd
            hasMore={feed.hasNextPage}
            loading={feed.isFetchingNextPage}
            failed={feed.isFetchNextPageError}
            loadMore={() => void feed.fetchNextPage()}
          />
        </>
      )}
    </Stack>
  )
}

function TriggerList({ triggers }: { triggers: readonly Trigger[] }) {
  return (
    <Paper withBorder radius="md" p="sm" role="list">
      {triggers.map((trigger, index) => (
        <Fragment key={trigger.id}>
          {index > 0 && <Divider my="xs" />}
          <div role="listitem">
            <TriggerRow trigger={trigger} />
          </div>
        </Fragment>
      ))}
    </Paper>
  )
}

// The foot of the feed says which of three things is true: more is coming,
// more could not be fetched, or this is all there is. A button stands beside
// the automatic loading on purpose — a keyboard, a screen reader and a
// browser without an observer all reach older pages through it.
function FeedEnd({
  hasMore,
  loading,
  failed,
  loadMore,
}: {
  hasMore: boolean
  loading: boolean
  failed: boolean
  loadMore: () => void
}) {
  const { t } = useTranslation()
  // A failed page is not retried by scrolling: an observer that fires on
  // every pixel would turn one outage into a stream of requests.
  const sentinel = useLoadOnSight(hasMore && !loading && !failed, loadMore)

  if (!hasMore) {
    return (
      <Text size="xs" c="dimmed" ta="center">
        {t('history.end')}
      </Text>
    )
  }

  return (
    <Stack align="center" gap={4} ref={sentinel}>
      {failed && (
        <Text size="xs" c="dimmed">
          {t('history.olderFailed')}
        </Text>
      )}
      <Button variant="subtle" size="xs" loading={loading} onClick={loadMore}>
        {failed ? t('history.retry') : t('history.loadOlder')}
      </Button>
      {loading && (
        <Text size="xs" c="dimmed" role="status">
          {t('history.loadingOlder')}
        </Text>
      )}
    </Stack>
  )
}

// Calls `onSight` when the element nears the window, while `enabled`.
//
// The observer is rebuilt every time `enabled` flips back on — after each
// page, that is — and a new observer reports the element's current state at
// once. That is what loads the page after next when a tall window still
// shows the end of the list: an observer kept alive would wait for a change
// in visibility that never comes.
function useLoadOnSight(enabled: boolean, onSight: () => void) {
  const element = useRef<HTMLDivElement>(null)
  // the latest callback, without making it a reason to rebuild the observer
  const callback = useRef(onSight)
  useEffect(() => {
    callback.current = onSight
  })

  useEffect(() => {
    const target = element.current
    if (!enabled || target === null || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current()
      },
      { rootMargin: `0px 0px ${PREFETCH_MARGIN} 0px` },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [enabled])

  return element
}

function PageTitle() {
  const { t } = useTranslation()

  return (
    <Title order={1} size="h3">
      {t('shell.history')}
    </Title>
  )
}

function FeedSkeleton() {
  return (
    <Stack gap="md" maw={720} aria-busy="true">
      <PageTitle />
      <Box>
        <Skeleton height={320} radius="md" />
      </Box>
    </Stack>
  )
}
