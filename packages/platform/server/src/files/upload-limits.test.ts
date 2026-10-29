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
  instanceBytesPerHour: 1_000_000,
  leastCountedBytes: 0,
  keptFreeBytes: 0,
  lastFreeBytes: 0,
  tenantMadeBytesPerHour: 1000,
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

/** The status a file the server makes is answered with, 200 for one that is let through. */
async function made(limits: UploadLimits, tenantId: TenantId, size: number) {
  try {
    await limits.admitMade(tenantId, size)

    return 200
  } catch (error) {
    if (error instanceof HttpException) {
      return error.getStatus()
    }

    throw error
  }
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

  /**
   * The hour of an account was counted per tenant of the session, and a tenant
   * is opened in a minute: one person had as many hours as tenants. It is the
   * account's hour now, in whichever tenant it stores.
   */
  it('count an account once, in whichever of its tenants it stores', async () => {
    const { limits } = limitsAt()

    expect(await answer(limits, north, 'mia', 1000)).toBe(200)
    expect(await answer(limits, south, 'mia', 1)).toBe(429)
  })

  /**
   * However many tenants and accounts there are, the instance stores no more
   * within an hour than its own budget, and stores again an hour later.
   */
  it('stop everyone together at what an hour allows the instance', async () => {
    const { limits, clock } = limitsAt({ instanceBytesPerHour: 3000 })
    const tenants = ['eins', 'zwei', 'drei', 'vier'] as TenantId[]

    expect(await answer(limits, tenants[0] as TenantId, 'anna', 1000)).toBe(200)
    expect(await answer(limits, tenants[1] as TenantId, 'bert', 1000)).toBe(200)
    expect(await answer(limits, tenants[2] as TenantId, 'carl', 1000)).toBe(200)
    expect(await answer(limits, tenants[3] as TenantId, 'dora', 1)).toBe(429)

    clock.now = 61 * minute
    expect(await answer(limits, tenants[3] as TenantId, 'dora', 1000)).toBe(200)
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

  it('let a print into the room they keep free from people, but never into the last of it', async () => {
    const { limits } = limitsAt(
      { keptFreeBytes: 5000, lastFreeBytes: 2000, tenantMadeBytesPerHour: 1_000_000 },
      5600,
    )

    expect(await answer(limits, north, 'mia', 601)).toBe(507)
    expect(await made(limits, north, 3600)).toBe(200)
    expect(await made(limits, north, 3601)).toBe(507)
  })

  it('count the prints of a tenant for that tenant, and apart from what people store', async () => {
    const { limits, clock } = limitsAt()

    expect(await made(limits, north, 1000)).toBe(200)
    expect(await made(limits, north, 1)).toBe(429)
    expect(await made(limits, south, 1000)).toBe(200)
    expect(await answer(limits, north, 'mia', 1000)).toBe(200)

    clock.now += 61 * minute

    expect(await made(limits, north, 1000)).toBe(200)
  })

  it('count a small print for the least a file counts for, and nothing for one they refuse', async () => {
    const { limits } = limitsAt({ leastCountedBytes: 300 })

    expect(await made(limits, north, 1)).toBe(200)
    expect(await made(limits, north, 1)).toBe(200)
    expect(await made(limits, north, 500)).toBe(429)
    expect(await made(limits, north, 100)).toBe(200)
    expect(await made(limits, north, 1)).toBe(429)
  })

  it('say why they refuse, in a sentence of their own for each limit', async () => {
    const { limits } = limitsAt({ keptFreeBytes: 5000, instanceBytesPerHour: 1600 }, 5600)
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
    expect(await sentence(south, 'susi', 500)).toBeNull()
    expect(await sentence(south, 'tom', 1)).toMatch(/Auf dieser Instanz/)

    const print = async (size: number) => {
      try {
        await limits.admitMade(north, size)

        return null
      } catch (error) {
        return (error as HttpException).message
      }
    }

    expect(await print(5601)).toMatch(/kein Platz mehr/)
    expect(await print(1000)).toBeNull()
    expect(await print(1)).toMatch(/Dateien erzeugt/)
  })
})
