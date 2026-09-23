import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'

import { type Colleague, listColleagues } from '../authentication/administration.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { locationConsents } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The latest answer of one person, as the screen shows it: whether consent is
 * given, and since when. No answer is no consent.
 */
async function answerOf(tx: TenantTransaction, userId: string) {
  const [latest] = await tx
    .select({ given: locationConsents.given, since: locationConsents.createdAt })
    .from(locationConsents)
    .where(eq(locationConsents.userId, userId))
    .orderBy(desc(locationConsents.id))
    .limit(1)

  return { given: latest?.given === true, since: latest?.since ?? null }
}

/**
 * Consent to recording one's place with one's working time (#76, 4.4 ⚖).
 *
 * Only one's own, read and answered by the person it is about: nobody gives
 * or withdraws it for somebody else, which is why the route knows no user in
 * its address. Every answer is a new row and none is changed, so when consent
 * was given and when it was withdrawn stays on record. A connection is needed
 * for it; the device asks for the current answer before it records a place,
 * and the server drops a place from an entry of somebody who has not
 * consented, whatever the device sent.
 */
@Controller('time')
export class TimeController {
  constructor(private readonly database: Database) {}

  @Get('consent')
  @RequiresPermission('time.write')
  consent(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) => answerOf(tx, identity.userId))
  }

  /**
   * The people of this business by name, for whoever reads the time of the
   * others. The entries name a person by key, and the keys come to a device
   * through the sync; the names live in the accounts, which never do. The same
   * list the tasks ask for, behind the right that reading time needs, so that
   * a role with one and not the other still sees names.
   */
  @Get('people')
  @RequiresPermission('time.read')
  people(@CurrentIdentity() identity: RequestIdentity): Promise<Colleague[]> {
    return listColleagues(this.database, identity)
  }

  @Put('consent')
  @RequiresPermission('time.write')
  answer(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const given = (body as { given?: unknown } | null)?.given

    if (typeof given !== 'boolean') {
      throw new BadRequestException('Die Antwort ist ja oder nein: given ist true oder false.')
    }

    return this.database.forTenant(identity, async (tx) => {
      await tx.insert(locationConsents).values({
        tenantId: identity.tenantId,
        // Written again by the trigger from the request; set here because the
        // column may not be empty when the statement is built.
        userId: identity.userId,
        given,
      })

      return answerOf(tx, identity.userId)
    })
  }
}
