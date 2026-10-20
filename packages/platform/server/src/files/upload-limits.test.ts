import { HttpException } from '@nestjs/common'
import type { TenantId } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { FileStorage } from './store.js'
import { type UploadAllowance, UploadLimits } from './upload-limits.js'

/**
 * The limits of storing on their own, with a clock and a volume of the test's:
 * what an hour lets through, when it lets through again, what a file counts
 * for, and the room that stays free. The route that asks them is tested with
 * the files route.
 */

const north = 'north' as TenantId
const south = 'south' as TenantId
const minute = 60 * 1000

const allowance: UploadAllowance = {
  accountBytesPerHour: 1000,
  tenantBytesPerHour: 1500,
  leastCountedBytes: 0,
  keptFreeBytes: 0,
}

/** A store that keeps nothing and says how much room it has. */
function volume(free: number | null): FileStorage {
  return {
    put: () => Promise.reject(new Error('Nothing is stored here.')),
    get: () => Promise.reject(new Error('Nothing is stored here.')),
    ...(free === null ? {} : { freeBytes: () => Promise.resolve(free) }),
  }
}

function limitsAt(given: Partial<UploadAllowance> = {}, free: number | null = null) {
  const clock = { now: 0 }
  const limits = new UploadLimits(volume(free), { ...allowance, ...given }, () => clock.now)

  return { limits, clock }
}

/** The status a file of this size is answered with, 200 for one that is let through. */
async function answer(
  limits: UploadLimits,
  tenantId: TenantId,
  userId: string | null,
  size: number,
) {
  try {
    await limits.admit({ tenantId, userId }, size)

    return 200
  } catch (error) {
    if (error instanceof HttpException) {
      return error.getStatus()
    }

    throw error
  }
}

describe('the limits of storing', () => {
  it('let an account store as much as an hour allows, and nothing more', async () => {
    const { limits } = limitsAt()

    expect(await answer(limits, north, 'mia', 600)).toBe(200)
    expect(await answer(limits, north, 'mia', 400)).toBe(200)
    expect(await answer(limits, north, 'mia', 1)).toBe(429)
    expect(await answer(limits, north, 'nina', 400)).toBe(200)
  })

  it('let all of a tenant together store as much as an hour allows the tenant', async () => {
    const { limits } = limitsAt()

    expect(await answer(limits, north, 'mia', 1000)).toBe(200)
    expect(await answer(limits, north, 'nina', 500)).toBe(200)
    expect(await answer(limits, north, 'otto', 1)).toBe(429)
    expect(await answer(limits, south, 'susi', 1000)).toBe(200)
  })

  it('count a file sent without an account for its tenant', async () => {
    const { limits } = limitsAt()

    expect(await answer(limits, north, null, 1500)).toBe(200)
    expect(await answer(limits, north, 'mia', 1)).toBe(429)
  })

  it('count nothing for a file they refuse', async () => {
    const { limits } = limitsAt({ accountBytesPerHour: 800, tenantBytesPerHour: 1000 })

    expect(await answer(limits, north, 'mia', 600)).toBe(200)
    expect(await answer(limits, north, 'nina', 600)).toBe(429)
    expect(await answer(limits, north, 'nina', 400)).toBe(200)
  })

  it('let through again what has been counted more than an hour before', async () => {
    const { limits, clock } = limitsAt()

    expect(await answer(limits, north, 'mia', 1000)).toBe(200)

    clock.now = 59 * minute
    expect(await answer(limits, north, 'mia', 1)).toBe(429)

    clock.now = 61 * minute
    expect(await answer(limits, north, 'mia', 1000)).toBe(200)
  })

  it('count a small file for the least a file counts for', async () => {
    const { limits } = limitsAt({ leastCountedBytes: 300 })

    expect(await answer(limits, north, 'mia', 1)).toBe(200)
    expect(await answer(limits, north, 'mia', 1)).toBe(200)
    expect(await answer(limits, north, 'mia', 1)).toBe(200)
    expect(await answer(limits, north, 'mia', 1)).toBe(429)
  })

  it('keep the room free that they are told to, and refuse what would go below it', async () => {
    const { limits } = limitsAt({ keptFreeBytes: 5000 }, 5600)

    expect(await answer(limits, north, 'mia', 600)).toBe(200)
    expect(await answer(limits, north, 'mia', 601)).toBe(507)
  })

  it('say why they refuse, in a sentence of their own for each limit', async () => {
    const { limits } = limitsAt({ keptFreeBytes: 5000 }, 5600)
    const sentence = async (tenantId: TenantId, userId: string, size: number) => {
      try {
        await limits.admit({ tenantId, userId }, size)

        return null
      } catch (error) {
        return (error as HttpException).message
      }
    }

    expect(await sentence(north, 'mia', 601)).toMatch(/kaum noch Platz/)
    expect(await sentence(north, 'mia', 600)).toBeNull()
    expect(await sentence(north, 'mia', 500)).toMatch(/Von diesem Konto/)
    expect(await sentence(north, 'nina', 500)).toBeNull()
    expect(await sentence(north, 'otto', 500)).toMatch(/alle zusammen/)
  })
})
