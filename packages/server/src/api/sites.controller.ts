import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common'
import type { SiteId, Identity } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { sites } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity } from './identity.js'

const writableFields = [
  'customerId',
  'designation',
  'street',
  'houseNumber',
  'postalCode',
  'city',
  'country',
  'notes',
] as const

@Controller('sites')
export class SitesController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('site.read')
  list(@CurrentIdentity() identity: Identity) {
    return this.database.forTenant(identity.tenantId, (tx) => tx.select().from(sites))
  }

  @Post()
  @RequiresPermission('site.write')
  async create(@CurrentIdentity() identity: Identity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['customerId', 'designation'])

    const [created] = await this.database.forTenant(identity.tenantId, (tx) =>
      tx
        .insert(sites)
        .values({ ...(values as typeof sites.$inferInsert), tenantId: identity.tenantId })
        .returning(),
    )

    return created
  }

  @Patch(':id')
  @RequiresPermission('site.write')
  async update(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity.tenantId, (tx) =>
      tx
        .update(sites)
        .set({ ...(values as Partial<typeof sites.$inferInsert>), updatedAt: new Date() })
        .where(eq(sites.id, id as SiteId))
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
