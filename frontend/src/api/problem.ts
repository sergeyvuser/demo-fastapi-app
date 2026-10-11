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
  detail: string | null
  fieldErrors: FieldError[]
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: string | null
  readonly fieldErrors: FieldError[]

  constructor(problem: Problem) {
    super(problem.detail ?? `HTTP ${problem.status}`)
    this.name = 'ApiError'
    this.status = problem.status
    this.detail = problem.detail
    this.fieldErrors = problem.fieldErrors
  }
}

export function parseProblem(status: number, body: unknown): Problem {
  const detail = isRecord(body) ? body.detail : undefined

  if (Array.isArray(detail)) {
    return { status, detail: null, fieldErrors: detail.filter(isRecord).map(toFieldError) }
  }
  // shapes 1 and 2 differ in everything except the member we read
  if (typeof detail === 'string') {
    return { status, detail, fieldErrors: [] }
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
