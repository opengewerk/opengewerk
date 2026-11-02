import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import { addDays, isAllowed, type IsoDate } from '@opengewerk/domain'
import { Database, pick } from '@opengewerk/platform-server'

import {
  AbsenceNotFound,
  AbsenceOverlaps,
  AbsenceRefused,
  change,
  countForMe,
  countForPerson,
  decide,
  enter,
  holidayView,
  overview,
  ownYear,
  personYear,
  planning,
  planningDays,
  remove,
  requestLeave,
  setEntitlement,
  setHolidays,
  withdraw,
} from '../absences/absences.js'
import type { Notification } from '../notifications/notify.js'
import { notifyPush } from '../notifications/occasions.js'
import { todayInGermany, yearInGermany } from '../today.js'
import { RequiresMembership, RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const absenceFields = ['kind', 'firstDay', 'lastDay', 'startsAtNoon', 'endsAtNoon', 'note'] as const

/** The year a screen asks about, this one when it asks about none. */
function yearOf(value: unknown): number {
  if (value === undefined || value === '') {
    return yearInGermany()
  }

  const year = Number(value)

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException('Das Jahr ist eines zwischen 2000 und 2100.')
  }

  return year
}

/** The days of a span as a query string carries them: "true" for a half. */
function spanQuery(query: Record<string, unknown>) {
  return {
    firstDay: query['firstDay'],
    lastDay: query['lastDay'],
    startsAtNoon: query['startsAtNoon'] === 'true',
    endsAtNoon: query['endsAtNoon'] === 'true',
  }
}

/** The refusals of the rules as answers: what to change, what is not there, what is in the way. */
function answered(error: unknown): unknown {
  if (error instanceof AbsenceRefused) {
    return new BadRequestException(error.message)
  }

  if (error instanceof AbsenceNotFound) {
    return new NotFoundException()
  }

  if (error instanceof AbsenceOverlaps) {
    return new ConflictException(error.message)
  }

  return error
}

async function answering<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    throw answered(error)
  }
}

/**
 * Leave and sickness (#288, Feature-Gliederung 4.9).
 *
 * Three ways in. The office, with "Abwesenheiten pflegen": the year of the
 * business with the open requests, the year of one person, entering leave
 * and sickness, approving and turning down, the days of a year. Whoever
 * plans, with "Aufträge bearbeiten": who is away when, and why only with the
 * right to keep absences. Everybody else for themselves: their own year,
 * asking for leave and taking a request back while it is open.
 */
@Controller('absences')
export class AbsencesController {
  private readonly logger = new Logger(AbsencesController.name)

  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('absence.write')
  overview(@CurrentIdentity() identity: RequestIdentity, @Query('year') year: unknown) {
    const asked = yearOf(year)

    return this.database.forTenant(identity, (tx) => overview(tx, asked, todayInGermany()))
  }

  /**
   * Who is away from one day to another, approved absences only. The kind
   * for whoever keeps absences; for everybody else "absent", since a sickness
   * is a health datum and planning needs no more than that somebody is away.
   */
  @Get('planning')
  @RequiresPermission('job.write')
  planning(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ) {
    const day = /^\d{4}-\d{2}-\d{2}$/

    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      !day.test(from) ||
      !day.test(to) ||
      to < from
    ) {
      throw new BadRequestException(
        'Von und bis sind Tage, geschrieben 2026-10-03, bis nicht vor von.',
      )
    }

    if (addDays(from, planningDays) < to) {
      throw new BadRequestException(`Höchstens ${String(planningDays)} Tage auf einmal.`)
    }

    const seesKinds = isAllowed(identity, 'absence.write')

    return this.database.forTenant(identity, (tx) =>
      planning(tx, from as IsoDate, to as IsoDate, seesKinds),
    )
  }

  /** How a span of leave would count for whoever asks, with what is left after it. */
  @Get('mine/days')
  @RequiresMembership()
  myDays(@CurrentIdentity() identity: RequestIdentity, @Query() query: Record<string, unknown>) {
    const values = spanQuery(query)

    return answering(() =>
      this.database.forTenant(identity, (tx) => countForMe(tx, identity.userId, values)),
    )
  }

  @Get('mine')
  @RequiresMembership()
  mine(@CurrentIdentity() identity: RequestIdentity, @Query('year') year: unknown) {
    const asked = yearOf(year)

    return this.database.forTenant(identity, (tx) => ownYear(tx, identity.userId, asked))
  }

  @Post('mine')
  @RequiresMembership()
  async ask(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, absenceFields)
    const asked = await answering(() =>
      this.database.forTenant(identity, (tx) =>
        requestLeave(tx, identity.tenantId, identity.userId, values),
      ),
    )

    await this.tell(identity, { kind: 'leave_request', absenceId: asked.id })

    return asked
  }

  @Delete('mine/:id')
  @HttpCode(204)
  @RequiresMembership()
  async takeBack(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    await answering(() =>
      this.database.forTenant(identity, (tx) => withdraw(tx, identity.userId, id, new Date())),
    )
  }

  /** How a span would count for a person, before the office saves it. */
  @Get('people/:personId/days')
  @RequiresPermission('absence.write')
  days(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('personId') personId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const values = { ...spanQuery(query), kind: query['kind'] }

    return answering(() =>
      this.database.forTenant(identity, (tx) => countForPerson(tx, personId, values)),
    )
  }

  @Get('people/:personId')
  @RequiresPermission('absence.write')
  person(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('personId') personId: string,
    @Query('year') year: unknown,
  ) {
    const asked = yearOf(year)

    return answering(() =>
      this.database.forTenant(identity, (tx) => personYear(tx, personId, asked)),
    )
  }

  @Put('people/:personId/entitlements/:year')
  @RequiresPermission('absence.write')
  entitlement(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('personId') personId: string,
    @Param('year') year: string,
    @Body() body: unknown,
  ) {
    const asked = yearOf(year)
    const values = pick(body, ['entitledHalfDays', 'carriedHalfDays'] as const)

    return answering(() =>
      this.database.forTenant(identity, (tx) =>
        setEntitlement(tx, identity.tenantId, personId, asked, values),
      ),
    )
  }

  @Post()
  @RequiresPermission('absence.write')
  enter(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, ['personId', ...absenceFields] as const)

    return answering(() =>
      this.database.forTenant(identity, (tx) =>
        enter(tx, identity.tenantId, identity.userId, values, new Date()),
      ),
    )
  }

  @Patch(':id')
  @RequiresPermission('absence.write')
  change(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, [
      'firstDay',
      'lastDay',
      'startsAtNoon',
      'endsAtNoon',
      'note',
    ] as const)

    return answering(() => this.database.forTenant(identity, (tx) => change(tx, id, values)))
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresPermission('absence.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    await answering(() => this.database.forTenant(identity, (tx) => remove(tx, id, new Date())))
  }

  @Post(':id/approve')
  @RequiresPermission('absence.write')
  async approve(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const decided = await answering(() =>
      this.database.forTenant(identity, (tx) =>
        decide(tx, identity.userId, id, 'approve', null, new Date()),
      ),
    )

    await this.tell(identity, {
      kind: 'leave_decision',
      absenceId: decided.id,
      decision: 'approved',
    })

    return decided
  }

  @Post(':id/reject')
  @RequiresPermission('absence.write')
  async reject(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { answer } = pick(body, ['answer'] as const)
    const decided = await answering(() =>
      this.database.forTenant(identity, (tx) =>
        decide(tx, identity.userId, id, 'reject', answer, new Date()),
      ),
    )

    await this.tell(identity, {
      kind: 'leave_decision',
      absenceId: decided.id,
      decision: 'rejected',
    })

    return decided
  }

  /**
   * The push message of a request or a decision (#806), after it is written.
   * A message that cannot be written does not take the request back.
   */
  private async tell(identity: RequestIdentity, notification: Notification): Promise<void> {
    try {
      await notifyPush(this.database, identity.tenantId, notification, { now: new Date() })
    } catch (error) {
      // Told nobody; the request or the decision stands as it was written.
      this.logger.warn(`Eine Push-Nachricht zum Urlaub ließ sich nicht schreiben: ${String(error)}`)
    }
  }
}

/**
 * Where the business is for its public holidays (#288, Feature-Gliederung
 * 4.4), in its settings: read by whoever reads the settings, set by whoever
 * sets them. `state` looks at the holidays of another state before saving.
 */
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  read(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('year') year: unknown,
    @Query('state') state: unknown,
  ) {
    const asked = yearOf(year)

    return this.database.forTenant(identity, (tx) => holidayView(tx, asked, state))
  }

  @Put()
  @RequiresPermission('settings.write')
  set(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, ['state', 'local'] as const)

    return answering(() =>
      this.database.forTenant(identity, (tx) => setHolidays(tx, identity.tenantId, values)),
    )
  }
}
