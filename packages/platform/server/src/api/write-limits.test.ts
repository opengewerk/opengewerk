import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { HttpException } from '@nestjs/common'
import { of } from 'rxjs'
import { describe, expect, it } from 'vitest'

import { identityProperty, userProperty } from './identity.js'
import { largestTransmissionBytes } from './origin.js'
import { type WriteAllowance, WriteLimitInterceptor, WriteLimits } from './write-limits.js'

/**
 * The budget of writing on its own, with a clock of the test's, and the
 * interceptor that asks it, with requests made up here: which requests it
 * counts and for how much. The application's routes ask it through the
 * module of the application, tested there.
 */

const minute = 60 * 1000
const allowance: WriteAllowance = { accountBytesPerHour: 1000, leastCountedBytes: 0 }

function limitsAt(given: Partial<WriteAllowance> = {}) {
  const clock = { now: 0 }
  const limits = new WriteLimits({ ...allowance, ...given }, () => clock.now)

  return { limits, clock }
}

/** The status a request of this size gets, 200 for one that is let through. */
function answer(limits: WriteLimits, account: string, size: number) {
  try {
    limits.admit(account, size)

    return 200
  } catch (error) {
    if (error instanceof HttpException) {
      return error.getStatus()
    }

    throw error
  }
}

describe('the budget of writing', () => {
  it('lets an account write as much as an hour allows, and nothing more', () => {
    const { limits } = limitsAt()

    expect(answer(limits, 'mia', 600)).toBe(200)
    expect(answer(limits, 'mia', 400)).toBe(200)
    expect(answer(limits, 'mia', 1)).toBe(429)
    expect(answer(limits, 'nina', 1000)).toBe(200)
  })

  it('counts nothing for a request it refuses, and lets through again what was counted an hour before', () => {
    const { limits, clock } = limitsAt()

    expect(answer(limits, 'mia', 900)).toBe(200)
    expect(answer(limits, 'mia', 200)).toBe(429)
    expect(answer(limits, 'mia', 100)).toBe(200)

    clock.now += 61 * minute

    expect(answer(limits, 'mia', 1000)).toBe(200)
  })

  it('counts a small request for the least a request counts for', () => {
    const { limits } = limitsAt({ leastCountedBytes: 300 })

    expect(answer(limits, 'mia', 1)).toBe(200)
    expect(answer(limits, 'mia', 1)).toBe(200)
    expect(answer(limits, 'mia', 1)).toBe(200)
    expect(answer(limits, 'mia', 1)).toBe(429)
  })

  it('says why it refuses', () => {
    const { limits } = limitsAt()

    limits.admit('mia', 1000)
    expect(() => limits.admit('mia', 1)).toThrow(/in der letzten Stunde schon so viel gespeichert/)
  })
})

/** A request as Express hands it on, with what the interceptor reads of it. */
function requestOf(over: {
  method?: string
  json?: boolean
  length?: string
  userId?: string
  signedIn?: string
}) {
  return {
    method: over.method ?? 'POST',
    headers: over.length === undefined ? {} : { 'content-length': over.length },
    is: (type: string) => (over.json !== false && type === 'json' ? 'json' : false),
    ...(over.userId ? { [identityProperty]: { userId: over.userId } } : {}),
    ...(over.signedIn ? { [userProperty]: { userId: over.signedIn, sessionId: 's' } } : {}),
  }
}

/** Runs one request through the interceptor; the status it gets, 200 when let through. */
function through(interceptor: WriteLimitInterceptor, request: ReturnType<typeof requestOf>) {
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
  const next: CallHandler = { handle: () => of(null) }

  try {
    interceptor.intercept(context, next)

    return 200
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : 500
  }
}

describe('the interceptor of the budget', () => {
  it('counts the JSON a request that changes something carries, for its account', () => {
    const { limits } = limitsAt()
    const interceptor = new WriteLimitInterceptor(limits)

    expect(through(interceptor, requestOf({ userId: 'mia', length: '1000' }))).toBe(200)
    expect(through(interceptor, requestOf({ method: 'PATCH', userId: 'mia', length: '1' }))).toBe(
      429,
    )
    expect(through(interceptor, requestOf({ signedIn: 'nina', length: '1000' }))).toBe(200)
    expect(through(interceptor, requestOf({ signedIn: 'nina', length: '1' }))).toBe(429)
  })

  it('leaves alone what reads, what is no JSON and what comes without an account', () => {
    const { limits } = limitsAt()
    const interceptor = new WriteLimitInterceptor(limits)

    limits.admit('mia', 1000)

    expect(through(interceptor, requestOf({ method: 'GET', userId: 'mia', length: '5' }))).toBe(200)
    expect(through(interceptor, requestOf({ json: false, userId: 'mia', length: '5' }))).toBe(200)
    expect(through(interceptor, requestOf({ length: '5000' }))).toBe(200)
    expect(through(interceptor, requestOf({ userId: 'mia', length: '5' }))).toBe(429)
  })

  it('counts a request that names no length as the largest body a route takes', () => {
    const { limits } = limitsAt({ accountBytesPerHour: largestTransmissionBytes })
    const interceptor = new WriteLimitInterceptor(limits)

    expect(through(interceptor, requestOf({ userId: 'mia' }))).toBe(200)
    expect(through(interceptor, requestOf({ userId: 'mia', length: '1' }))).toBe(429)
  })
})
