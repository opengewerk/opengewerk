import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import { addDays, type IsoDate } from '@opengewerk/domain'
import { Database } from '@opengewerk/platform-server'

import { accountOf } from '../time-account/time-account.js'
import { todayInGermany } from '../today.js'
import { RequiresMembership, RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** The most days one answer covers: a year and a little, so that a year of months fits. */
export const accountDaysAtOnce = 400

const calendarDay = (value: unknown): value is IsoDate =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/** The stretch a screen asks about, from one day to another. */
function stretchOf(from: unknown, to: unknown): { from: IsoDate; to: IsoDate } {
  if (!calendarDay(from) || !calendarDay(to) || to < from) {
    throw new BadRequestException(
      'Von und bis sind Tage, geschrieben 2026-10-03, bis nicht vor von.',
    )
  }

  if (addDays(from, accountDaysAtOnce) < to) {
    throw new BadRequestException(`Höchstens ${String(accountDaysAtOnce)} Tage auf einmal.`)
  }

  return { from, to }
}

/**
 * The time account (#289): the target from the file, the absences and the
 * holidays against the time recorded, day by day, and where the account
 * stands. The office reads it for somebody whose time it may read, with
 * "Die Arbeitszeiten anderer ansehen" as on the screen of the week; everybody reads
 * their own. Both by the account somebody signs in with, because the time is
 * recorded by it.
 */
@Controller('time-account')
export class TimeAccountController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('time.read')
  account(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('userId') userId: unknown,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ) {
    if (typeof userId !== 'string' || userId === '') {
      throw new BadRequestException('Wessen Zeitkonto, sagt userId.')
    }

    const stretch = stretchOf(from, to)

    return this.database.forTenant(identity, (tx) =>
      accountOf(tx, userId, stretch.from, stretch.to, todayInGermany()),
    )
  }

  @Get('mine')
  @RequiresMembership()
  mine(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ) {
    const stretch = stretchOf(from, to)

    return this.database.forTenant(identity, (tx) =>
      accountOf(tx, identity.userId, stretch.from, stretch.to, todayInGermany()),
    )
  }
}
