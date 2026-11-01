import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'
import { Database, looksLikeAToken, TRUSTED_ORIGINS } from '@opengewerk/platform-server'
import type { Response } from 'express'

import {
  calendarFor,
  endCalendar,
  type MadeCalendar,
  makeCalendar,
  type OwnCalendar,
  ownCalendar,
} from '../calendar/calendar-feeds.js'
import { PublicRoute, RequiresMembership } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The own appointments in the own calendar (#291).
 *
 * `feed` is the address of the calendar of whoever asks: whether there is one,
 * a new one, and the end of it. Every person for themselves, so membership is
 * enough, and nobody else's address can be made, seen or ended here.
 *
 * The calendar itself is public, as the far end of an invitation is: a
 * calendar on a phone fetches without a session, and what stands in for one
 * is the token in the address, 32 random bytes nobody guesses. A path of the
 * wrong shape is refused before the database is asked.
 */
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly database: Database,
    @Inject(TRUSTED_ORIGINS) private readonly origins: readonly string[],
  ) {}

  @Get('feed')
  @RequiresMembership()
  feed(@CurrentIdentity() identity: RequestIdentity): Promise<OwnCalendar> {
    return this.database.forTenant(identity, (tx) => ownCalendar(tx, identity.userId))
  }

  /** A new address, shown in this answer and never again; the one before it ends. */
  @Post('feed')
  @RequiresMembership()
  make(@CurrentIdentity() identity: RequestIdentity): Promise<MadeCalendar> {
    const origin = this.origin()

    return this.database.forTenant(identity, (tx) =>
      makeCalendar(tx, identity.tenantId, identity.userId, origin, new Date()),
    )
  }

  @Delete('feed')
  @RequiresMembership()
  @HttpCode(204)
  async end(@CurrentIdentity() identity: RequestIdentity): Promise<void> {
    await this.database.forTenant(identity, (tx) => endCalendar(tx, identity.userId, new Date()))
  }

  @Get(':file')
  @PublicRoute()
  async calendar(
    @Param('file') file: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const token = /^(.+)\.ics$/.exec(file)?.[1] ?? ''

    if (!looksLikeAToken(token)) {
      throw new NotFoundException('Diese Adresse gibt es nicht.')
    }

    const calendar = await calendarFor(this.database, token, this.origins[0] ?? '', new Date())

    if (calendar === null) {
      throw new NotFoundException('Diese Adresse gibt es nicht.')
    }

    const bytes = Buffer.from(calendar, 'utf8')

    // Fetched again on the calendar's own schedule; nothing in between keeps it.
    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(bytes, {
      type: 'text/calendar; charset=utf-8',
      disposition: 'inline; filename="termine.ics"',
      length: bytes.byteLength,
    })
  }

  /** Where the instance is reached, which the address of a calendar begins with. */
  private origin(): string {
    const origin = this.origins[0]

    if (!origin) {
      throw new ServiceUnavailableException(
        'Diese Instanz kennt ihre Adresse nicht, TRUSTED_ORIGINS ist leer. Ohne sie gibt es keine Adresse für den Kalender.',
      )
    }

    return origin
  }
}
