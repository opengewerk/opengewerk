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
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common'
import { addDays, isAllowed, type IsoDate } from '@opengewerk/domain'
import { Database, pick } from '@opengewerk/platform-server'

import {
  AppointmentMoved,
  type AppointmentNews,
  AppointmentNotFound,
  AppointmentRefused,
  appointmentInputOf,
  boardDays,
  boardOf,
  changeAppointment,
  confirmAppointment,
  createAppointment,
  removeAppointment,
} from '../appointments/appointments.js'
import { notifyPush } from '../notifications/occasions.js'
import { RequiresMembership, RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const calendarDay = (value: unknown): value is IsoDate =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/** The refusals as answers: what to change, what is not there, what changed in the meantime. */
function answered(error: unknown): unknown {
  if (error instanceof AppointmentRefused) {
    return new UnprocessableEntityException(error.message)
  }

  if (error instanceof AppointmentNotFound) {
    return new NotFoundException()
  }

  if (error instanceof AppointmentMoved) {
    return new ConflictException('Den Termin hat inzwischen jemand anders geändert.')
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

/** The version a board read, as a request carries it. */
function versionOf(value: unknown): number {
  const version = typeof value === 'string' ? Number(value) : value

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException('version ist die Fassung des Termins, die die Tafel kennt.')
  }

  return version
}

const appointmentFields = [
  'jobId',
  'startsAt',
  'endsAt',
  'note',
  'rrule',
  'exdates',
  'userIds',
] as const

/**
 * The appointments of the planning board (#290, Feature-Gliederung 4.3).
 *
 * Made, changed and taken back in the office with "Aufträge bearbeiten", the
 * right the board asks for; every change only for the version the board read
 * (ADR 0005, Nachtrag vom 01.11.2026). A device holds the appointments
 * through the sync and writes none. The people on one confirm it here, each
 * for themselves. Whom a change concerns hears of it by push, raised once
 * the change is written.
 */
@Controller('appointments')
export class AppointmentsController {
  private readonly logger = new Logger(AppointmentsController.name)

  constructor(private readonly database: Database) {}

  /**
   * What the board shows beside the appointments: who is away, the kind
   * only for whoever keeps absences, and the public holidays.
   */
  @Get('board')
  @RequiresPermission('job.write')
  board(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ) {
    if (!calendarDay(from) || !calendarDay(to) || to < from) {
      throw new BadRequestException(
        'Von und bis sind Tage, geschrieben 2026-10-03, bis nicht vor von.',
      )
    }

    if (addDays(from, boardDays) < to) {
      throw new BadRequestException(`Höchstens ${String(boardDays)} Tage auf einmal.`)
    }

    const seesKinds = isAllowed(identity, 'absence.write')

    return this.database.forTenant(identity, (tx) => boardOf(tx, from, to, seesKinds))
  }

  @Post()
  @RequiresPermission('job.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const { view, news } = await answering(() =>
      this.database.forTenant(identity, (tx) =>
        createAppointment(
          tx,
          identity.tenantId,
          appointmentInputOf(pick(body, appointmentFields)),
          new Date(),
        ),
      ),
    )

    await this.tell(identity, news)

    return view
  }

  /** A change, sent whole with the version the board read. */
  @Put(':id')
  @RequiresPermission('job.write')
  async change(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, [...appointmentFields, 'version'] as const)
    const version = versionOf(values.version)
    const { view, news } = await answering(() =>
      this.database.forTenant(identity, (tx) =>
        changeAppointment(
          tx,
          identity.tenantId,
          id,
          appointmentInputOf(values),
          version,
          new Date(),
        ),
      ),
    )

    await this.tell(identity, news)

    return view
  }

  /** Marked as deleted, with the people on it, so that every device learns it. */
  @Delete(':id')
  @HttpCode(204)
  @RequiresPermission('job.write')
  async remove(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Query('version') version: unknown,
  ) {
    const read = versionOf(version)
    const news = await answering(() =>
      this.database.forTenant(identity, (tx) => removeAppointment(tx, id, read, new Date())),
    )

    await this.tell(identity, news)
  }

  /** Whoever goes confirms the version of the appointment they saw. */
  @Post(':id/confirm')
  @RequiresMembership()
  confirm(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { revision } = pick(body, ['revision'] as const)

    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
      throw new BadRequestException('revision ist die Fassung des Termins, die bestätigt wird.')
    }

    return answering(() =>
      this.database.forTenant(identity, (tx) =>
        confirmAppointment(tx, identity.userId, id, revision, new Date()),
      ),
    )
  }

  /**
   * The push messages of a change, after it is written. A message that
   * cannot be written does not take the change back: the board shows it,
   * and the person sees it on the device with the next sync.
   */
  private async tell(identity: RequestIdentity, news: readonly AppointmentNews[]): Promise<void> {
    for (const item of news) {
      try {
        await notifyPush(
          this.database,
          identity.tenantId,
          { kind: 'appointment', ...item },
          { now: new Date() },
        )
      } catch (error) {
        // Told nobody; the appointment stands as it was written.
        this.logger.warn(
          `Eine Push-Nachricht zu einem Termin ließ sich nicht schreiben: ${String(error)}`,
        )
      }
    }
  }
}
