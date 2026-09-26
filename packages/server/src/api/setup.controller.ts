import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common'
import { businessNameProblem, type TenantId } from '@opengewerk/domain'
import type { Request } from 'express'

import type { Authentication } from '../authentication/authentication.js'
import { shortestPassword } from '../authentication/password.js'
import { instanceIsEmpty, setUpInstance } from '../authentication/setup.js'
import { normalizeSetupCode, SetupAttempts, setupCodesMatch } from '../authentication/setup-code.js'
import { PublicRoute } from './authorization.js'
import { clientAddress } from './client-address.js'
import { AUTHENTICATION, SETUP_CODE } from './handed-in.js'
import { pick, requireFields } from './body.js'
import { Database } from '../database/database.js'

/** How long a caller waits after a first run that failed before the next one. */
const restAfterFailure = 2000

/**
 * The way into an instance that has never been used.
 *
 * Public, which is exactly two routes in this application and was one until
 * now. It has to be: there is nobody to authenticate before the first account
 * exists, and that is the whole problem being solved. What keeps it from being
 * a way in for anybody else is that it answers at all only while the instance
 * is empty, which is a question asked of the database and not a setting, and
 * since #215 that it asks for the setup code from the `.env` on the server.
 * Without the code, whoever reached a freshly started instance first became
 * its owner.
 *
 * It is registered only when the instance is open. `CLOSED=true` leaves the
 * controller out of the module, so the routes are not there to be found: a
 * closed instance hands out nothing, and a setup standing open during a
 * restore would be the one exception that takes the meaning out of the switch.
 */
@Controller('setup')
export class SetupController {
  /**
   * Whether a first run is going on right now, and when the last one failed.
   *
   * A first run hashes a password with Argon2id, which is meant to be slow and
   * to want memory. On a route nobody has to sign in for, that is worth
   * holding to one at a time: a flood otherwise costs the instance a core and
   * several hundred megabytes, and costs whoever sent it nothing. One at a
   * time plus a rest after a failure turns it into a queue of one, where every
   * further request is answered by a single cheap question to the database.
   *
   * Only a failure rests. A first run that worked has closed the route behind
   * it, so there is nothing left to hold back.
   *
   * In memory and not in the database, unlike the sign in limits. Those
   * protect an instance that has accounts on it and must survive a restart;
   * this one protects an instance that has nothing on it yet, where the worst
   * a restart hands back is the right to burn a core again.
   */
  private running = false
  private lastFailure = 0

  /** The wrong setup codes of the last quarter of an hour, see `SetupAttempts`. */
  private readonly attempts = new SetupAttempts()

  constructor(
    private readonly database: Database,
    @Inject(AUTHENTICATION) private readonly authentication: Authentication,
    @Inject(SETUP_CODE) private readonly setupCode: string | null,
  ) {}

  /**
   * Whether this instance still needs setting up.
   *
   * The interface asks before it shows a sign in screen, and only when nobody
   * is signed in. It says nothing about the instance that a sign in screen
   * with no way past it would not already say.
   */
  @Get()
  @PublicRoute()
  async needed(): Promise<{ needed: boolean }> {
    return { needed: await instanceIsEmpty(this.database) }
  }

  /**
   * The first business, the first account, and the membership between them.
   *
   * The refusal for a second run comes from the database and not from the
   * check above: `create_first_tenant` takes a lock and then asks, so two
   * people who open this screen at the same moment end up with one business
   * between them. The check above is for the interface, which needs an answer
   * before it draws anything.
   *
   * The setup code is asked after the fields and before anything costs: a
   * request that is wrong in its form tells nobody anything about the code,
   * and one with a wrong code never reaches the hashing of a password.
   */
  @Post()
  @PublicRoute()
  async run(@Body() body: unknown, @Req() request: Request): Promise<{ tenantId: TenantId }> {
    const fields = ['setupCode', 'company', 'name', 'email', 'password'] as const
    const values = pick(body, fields)

    requireFields(values, fields)

    const setupCode = text(values.setupCode, 'setupCode')
    const company = text(values.company, 'company')
    const name = text(values.name, 'name')
    const email = text(values.email, 'email')
    const password = text(values.password, 'password')

    // The same rule as when the owner changes the name later (#276).
    const nameProblem = businessNameProblem(company)

    if (nameProblem !== null) {
      throw new BadRequestException(nameProblem)
    }

    if (!email.includes('@')) {
      throw new BadRequestException('Die E-Mail-Adresse sieht nicht wie eine aus.')
    }

    if (password.length < shortestPassword) {
      throw new BadRequestException(
        `Das Passwort ist zu kurz. Mindestens ${String(shortestPassword)} Zeichen, denn dieses ` +
          'Konto wird einmal eingerichtet und jahrelang benutzt.',
      )
    }

    this.admit(setupCode, clientAddress(request))

    if (this.running || Date.now() - this.lastFailure < restAfterFailure) {
      throw new ConflictException(
        'Es läuft gerade eine Einrichtung. Bitte einen Moment warten und erneut versuchen.',
      )
    }

    this.running = true

    try {
      const { tenantId } = await setUpInstance(this.authentication, this.database, {
        company,
        name,
        email,
        password,
      })

      return { tenantId }
    } catch (trouble) {
      this.lastFailure = Date.now()
      throw trouble
    } finally {
      this.running = false
    }
  }

  /**
   * Lets a first run on only with the setup code of this instance (#215).
   *
   * Nothing between asking the limit and counting a wrong code waits for
   * anything, so two requests arriving together cannot both slip under it.
   * The code itself goes nowhere: not into a message, not into the log.
   */
  private admit(given: string, address: string): void {
    const expected = normalizeSetupCode(this.setupCode ?? '')

    if (expected === '') {
      throw new ServiceUnavailableException(
        'Diese Instanz hat keinen Einrichtungscode, deshalb nimmt sie keine Einrichtung an. ' +
          '"sh docker/start.sh" auf dem Server trägt ihn unter SETUP_CODE in docker/.env ' +
          'ein und startet die Instanz neu.',
      )
    }

    if (this.attempts.refuses(address)) {
      // With a body shaped like Nest's own exceptions, so that the screen
      // reads the sentence from `message` as it does everywhere else.
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Zu viele Versuche. Bitte in einer Viertelstunde erneut versuchen.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    if (!setupCodesMatch(given, expected)) {
      this.attempts.failed(address)

      throw new ForbiddenException('Der Einrichtungscode stimmt nicht.')
    }
  }
}

/** A field that has to be a non empty string, said once rather than four times. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} fehlt oder ist kein Text.`)
  }

  return value.trim()
}
