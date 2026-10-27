import {
  Button,
  Grid,
  Group,
  Alert as MantineAlert,
  NumberInput,
  Paper,
  Radio,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import type { ParseKeys } from 'i18next'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CONDITIONS,
  cooldownChoices,
  cooldownOptional,
  cooldownShown,
  deadlineOf,
  EMPTY_FORM,
  EXPIRY_PRESETS,
  REPEAT_POLICIES,
  staysSilent,
  submitOutcome,
  thresholdScale,
  thresholdText,
  toCreateBody,
  toUpdateBody,
  valuesFrom,
  withPolicy,
  type AlertFormValues,
  type FormMode,
} from '../alerts/form'
import { isFinished, SLOT_LIMIT, type Alert } from '../alerts/list'
import { PriceChart } from '../alerts/PriceChart'
import { ALERTS_QUERY_KEY } from '../alerts/query'
import { $api, api } from '../api/client'
import { ApiError } from '../api/problem'
import { usePageTitle } from '../i18n/documentTitle'
import { formatDuration, separatorsFor } from '../i18n/format'
import { resolvedLanguage } from '../i18n/language'
import { useNow } from '../i18n/now'
import { formatAbsolute } from '../i18n/time'
import { NotFound } from '../NotFound'
import { quoteAsset } from '../prices/CoinMark'
import { Price } from '../prices/Price'
import { usePrecision, useQuote, useSymbols } from '../prices/store'
import { ButtonLink } from '../shell/links'
import { ServerError, useServerError } from './ServerError'

const newRoute = getRouteApi('/signed-in/alerts/new')
const editRoute = getRouteApi('/signed-in/alerts/$id/edit')

// The key openapi-react-query gives one Alert, without its parameters, so it
// matches every Alert at once.
const ONE_ALERT_KEY = ['get', '/api/v1/alerts/{alert_id}'] as const

function useAlert(id: string | undefined) {
  return $api.useQuery(
    'get',
    '/api/v1/alerts/{alert_id}',
    { params: { path: { alert_id: id ?? '' } } },
    { enabled: id !== undefined },
  )
}

function FormSkeleton() {
  return (
    <Stack gap="md">
      <Skeleton h={32} w={220} />
      <Skeleton h={420} />
    </Stack>
  )
}

// `/alerts/new`, and `/alerts/new?from=<id>` — a clone, linkable, of any of
// the person's Alerts; above all of a Finished one, since a clone is the only
// way back from a state that is final (ADR 0003).
export function NewAlert() {
  const { from } = newRoute.useSearch()
  const source = useAlert(from)
  const title = from ? 'alertForm.title.clone' : 'alerts.newAlert'
  usePageTitle(title)

  if (from !== undefined && source.isPending) return <FormSkeleton />
  // A source that cannot be read — deleted since the link was made — still
  // leaves a form to fill in; the note says why it is empty.
  const missing = from !== undefined && source.isError
  const initial = source.data ? valuesFrom(source.data, 'create') : EMPTY_FORM

  return <AlertForm mode="create" title={title} initial={initial} cloneMissing={missing} />
}

// `/alerts/:id/edit`. Only what the API lets an Alert change is editable:
// Symbol, Condition and Repeat policy are shown and fixed, and a clone is how
// to change them.
export function EditAlert() {
  const { t } = useTranslation()
  const { id } = editRoute.useParams()
  const alert = useAlert(id)
  usePageTitle('alertForm.title.edit')

  if (alert.isPending) return <FormSkeleton />
  if (alert.isError) {
    if (alert.error instanceof ApiError && alert.error.status === 404) return <NotFound />
    return <Text c="dimmed">{t('alertForm.loadFailed')}</Text>
  }
  // Finished is final: nothing here could put it back to work, so the screen
  // offers the one thing that does.
  if (isFinished(alert.data.status)) {
    return (
      <MantineAlert color="gray" title={t('alertForm.finished.title')}>
        <Stack gap="sm" align="flex-start">
          <Text size="sm">{t('alertForm.finished.body')}</Text>
          <ButtonLink to="/alerts/new" search={{ from: id }} size="xs">
            {t('alertForm.finished.clone')}
          </ButtonLink>
        </Stack>
      </MantineAlert>
    )
  }
  return (
    <AlertForm
      // a refetch on focus brings a newer copy; the form starts from the one
      // it opened with and does not jump under the person's cursor
      key={alert.data.id}
      mode="edit"
      title="alertForm.title.edit"
      initial={valuesFrom(alert.data, 'edit')}
      original={alert.data}
    />
  )
}

// The Cooldown choice that means none, in the form's own words.
const NO_COOLDOWN = 'none'

// API field → form field, for a 422 that names one.
const FIELD_NAMES: Record<string, string> = {
  repeat_policy: 'repeatPolicy',
  cooldown_seconds: 'cooldown',
  expires_in_seconds: 'expiry',
}

type FormProps = {
  mode: FormMode
  // the same key as the tab title, so the heading and the tab never disagree
  title: ParseKeys
  initial: AlertFormValues
  original?: Alert
  cloneMissing?: boolean
}

function AlertForm({ mode, title, initial, original, cloneMissing = false }: FormProps) {
  const { t, i18n } = useTranslation()
  const language = resolvedLanguage(i18n)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const symbols = useSymbols()
  const { data: me } = $api.useQuery('get', '/api/v1/users/me')
  const server = useServerError()
  const [submitting, setSubmitting] = useState(false)
  const editing = mode === 'edit'
  const conditionLabel = useId()

  const form = useForm<AlertFormValues>({
    initialValues: initial,
    validate: {
      symbol: (value) => {
        if (!value) return t('alertForm.errors.symbolRequired')
        // Picked from a list that has since changed — or cloned from an Alert
        // on a Symbol that left. The person did nothing wrong: the list did.
        if (!editing && symbols !== null && !symbols.includes(value)) {
          return t('alertForm.errors.staleList', { symbol: value })
        }
        return null
      },
      threshold: (value) =>
        thresholdText(value) === null ? t('alertForm.errors.thresholdRequired') : null,
    },
  })
  const values = form.getValues()
  // the precision only: the form must not re-render on every Tick
  const precision = usePrecision(values.symbol)
  const threshold = thresholdText(values.threshold)

  const leave = async () => {
    await queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY })
    await navigate({ to: '/alerts' })
  }

  const submit = form.onSubmit(async (submitted) => {
    setSubmitting(true)
    server.clear()
    try {
      if (original) {
        await api.PATCH('/api/v1/alerts/{alert_id}', {
          params: { path: { alert_id: original.id } },
          body: toUpdateBody(submitted, original),
        })
        // Dropped, not refetched: this screen is about to leave, and the next
        // one to open the Alert should load the copy the server now holds.
        queryClient.removeQueries({ queryKey: ONE_ALERT_KEY })
      } else {
        await api.POST('/api/v1/alerts', { body: toCreateBody(submitted) })
      }
      await leave()
    } catch (error) {
      setSubmitting(false)
      switch (submitOutcome(error, mode)) {
        case 'deleted':
          // Somebody — another tab, another person on the demo account —
          // deleted it meanwhile. Not resubmitted anywhere: a create in its
          // place would be a rule nobody asked for.
          notifications.show({ color: 'red', message: t('alertForm.errors.deleted') })
          queryClient.removeQueries({ queryKey: ONE_ALERT_KEY })
          await leave()
          return
        case 'limit':
          server.say(
            t(me?.is_demo ? 'alertForm.errors.limitDemo' : 'alertForm.errors.limit', {
              limit: SLOT_LIMIT,
            }),
          )
          return
        case 'staleSymbol':
          form.setFieldError(
            'symbol',
            t('alertForm.errors.staleList', { symbol: submitted.symbol }),
          )
          // the list the picker offered is out of date; fetch the current one
          void queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/symbols'] })
          return
        default:
          server.show(error, form, FIELD_NAMES)
      }
    }
  })

  // The picker offers what the system streams, plus the value already in the
  // field when it is not among them — a cloned Alert on a withdrawn Symbol must
  // show what it is, with the message under it, rather than an empty box.
  const symbolOptions = [...(symbols ?? [])]
  if (values.symbol && !symbolOptions.includes(values.symbol)) symbolOptions.push(values.symbol)
  const separators = separatorsFor(language)

  return (
    <Stack gap="md" maw={1100}>
      <Title order={1} size="h2">
        {t(title)}
      </Title>
      {cloneMissing && (
        <MantineAlert color="gray" variant="light">
          {t('alertForm.cloneMissing')}
        </MantineAlert>
      )}
      <form onSubmit={submit} noValidate>
        <Stack gap="md">
          <ServerError message={server.message} />

          <Group align="flex-start" gap="md" wrap="wrap">
            <Select
              label={t('alertForm.symbol.label')}
              placeholder={t('alertForm.symbol.placeholder')}
              data={symbolOptions}
              searchable
              allowDeselect={false}
              disabled={editing}
              w={{ base: '100%', xs: 220 }}
              nothingFoundMessage={t('alertForm.symbol.nothingFound')}
              {...form.getInputProps('symbol')}
            />
            <Stack gap={4}>
              <Text size="sm" fw={500} id={conditionLabel}>
                {t('alertForm.condition.label')}
              </Text>
              <SegmentedControl
                aria-labelledby={conditionLabel}
                disabled={editing}
                data={CONDITIONS.map(({ value }) => ({
                  value,
                  label: t(`alertForm.condition.${value}`),
                }))}
                {...form.getInputProps('condition')}
              />
            </Stack>
          </Group>

          <Grid gap="md" align="flex-start">
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap="sm">
                <NumberInput
                  label={t('alertForm.threshold.label')}
                  description={
                    values.symbol ? (
                      <NowLine symbol={values.symbol} />
                    ) : (
                      t('alertForm.threshold.hint')
                    )
                  }
                  min={0}
                  allowNegative={false}
                  hideControls
                  decimalScale={thresholdScale(precision, initial.threshold)}
                  decimalSeparator={separators.decimalSeparator}
                  thousandSeparator={separators.thousandSeparator}
                  rightSection={
                    values.symbol && quoteAsset(values.symbol) ? (
                      <Text size="xs" c="dimmed">
                        {quoteAsset(values.symbol)}
                      </Text>
                    ) : undefined
                  }
                  rightSectionWidth={52}
                  inputMode="decimal"
                  {...form.getInputProps('threshold')}
                />
                {!editing && <SilenceWarning values={values} />}
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Paper withBorder radius="md" p="xs">
                {values.symbol ? (
                  <PriceChart
                    symbol={values.symbol}
                    threshold={threshold === null ? null : Number(threshold)}
                  />
                ) : (
                  <Text size="sm" c="dimmed" ta="center" py="xl">
                    {t('alertForm.chart.pickSymbol')}
                  </Text>
                )}
              </Paper>
            </Grid.Col>
          </Grid>

          <Radio.Group
            label={t('alertForm.repeat.label')}
            value={values.repeatPolicy}
            onChange={(policy) => form.setValues(withPolicy(form.getValues(), policy))}
          >
            <Stack gap="xs" mt={6}>
              {REPEAT_POLICIES.map((policy) => (
                <Radio
                  key={policy}
                  value={policy}
                  disabled={editing}
                  label={t(`alertForm.repeat.${policy}.label`)}
                  description={t(`alertForm.repeat.${policy}.description`)}
                />
              ))}
            </Stack>
          </Radio.Group>
          {editing && (
            <Text size="xs" c="dimmed">
              {t('alertForm.fixedFields')}
            </Text>
          )}

          <Group align="flex-start" gap="md" wrap="wrap">
            {cooldownShown(values.repeatPolicy) && (
              <Select
                label={t('alertForm.cooldown.label')}
                description={t('alertForm.cooldown.description')}
                allowDeselect={false}
                w={{ base: '100%', xs: 260 }}
                data={[
                  ...(cooldownOptional(values.repeatPolicy)
                    ? [{ value: NO_COOLDOWN, label: t('alerts.cooldown.none') }]
                    : []),
                  ...cooldownChoices(values.cooldown).map((seconds) => ({
                    value: String(seconds),
                    label: formatDuration(seconds, language),
                  })),
                ]}
                {...form.getInputProps('cooldown')}
              />
            )}
            <ExpirySelect values={values} original={original} form={form} />
          </Group>

          <Group gap="sm">
            <Button type="submit" loading={submitting}>
              {t(editing ? 'alertForm.submit.edit' : 'alertForm.submit.create')}
            </Button>
            <ButtonLink to="/alerts" variant="default">
              {t('alertForm.cancel')}
            </ButtonLink>
          </Group>
        </Stack>
      </form>
    </Stack>
  )
}

// The live price beside the field where the Threshold is chosen. Its own
// component: it changes four times a second, the form around it must not.
function NowLine({ symbol }: { symbol: string }) {
  const { t } = useTranslation()
  return (
    <Group gap={4} component="span" wrap="nowrap">
      <span>{t('alertForm.threshold.now')}</span>
      <Price symbol={symbol} span size="xs" fw={600} />
    </Group>
  )
}

// Before saving, never after: an `on_cross` Alert created while its Condition
// already holds stays silent until the price leaves and crosses back.
function SilenceWarning({ values }: { values: AlertFormValues }) {
  const { t } = useTranslation()
  const quote = useQuote(values.symbol)
  if (!staysSilent(values, quote?.price ?? null)) return null

  return (
    <MantineAlert color="yellow" variant="light" role="status" data-testid="silence-warning">
      {t('alertForm.repeat.alreadyHolds')}
    </MantineAlert>
  )
}

type ExpiryProps = {
  values: AlertFormValues
  original?: Alert
  form: { getInputProps: (path: 'expiry') => object }
}

// Durations, with the deadline each means said as a date and time in the
// reader's own zone — nobody adds seven days in their head. Counted from now,
// as the server will; the 30-second clock keeps the sentence honest.
function ExpirySelect({ values, original, form }: ExpiryProps) {
  const { t, i18n } = useTranslation()
  const language = resolvedLanguage(i18n)
  const now = useNow()
  const current = original?.expires_at ? Date.parse(original.expires_at) : null
  const deadline = values.expiry === 'keep' ? current : deadlineOf(values.expiry, now)

  const data = [
    ...(current !== null ? [{ value: 'keep', label: t('alertForm.expiry.keep') }] : []),
    { value: 'none', label: t('alertForm.expiry.none') },
    ...EXPIRY_PRESETS.map((seconds) => ({
      value: String(seconds),
      label: t(`alertForm.expiry.preset.${String(seconds) as `${typeof seconds}`}`),
    })),
  ]

  return (
    <Select
      label={t('alertForm.expiry.label')}
      description={
        deadline === null
          ? t('alertForm.expiry.never')
          : t('alertForm.expiry.until', { when: formatAbsolute(deadline, language) })
      }
      allowDeselect={false}
      w={{ base: '100%', xs: 260 }}
      data={data}
      {...form.getInputProps('expiry')}
    />
  )
}
