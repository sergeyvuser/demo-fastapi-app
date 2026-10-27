import type { components } from '../api/generated/http'
import { ApiError } from '../api/problem'
import { conditionHolds, type Condition } from './distance'
import type { Alert } from './list'

type Schemas = components['schemas']
export type RepeatPolicy = Schemas['AlertRepeatPolicy']
type ExpiryPreset = Schemas['ExpiryPreset']
export type AlertCreateBody = Schemas['AlertCreate']
export type AlertUpdateBody = Schemas['AlertUpdate']

// What a Threshold is measured in, per kind of Condition. Today there is one
// kind — a price, compared with a Tick — and the selector is built over this
// table rather than over two hard-coded buttons, so a second kind (a percent
// change over a period) is a row here plus its own unit, not a new form.
export const CONDITIONS = [
  { value: 'price_above', kind: 'price' },
  { value: 'price_below', kind: 'price' },
] as const satisfies readonly { value: Condition; kind: 'price' }[]

// In the order the form offers them: the default first.
export const REPEAT_POLICIES = [
  'while_true',
  'once',
  'on_cross',
] as const satisfies readonly RepeatPolicy[]

// Choices for a Cooldown, in seconds, inside the API's one minute to one day.
// A list rather than a number field: nobody needs 47 minutes, and a list has
// no invalid state to explain.
export const COOLDOWN_PRESETS = [60, 300, 900, 1800, 3600, 4 * 3600, 12 * 3600, 86_400] as const
export const DEFAULT_COOLDOWN = 3600

// The API's closed set. "None" is the absence of a value, as it is there; an
// edit adds "keep", which sends nothing and so leaves the deadline alone.
// Written out, not multiplied: `7 * 86_400` is a `number` to the compiler,
// and only the literals match the API's own type.
export const EXPIRY_PRESETS = [
  86_400, 604_800, 2_592_000,
] as const satisfies readonly ExpiryPreset[]

// Every Select in Mantine holds a string, so the form does too; the numbers
// come back in `toCreateBody` / `toUpdateBody` and nowhere else.
export type CooldownChoice = string // seconds, or 'none'
export type ExpiryChoice = 'keep' | 'none' | `${ExpiryPreset}`

export type AlertFormValues = {
  symbol: string
  condition: Condition
  // what Mantine's NumberInput holds: a number once it parses, a string while
  // it does not (empty, a dangling separator)
  threshold: number | string
  repeatPolicy: RepeatPolicy
  cooldown: CooldownChoice
  expiry: ExpiryChoice
}

export type FormMode = 'create' | 'edit'

export const EMPTY_FORM: AlertFormValues = {
  symbol: '',
  condition: 'price_above',
  threshold: '',
  repeatPolicy: 'while_true',
  cooldown: String(DEFAULT_COOLDOWN),
  expiry: 'none',
}

function cooldownChoice(seconds: number | null): CooldownChoice {
  return seconds === null ? 'none' : String(seconds)
}

// The Expiry a clone starts with: the one the original was given, when that
// can be read back — its deadline sits one preset after its creation. An
// Expiry set by a later edit counts from the edit and matches nothing, and
// then the clone starts without one rather than with a guess.
export function clonedExpiry(alert: Alert): ExpiryChoice {
  if (alert.expires_at === null) return 'none'
  const duration = (Date.parse(alert.expires_at) - Date.parse(alert.created_at)) / 1000
  const preset = EXPIRY_PRESETS.find((seconds) => Math.abs(duration - seconds) < 5 * 60)
  return preset === undefined ? 'none' : `${preset}`
}

// A clone is a new Alert that starts where an old one stood; an edit is the
// same Alert, whose deadline is left alone unless the person picks another.
export function valuesFrom(alert: Alert, mode: FormMode): AlertFormValues {
  return {
    symbol: alert.symbol,
    condition: alert.condition,
    threshold: alert.threshold.includes('.')
      ? alert.threshold.replace(/\.?0+$/, '')
      : alert.threshold,
    repeatPolicy: alert.repeat_policy ?? 'while_true',
    cooldown:
      alert.repeat_policy === 'once'
        ? String(DEFAULT_COOLDOWN)
        : cooldownChoice(alert.cooldown_seconds),
    expiry: mode === 'edit' ? (alert.expires_at === null ? 'none' : 'keep') : clonedExpiry(alert),
  }
}

// Whether the Cooldown control exists at all, and whether "none" is one of its
// answers. Under `once` there is no second Trigger to delay; under `on_cross`
// it is an optional debounce; under `while_true` it is what makes the rule
// repeat at a pace instead of on every Tick, so it cannot be absent.
export function cooldownShown(policy: RepeatPolicy): boolean {
  return policy !== 'once'
}

export function cooldownOptional(policy: RepeatPolicy): boolean {
  return policy === 'on_cross'
}

// The presets, plus whatever the Alert already has when it is not one of them:
// an edit must be able to show the value it is editing.
export function cooldownChoices(current: CooldownChoice): number[] {
  const seconds = Number(current)
  const presets: number[] = [...COOLDOWN_PRESETS]
  if (current === 'none' || presets.includes(seconds)) return presets
  return [...presets, seconds].sort((a, b) => a - b)
}

// Switching policy keeps the form in a state it can submit: "no cooldown" is
// not an answer `while_true` accepts, so leaving `on_cross` restores a value.
export function withPolicy(values: AlertFormValues, policy: RepeatPolicy): AlertFormValues {
  const cooldown =
    policy === 'while_true' && values.cooldown === 'none'
      ? String(DEFAULT_COOLDOWN)
      : values.cooldown
  return { ...values, repeatPolicy: policy, cooldown }
}

// The Threshold as a decimal string with a point, whatever the screen showed.
// NumberInput hands back a double once the text parses; eight places is the
// column's scale, and for any price below ten million a double holds those
// digits exactly, so the trimmed `toFixed` is the number that was typed.
export function thresholdText(value: number | string): string | null {
  const number = typeof value === 'number' ? value : Number(value)
  if (value === '' || !Number.isFinite(number) || number <= 0) return null
  return number.toFixed(8).replace(/\.?0+$/, '')
}

// How many decimals the Threshold field allows: the Symbol's precision, or
// more when the Alert being edited or cloned already has more — a field that
// silently rounded the rule it was opened on would change it on save.
export function thresholdScale(precision: number | undefined, threshold: number | string): number {
  const text = typeof threshold === 'number' ? thresholdText(threshold) : threshold
  const typed = text?.includes('.') ? text.split('.')[1].length : 0
  return Math.min(8, Math.max(precision ?? 8, typed))
}

// The one warning the form gives before saving: an `on_cross` Alert created
// while its Condition already holds is seeded as already met by the server, so
// it stays silent until the price leaves and crosses back. Said here, because
// a silence discovered days later reads as a broken product.
export function staysSilent(values: AlertFormValues, price: string | null): boolean {
  if (values.repeatPolicy !== 'on_cross' || price === null) return false
  const threshold = thresholdText(values.threshold)
  if (threshold === null) return false
  return conditionHolds(values.condition, Number(threshold), Number(price))
}

function expirySeconds(choice: ExpiryChoice): ExpiryPreset | null {
  return choice === 'none' || choice === 'keep' ? null : (Number(choice) as ExpiryPreset)
}

// The deadline a preset means if saved now — for showing, never for sending:
// the server counts the duration from its own clock.
export function deadlineOf(choice: ExpiryChoice, now: number): number | null {
  const seconds = expirySeconds(choice)
  return seconds === null ? null : now + seconds * 1000
}

function cooldownSeconds(values: AlertFormValues): number | null {
  if (!cooldownShown(values.repeatPolicy) || values.cooldown === 'none') return null
  return Number(values.cooldown)
}

// Called after validation, so the Threshold parses.
export function toCreateBody(values: AlertFormValues): AlertCreateBody {
  return {
    symbol: values.symbol,
    condition: values.condition,
    threshold: thresholdText(values.threshold)!,
    repeat_policy: values.repeatPolicy,
    cooldown_seconds: cooldownSeconds(values),
    expires_in_seconds: expirySeconds(values.expiry),
  }
}

// Only what changed. Last writer wins for everyone, and a field this form did
// not touch is not this form's to overwrite: a Threshold moved in another tab
// survives an edit here that only changed the Cooldown.
export function toUpdateBody(values: AlertFormValues, original: Alert): AlertUpdateBody {
  const body: AlertUpdateBody = {}
  const threshold = thresholdText(values.threshold)!
  if (Number(threshold) !== Number(original.threshold)) body.threshold = threshold

  const cooldown = cooldownSeconds(values)
  if (cooldownShown(values.repeatPolicy) && cooldown !== original.cooldown_seconds) {
    body.cooldown_seconds = cooldown
  }

  // "keep" sends nothing; "none" on an Alert that has no Expiry, nothing too
  if (values.expiry !== 'keep' && !(values.expiry === 'none' && original.expires_at === null)) {
    body.expires_in_seconds = expirySeconds(values.expiry)
  }
  return body
}

// The losing outcomes of a submit, named. Everything else is the server's own
// sentence in the alert above the form.
export type SubmitOutcome =
  // an edit of an Alert that is no longer there: deleted while being edited
  | 'deleted'
  // the twenty-Alert limit
  | 'limit'
  // a Symbol the client offered and the server no longer streams
  | 'staleSymbol'
  | 'other'

export function submitOutcome(error: unknown, mode: FormMode): SubmitOutcome {
  if (!(error instanceof ApiError)) return 'other'
  if (mode === 'edit' && error.status === 404) return 'deleted'
  // Create answers 409 for one reason and 400 for one reason. The 400 is the
  // Subscription check: a 422 would be a malformed Symbol, which a picker
  // cannot produce.
  if (mode === 'create' && error.status === 409) return 'limit'
  if (mode === 'create' && error.status === 400) return 'staleSymbol'
  return 'other'
}
