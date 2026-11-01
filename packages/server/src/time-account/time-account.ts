import {
  type AccountDay,
  accountDays,
  accountStart,
  balanceOf,
  countedUntil,
  type HolidaySetting,
  type IsoDate,
  workedByDay,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import {
  absencesBetween,
  holidaySettingOf,
  holidaysOf,
  personOfUser,
  timesOf,
} from '../absences/absences.js'
import { timeEntries } from '../database/schema/index.js'

/**
 * The time account of one person (#289, Feature-Gliederung 4.4), worked out
 * on the server because its target comes from the file, the absences and the
 * holidays, none of which travel to a device.
 *
 * The office asks for the account of somebody whose time it may read, a
 * person for their own; both by the account they sign in with, because the
 * time is recorded by it. Who has no file has no account, and the answer
 * says so.
 */

/** A stretch of an account and where the whole account stands. */
export interface TimeAccountView {
  /** Whether the account has a file in this business; without one nothing was agreed. */
  readonly hasFile: boolean
  /** The first day of the account, or null where no working time was agreed. */
  readonly startsOn: IsoDate | null
  /** The last day counted: yesterday, the day of leaving, or null before the account begins. */
  readonly countedUntil: IsoDate | null
  /** Where the business is for its holidays; null while nobody set it, and then no day is a holiday. */
  readonly state: HolidaySetting['state'] | null
  /** The balance of every day counted before the first day asked for. */
  readonly balanceBeforeMinutes: number
  /** The balance of every day counted, up to `countedUntil`. */
  readonly balanceMinutes: number
  /** Every day asked for, with its target, what was recorded and whether it counts yet. */
  readonly days: readonly AccountDay[]
}

/** The account of whoever signs in with an account, from one day to another. */
export async function accountOf(
  tx: TenantTransaction,
  userId: string,
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
): Promise<TimeAccountView> {
  const person = await personOfUser(tx, userId)
  const times = person === null ? [] : ((await timesOf(tx, [person.id])).get(person.id) ?? [])
  const startsOn = person === null ? null : accountStart(times, person.joinedOn)
  const leftOn = person?.leftOn ?? null
  const until = countedUntil(startsOn, leftOn, today)
  const setting = await holidaySettingOf(tx)
  // From the beginning of the account, for where it stands, to the later of
  // the last day asked for and the last day counted.
  const first = startsOn !== null && startsOn < from ? startsOn : from
  const last = until !== null && until > to ? until : to
  const away =
    person === null || startsOn === null ? [] : await absencesBetween(tx, [person.id], first, last)
  const entries =
    startsOn === null
      ? []
      : await tx
          .select({
            id: timeEntries.id,
            kind: timeEntries.kind,
            startedAt: timeEntries.startedAt,
            endedAt: timeEntries.endedAt,
            correctsEntryId: timeEntries.correctsEntryId,
            withdrawn: timeEntries.withdrawn,
          })
          .from(timeEntries)
          .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.deletedAt)))
  const days = accountDays({
    times,
    away,
    isHoliday: holidaysOf(setting),
    worked: workedByDay(entries),
    startsOn,
    leftOn,
    until,
    from: first,
    to: last,
  })

  return {
    hasFile: person !== null,
    startsOn,
    countedUntil: until,
    state: setting?.state ?? null,
    balanceBeforeMinutes: balanceOf(days.filter((day) => day.on < from)).balanceMinutes,
    balanceMinutes: balanceOf(days).balanceMinutes,
    days: days.filter((day) => day.on >= from && day.on <= to),
  }
}
