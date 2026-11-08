import {
  defaultTextMapSetter,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import { ExportResultCode, W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  TracerProvider,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace'

import { ApiError } from '../api/problem'
import { getAccessToken } from '../api/session'

// Browser spans. Read before adding anything here:
//
// - Only the actions below are traced, by hand. There is no automatic fetch
//   instrumentation: it would trace the symbols poll every ten seconds in
//   every open tab, which is the flood this list exists to prevent.
// - A span carries the User's id and nothing else. No e-mail, no username, no
//   token, no full URL, no request or response body. Credentials never appear
//   in telemetry (the rule is written beside POST /api/v1/traces).
// - The browser never makes up a correlation id. The server derives one from
//   the `traceparent` sent here, so a trace id found in Jaeger also finds the
//   API's log lines.

// The closed list. A name not in it does not compile, so adding a traced
// action is a change to this line, made on purpose.
export const ACTIONS = [
  'auth.sign_in',
  'alert.create',
  'alert.pause',
  'alert.resume',
  'alert.delete',
] as const
export type Action = (typeof ACTIONS)[number]

// What a traced call adds to its request, so the API's span joins this trace.
export type TraceHeaders = Record<string, string>

const USER_ID = 'user.id'

let tracer: Tracer | null = null
let provider: TracerProvider | null = null
const propagator = new W3CTraceContextPropagator()
// Errors already written onto an action's span. Such an error can still come
// up again as an unhandled rejection; it is not reported twice.
const recorded = new WeakSet<object>()

// Every span is sampled: 1.0 here on purpose. Sampling is parent-based on
// every backend service, so once a browser span is the root of a trace, its
// decision is followed down the whole chain. A ratio below one here would
// quietly stop tracing that share of API, evaluator and notifier work, which
// is all traced today. Volume is bounded by the short list above instead.
export function installTracing(processor: SpanProcessor): void {
  provider = new TracerProvider({
    sampler: new AlwaysOnSampler(),
    resource: resourceFromAttributes({ 'service.name': 'frontend' }),
    spanProcessors: [processor],
  })
  tracer = provider.getTracer('frontend')
}

// Tests install their own processor and call this to go back to no tracing.
export async function uninstallTracing(): Promise<void> {
  await provider?.shutdown()
  provider = null
  tracer = null
}

export function startTracing(): void {
  installTracing(
    // The browser build also sends what is queued when the tab is hidden or
    // closed, and the exporter sends with `keepalive`, so that request
    // survives the page.
    new BatchSpanProcessor({
      exporter: new SignedInExporter(exporter()),
      // A span is under 2 KB even with a stack trace in it. Sixteen of them
      // stay far below the endpoint's 64 KiB cap, and below the browser's
      // 64 KiB budget for requests that outlive the page.
      maxExportBatchSize: 16,
      maxQueueSize: 64,
    }),
  )
  window.addEventListener('error', (event) => reportError(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
}

function exporter(): OTLPTraceExporter {
  return new OTLPTraceExporter({
    // Absolute: the exporter passes the address through `new URL()`, which
    // refuses a bare path. Same origin, so the bundle still knows no host.
    url: new URL('/api/v1/traces', location.origin).href,
    // Asked for on every export: the token changes on every refresh.
    headers: () => {
      const token = getAccessToken()
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      return Promise.resolve(headers)
    },
  })
}

// The endpoint takes spans only from a signed-in browser. Without a session
// the spans are dropped here, instead of being sent to a sure 401.
class SignedInExporter implements SpanExporter {
  private readonly inner: SpanExporter

  constructor(inner: SpanExporter) {
    this.inner = inner
  }

  export(...[spans, done]: Parameters<SpanExporter['export']>): void {
    if (getAccessToken() === null) {
      done({ code: ExportResultCode.SUCCESS })
      return
    }
    this.inner.export(spans, done)
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve()
  }
}

// Runs one action from the list inside its own span. `run` must put the
// headers it is given on its request; that is how the API's span joins this
// trace. Passed by hand on purpose: nothing else gets them by accident.
export async function traced<T>(
  action: Action,
  run: (headers: TraceHeaders) => Promise<T>,
): Promise<T> {
  if (tracer === null) return run({})
  const span = tracer.startSpan(action)
  const headers: TraceHeaders = {}
  propagator.inject(trace.setSpan(ROOT_CONTEXT, span), headers, defaultTextMapSetter)
  try {
    return await run(headers)
  } catch (error) {
    record(span, error)
    throw error
  } finally {
    // Read at the end: after a sign-in, that is when there is a User.
    tagUser(span)
    span.end()
  }
}

// An error outside every traced action: a render crash, an unhandled
// rejection. It goes out as a span of its own, with no parent.
export function reportError(error: unknown): void {
  if (tracer === null) return
  if (typeof error === 'object' && error !== null && recorded.has(error)) return
  const span = tracer.startSpan('uncaught error', { root: true })
  record(span, error)
  tagUser(span)
  span.end()
}

function record(span: Span, error: unknown): void {
  if (typeof error === 'object' && error !== null) recorded.add(error)
  span.addEvent('exception', describeError(error))
  span.setStatus({ code: SpanStatusCode.ERROR })
}

// Written out by hand, not with `recordException`, to control what goes in.
// An API error is reduced to its status: the server's own sentence can echo
// what was typed into the form.
function describeError(error: unknown): Record<string, string> {
  if (error instanceof ApiError) {
    return { 'exception.type': error.name, 'exception.message': `HTTP ${error.status}` }
  }
  if (error instanceof Error) {
    const described: Record<string, string> = {
      'exception.type': error.name,
      'exception.message': error.message,
    }
    // Script addresses only, never a page's. The origin is cut so no full
    // URL is left in it.
    if (error.stack) described['exception.stacktrace'] = error.stack.replaceAll(location.origin, '')
    return described
  }
  return { 'exception.type': typeof error, 'exception.message': String(error) }
}

function tagUser(span: Span): void {
  const id = userId()
  if (id) span.setAttribute(USER_ID, id)
}

// The User's id is the `sub` of the access token the server signed. Only that
// claim is read; the token itself never leaves this function.
function userId(): string | null {
  const token = getAccessToken()
  if (token === null) return null
  try {
    const payload: unknown = JSON.parse(
      atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')),
    )
    if (typeof payload === 'object' && payload !== null && 'sub' in payload) {
      return typeof payload.sub === 'string' ? payload.sub : null
    }
  } catch {
    // Not a token we can read; the span goes without an id.
  }
  return null
}
