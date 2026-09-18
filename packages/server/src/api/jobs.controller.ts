import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common'
import type { JobId } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { jobs } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = [
  'customerId',
  'siteId',
  'installationId',
  'parentJobId',
  'kind',
  'status',
  'designation',
  'description',
] as const

@Controller('jobs')
export class JobsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('job.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) => tx.select().from(jobs))
  }

  @Post()
  @RequiresPermission('job.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['customerId', 'kind', 'designation'])

    const [created] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(jobs)
        .values({ ...(values as typeof jobs.$inferInsert), tenantId: identity.tenantId })
        .returning(),
    )

    return created
  }

  @Patch(':id')
  @RequiresPermission('job.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(jobs)
        .set({ ...(values as Partial<typeof jobs.$inferInsert>), updatedAt: new Date() })
        .where(eq(jobs.id, id as JobId))
        .returning(),
    )

    if (!updated) {
      // Either it does not exist or it belongs to somebody else. The answer is
      // the same on purpose: anything else would tell a caller which ids exist
      // in other tenants.
      throw new NotFoundException()
    }

    return updated
  }
}
