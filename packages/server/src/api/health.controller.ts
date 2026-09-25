import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common'
import type { Response } from 'express'

import { Database } from '../database/database.js'
import { PublicRoute } from './authorization.js'
import { VERSION } from './handed-in.js'

/**
 * Is this instance usable? The container runtime asks on a schedule, an
 * operator asks after a restart, and both need an answer without credentials.
 *
 * It says "usable", not "the process is alive". A server whose database is
 * gone accepts connections and fails every request, and reporting that as
 * healthy would turn a loud outage into a quiet one. The database therefore
 * decides the status code: 200 when it answers, 503 when it does not.
 *
 * What comes back is deliberately thin. Host names and driver errors would
 * tell somebody probing the instance more about it than the answer is worth,
 * and none of it helps the one question being asked. The version is the one
 * addition (#259): the sign in shows it in its foot, where anybody who can open
 * the page reads it anyway, and it is what an operator asks after an update.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: Database,
    @Inject(VERSION) private readonly version: string | null,
  ) {}

  @Get()
  @PublicRoute()
  async check(@Res({ passthrough: true }) response: Response) {
    const database = await this.database.isReachable()

    response.status(database ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)

    return { status: database ? 'bereit' : 'gestört', database, version: this.version }
  }
}
