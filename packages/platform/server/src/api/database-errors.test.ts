import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { databaseErrors, isUniqueViolation } from './database-errors.js'

/** An error the way the driver raises it, wrapped the way Drizzle wraps it. */
function fromTheDatabase(fields: Record<string, unknown>): Error {
  return new Error('Failed query: insert into ...', { cause: Object.assign(new Error(), fields) })
}

describe('what a refusal of the database becomes', () => {
  const { answerFor } = databaseErrors({ ZZ001: 'Der Nachweis ist festgeschrieben.' })

  it('is a 403 that says nothing else when a policy refused the row', () => {
    const answer = answerFor(fromTheDatabase({ code: '42501', message: 'new row violates ...' }))

    expect(answer).toBeInstanceOf(ForbiddenException)
    // Whether the row exists in another tenant is not the caller's business.
    expect(answer.message).toBe('Kein Zugriff auf diesen Datensatz.')
  })

  it('is a 400 when the caller sent something that does not fit the model', () => {
    for (const code of ['22P02', '23502', '23503', '23505', '23514', '22007']) {
      expect(answerFor(fromTheDatabase({ code })), code).toBeInstanceOf(BadRequestException)
    }
  })

  it('is a conflict with the sentence the database raised for a class of the application', () => {
    const answer = answerFor(
      fromTheDatabase({ code: 'ZZ001', message: 'Der Nachweis 2026-0001 ist festgeschrieben.' }),
    )

    expect(answer).toBeInstanceOf(ConflictException)
    expect(answer.message).toBe('Der Nachweis 2026-0001 ist festgeschrieben.')
  })

  it('falls back to the sentence of the application when the database gave none', () => {
    const answer = answerFor(
      Object.assign(new Error('Failed query: update ...'), { code: 'ZZ001' }),
    )

    expect(answer.message).toBe('Der Nachweis ist festgeschrieben.')
  })

  it('knows the conflict every application has: an instance that is set up already', () => {
    const { answerFor: withoutAny } = databaseErrors()
    const alreadySetUp = fromTheDatabase({
      code: 'OG003',
      message: 'Diese Instanz ist bereits eingerichtet.',
    })

    expect(withoutAny(alreadySetUp)).toBeInstanceOf(ConflictException)
    expect(withoutAny(alreadySetUp).message).toBe('Diese Instanz ist bereits eingerichtet.')
    // And nothing of another application: its classes are its own.
    expect(withoutAny(fromTheDatabase({ code: 'ZZ001' })).getStatus()).toBe(500)
  })

  it('is a 413 for a body over the limit, which is not the database but lands here too', () => {
    expect(answerFor({ type: 'entity.too.large' }).getStatus()).toBe(413)
  })

  it('is a 500 without a word for anything else', () => {
    const answer = answerFor(new Error('connection terminated'))

    expect(answer.getStatus()).toBe(500)
    expect(answer.message).not.toContain('connection terminated')
  })

  it('hands back an answer that already is one', () => {
    const already = new ConflictException('Schon vergeben.')

    expect(answerFor(already)).toBe(already)
  })
})

describe('the filter', () => {
  function caught(error: unknown): { status?: number; body?: unknown } {
    const { DatabaseExceptionFilter } = databaseErrors()
    const sent: { status?: number; body?: unknown } = {}
    const response = {
      status(code: number) {
        sent.status = code

        return this
      },
      json(body: unknown) {
        sent.body = body
      },
    }
    const host = { switchToHttp: () => ({ getResponse: () => response }) }

    new DatabaseExceptionFilter().catch(error, host as never)

    return sent
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers with the translation, status and body', () => {
    const sent = caught(fromTheDatabase({ code: '42501' }))

    expect(sent.status).toBe(403)
    expect(sent.body).toMatchObject({ message: 'Kein Zugriff auf diesen Datensatz.' })
  })

  it('writes an error it does not know into the log, stack and all, and answers 500 without a word', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = new Error('connection terminated')

    const sent = caught(broken)

    expect(sent.status).toBe(500)
    expect(JSON.stringify(sent.body)).not.toContain('connection terminated')
    expect(log).toHaveBeenCalledWith('Eine Anfrage scheiterte an einem unbekannten Fehler.', broken)
  })

  it('keeps what it knows out of the log: a refusal of the database and an answer that already is one', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    caught(fromTheDatabase({ code: '42501' }))
    caught(fromTheDatabase({ code: '23502' }))
    caught(new ConflictException('Schon vergeben.'))

    expect(log).not.toHaveBeenCalled()
  })
})

describe('a unique violation', () => {
  it('is told by the index the driver names', () => {
    const error = fromTheDatabase({ code: '23505', constraint: 'probe_one_per_tenant' })

    expect(isUniqueViolation(error, 'probe_one_per_tenant')).toBe(true)
    expect(isUniqueViolation(error, 'another_index')).toBe(false)
    expect(isUniqueViolation(fromTheDatabase({ code: '23503' }), 'probe_one_per_tenant')).toBe(
      false,
    )
    expect(isUniqueViolation(undefined, 'probe_one_per_tenant')).toBe(false)
  })
})
