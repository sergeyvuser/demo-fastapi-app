import { describe, expect, it } from 'vitest'

import { ApiError, parseProblem, parseRetryAfter } from './problem'

// The bodies are what the API sends today, copied rather than invented.
describe('parseProblem', () => {
  it('reads a problem+json raised by the backend itself', () => {
    const problem = parseProblem(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Email already registered',
      instance: '/api/v1/auth/register',
    })

    expect(problem).toEqual({
      status: 409,
      type: 'about:blank',
      detail: 'Email already registered',
      fieldErrors: [],
    })
  })

  it('keeps the type a refusal is told apart by', () => {
    const problem = parseProblem(400, {
      type: 'urn:alerts:linked-chat:not-started',
      title: 'Bad Request',
      status: 400,
      detail: 'This chat has not started the bot',
      instance: '/api/v1/users/me/linked-chat',
    })

    expect(problem.type).toBe('urn:alerts:linked-chat:not-started')
  })

  it('leaves the type out where the body has none, which the error reads as about:blank', () => {
    const problem = parseProblem(404, { detail: 'Not Found' })

    expect(problem).not.toHaveProperty('type')
    expect(new ApiError(problem).type).toBe('about:blank')
  })

  it('reads the plain detail of a framework exception', () => {
    const problem = parseProblem(404, { detail: 'Not Found' })

    expect(problem).toEqual({ status: 404, detail: 'Not Found', fieldErrors: [] })
  })

  it('turns a validation array into field errors', () => {
    const problem = parseProblem(422, {
      detail: [
        {
          type: 'greater_than',
          loc: ['body', 'threshold'],
          msg: 'Input should be greater than 0',
          input: '-1',
          ctx: { gt: 0 },
        },
        { type: 'missing', loc: ['body'], msg: 'Field required', input: null },
      ],
    })

    expect(problem).toEqual({
      status: 422,
      detail: null,
      fieldErrors: [
        { field: 'threshold', message: 'Input should be greater than 0' },
        { field: '', message: 'Field required' },
      ],
    })
  })

  it('survives a body that is not ours', () => {
    // the edge proxy answers 502 with HTML while the API restarts
    expect(parseProblem(502, null)).toEqual({ status: 502, detail: null, fieldErrors: [] })
  })
})

describe('parseRetryAfter', () => {
  it('reads seconds, which is what the API sends', () => {
    expect(parseRetryAfter('240')).toBe(240)
  })

  it.each([
    ['absent', null],
    ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['garbage', 'soon'],
    ['negative', '-5'],
  ])('says nothing for %s', (_case, header) => {
    expect(parseRetryAfter(header)).toBeNull()
  })
})
