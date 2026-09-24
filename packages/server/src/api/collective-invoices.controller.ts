import { Body, ConflictException, Controller, NotFoundException, Param, Post } from '@nestjs/common'
import { type IsoDate, type JobId, RuleError } from '@opengewerk/domain'

import { Database } from '../database/database.js'
import { makeCollectiveInvoice } from '../documents/collective.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { pick } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The collective invoice of a job (#135): one invoice over every open report
 * of it, one report for each day of work.
 *
 * At the job and not at a report, because it is about all of them: which
 * reports are open is the server's question, asked under a lock, and the
 * office does not pick them one by one. The right is the one a successor
 * takes, since this is how a successor of several reports is made.
 */
@Controller('jobs/:jobId/collective-invoice')
export class CollectiveInvoicesController {
  constructor(private readonly database: Database) {}

  @Post()
  @RequiresPermission('document.write')
  async make(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, ['documentDate'] as const)
    const documentDate = (values.documentDate as IsoDate | undefined) ?? todayInGermany()

    try {
      const created = await this.database.forTenant(identity, (tx) =>
        makeCollectiveInvoice(tx, identity.tenantId, jobId as JobId, documentDate),
      )

      if (!created) {
        throw new NotFoundException()
      }

      return created
    } catch (error) {
      if (error instanceof RuleError) {
        throw new ConflictException(error.message)
      }

      throw error
    }
  }
}
