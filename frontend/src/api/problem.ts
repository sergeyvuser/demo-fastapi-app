// The one place that knows what an error from this API looks like. It answers
// in three shapes, and nothing outside this file tells them apart:
//
//   1. application/problem+json (RFC 9457) — every error the backend raises
//      itself: { type: "about:blank", title, status, detail, instance }
//   2. { detail: "…" } — framework exceptions the registered handler does not
//      cover: an unknown route, a wrong method, a missing bearer token
//   3. { detail: [{ loc, msg, type }, …] } — request validation, always a 422
//
// The prose in `detail` is English from the server and is rendered as it is —
// an interim position the spec takes on purpose.

export type FieldError = {
  // the path inside the request body, dotted the way @mantine/form names
  // fields; empty when the error is about the body as a whole
  field: string
  message: string
}

export type Problem = {
  status: number
  // RFC 9457's machine-readable kind of the error — what a client branches
  // on, since `detail` is English prose. Absent means "about:blank".
  type?: string
  detail: string | null
  fieldErrors: FieldError[]
}

export class ApiError extends Error {
  readonly status: number
  readonly type: string
  readonly detail: string | null
  readonly fieldErrors: FieldError[]
  // Seconds until asking again can work, from a 429's Retry-After; null when
  // the response did not say.
  readonly retryAfter: number | null

  constructor(problem: Problem, retryAfter: number | null = null) {
    super(problem.detail ?? `HTTP ${problem.status}`)
    this.name = 'ApiError'
    this.status = problem.status
    // the RFC's own default: a problem with no type is "about:blank"
    this.type = problem.type ?? 'about:blank'
    this.detail = problem.detail
    this.fieldErrors = problem.fieldErrors
    this.retryAfter = retryAfter
  }
}

// The header may carry seconds or an HTTP date. This API sends seconds, and
// a date is read as "not said" rather than parsed for a case that never comes.
export function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null
  return Number(header.trim())
}

export function parseProblem(status: number, body: unknown): Problem {
  const detail = isRecord(body) ? body.detail : undefined

  if (Array.isArray(detail)) {
    return { status, detail: null, fieldErrors: detail.filter(isRecord).map(toFieldError) }
  }
  // shapes 1 and 2 differ in everything except `detail`; only 1 has `type`
  if (typeof detail === 'string') {
    const type = isRecord(body) && typeof body.type === 'string' ? body.type : undefined
    return { status, ...(type === undefined ? {} : { type }), detail, fieldErrors: [] }
  }
  // Not ours at all: the proxy's HTML while the API restarts, an empty body.
  return { status, detail: null, fieldErrors: [] }
}

function toFieldError(item: Record<string, unknown>): FieldError {
  const loc = Array.isArray(item.loc) ? item.loc : []
  return {
    // loc[0] names where the value came from ("body", "query", "path")
    field: loc.slice(1).join('.'),
    message: typeof item.msg === 'string' ? item.msg : '',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
