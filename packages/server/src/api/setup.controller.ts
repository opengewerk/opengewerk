import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Post,
} from '@nestjs/common'
import type { TenantId } from '@opengewerk/domain'

import type { Authentication } from '../authentication/authentication.js'
import { shortestPassword } from '../authentication/password.js'
import { instanceIsEmpty, setUpInstance } from '../authentication/setup.js'
import { PublicRoute } from './authorization.js'
import { AUTHENTICATION } from './handed-in.js'
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
 * is empty, which is a question asked of the database and not a setting.
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

  constructor(
    private readonly database: Database,
    @Inject(AUTHENTICATION) private readonly authentication: Authentication,
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
   */
  @Post()
  @PublicRoute()
  async run(@Body() body: unknown): Promise<{ tenantId: TenantId }> {
    const values = pick(body, ['company', 'name', 'email', 'password'] as const)

    requireFields(values, ['company', 'name', 'email', 'password'] as const)

    const company = text(values.company, 'company')
    const name = text(values.name, 'name')
    const email = text(values.email, 'email')
    const password = text(values.password, 'password')

    if (!email.includes('@')) {
      throw new BadRequestException('Die E-Mail-Adresse sieht nicht wie eine aus.')
    }

    if (password.length < shortestPassword) {
      throw new BadRequestException(
        `Das Passwort ist zu kurz. Mindestens ${String(shortestPassword)} Zeichen, denn dieses ` +
          'Konto wird einmal eingerichtet und jahrelang benutzt.',
      )
    }

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
}

/** A field that has to be a non empty string, said once rather than four times. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} fehlt oder ist kein Text.`)
  }

  return value.trim()
}
