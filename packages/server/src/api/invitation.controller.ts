import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common'

import type { Authentication } from '../authentication/authentication.js'
import { looksLikeAToken } from '../authentication/invitation.js'
import {
  type InvitationOffer,
  offerOf,
  type Redeemed,
  redeemInvitation,
} from '../authentication/redemption.js'
import { Database } from '../database/database.js'
import { PublicRoute } from './authorization.js'
import { AUTHENTICATION, TRUSTED_ORIGINS } from './handed-in.js'
import { pick } from './body.js'
import { refuseAForeignForm } from './origin.js'

/**
 * The far end of a one time link.
 *
 * Public, and the second pair of routes in this application that is. It has to
 * be: the person opening the link has no account yet, which is the whole point
 * of the link, so there is nobody to authenticate. What stands in for an
 * identity is the token, 32 random bytes that the office of one business made
 * and handed over, and the state of the invitation it names: used once, called
 * back, or run out, and it answers nothing.
 *
 * Registered only while the instance is open, like the first run setup and for
 * the same reason: `CLOSED=true` hands no authentication to the module, both
 * controllers are then left out, and the routes are not there to be found. A
 * way in that stayed open during a restore would take the meaning out of the
 * switch.
 *
 * There is no rest after a failure here, unlike the setup. The expensive part
 * of a first run is hashing a password, and here that part is behind a token:
 * an unknown one is refused by the shape check or by a single indexed lookup,
 * long before anything reaches a hasher. Guessing 32 random bytes is not a
 * threat to plan around.
 */
@Controller('invitation')
export class InvitationController {
  constructor(
    private readonly database: Database,
    @Inject(AUTHENTICATION) private readonly authentication: Authentication,
    @Inject(TRUSTED_ORIGINS) private readonly trustedOrigins: readonly string[],
  ) {}

  /**
   * What this link is an invitation to.
   *
   * Reading only, so that the screen can name the business and say what is
   * being asked for before anybody types anything. A link that has been used,
   * called back or has run out answers with which of the three it is: "this
   * was already used" and "this never existed" call for different sentences,
   * and only one of them is worth a second look from the person holding it.
   */
  @Get(':token')
  @PublicRoute()
  async offer(@Param('token') token: string): Promise<InvitationOffer> {
    if (!looksLikeAToken(token)) {
      // Refused before the database is asked, so that a stray character in a
      // pasted link costs a comparison instead of a query.
      throw new NotFoundException('Diesen Link gibt es nicht.')
    }

    const offer = await offerOf(this.database, token)

    if (!offer) {
      throw new NotFoundException('Diesen Link gibt es nicht.')
    }

    return offer
  }

  /**
   * Uses the link: an account with a password nobody else knows, and a place
   * in the business it was made for.
   *
   * Signing in afterwards is a separate call, exactly as it is after a first
   * run. It is the ordinary sign in, with the ordinary cookie and the ordinary
   * rate limit, and a route that handed out a session of its own would be a
   * second way in to keep right.
   */
  @Post(':token')
  @PublicRoute()
  async redeem(
    @Req() request: unknown,
    @Param('token') token: string,
    @Body() body: unknown,
  ): Promise<Redeemed> {
    refuseAForeignForm(request, this.trustedOrigins, 'Ein Einladungslink')

    if (!looksLikeAToken(token)) {
      throw new NotFoundException('Diesen Link gibt es nicht.')
    }

    const values = pick(body, ['password'] as const)
    const password = typeof values.password === 'string' ? values.password : undefined

    return redeemInvitation(this.authentication, this.database, token, password)
  }
}
