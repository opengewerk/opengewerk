import { BadRequestException } from '@nestjs/common'
import { berlinClock, type IsoDate } from '@opengewerk/platform-domain'
import { type SQL, sql } from 'drizzle-orm'

import { memberships } from '../database/schema/memberships.js'
import type { AccessRules } from './access.js'

/**
 * The last day of a membership (for opengewerk-haustechnik#339 and #356):
 * somebody who works in a tenant only up to a day, an auditor from outside
 * for one. The day in Germany, and the last day itself included.
 *
 * After it the membership counts as blocked without anybody doing anything:
 * the identity is refused on the next request and the tenant is no longer
 * offered after signing in. Nothing runs at midnight for it; every request
 * reads the day afresh, as it reads the roles.
 */

/** A membership whose last day has not passed, as a condition on its row. */
export function beforeItsEnd(): SQL {
  return sql`(${memberships.lastDay} is null or ${memberships.lastDay} >= (now() at time zone 'Europe/Berlin')::date)`
}

/** Whether a membership with this last day has ended by now. */
export function hasEnded(lastDay: string | null, now: Date = new Date()): boolean {
  return lastDay !== null && lastDay < berlinClock(now).day
}

const calendarDay = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/**
 * What a body says of the last day: undefined where it says nothing, null for
 * a membership without an end, and otherwise a day that has not passed.
 */
export function lastDayFrom(value: unknown, now: Date = new Date()): IsoDate | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  if (typeof value !== 'string' || !calendarDay(value)) {
    throw new BadRequestException('Der letzte Tag ist ein Tag wie 2026-11-30.')
  }

  if (value < berlinClock(now).day) {
    throw new BadRequestException('Der letzte Tag ist schon vorbei.')
  }

  return value as IsoDate
}

/** Refuses a role the application gives only up to a last day, given without one. */
export function refuseWithoutLastDay(
  access: Pick<AccessRules, 'endingRoles'>,
  roles: readonly string[],
  lastDay: string | null,
): void {
  if (lastDay === null && roles.some((role) => access.endingRoles?.includes(role) === true)) {
    throw new BadRequestException('Diese Rolle gibt es nur mit einem letzten Tag.')
  }
}
