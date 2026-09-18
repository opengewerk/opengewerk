import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import type { SiteId } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { sites } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

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
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(sites).where(isNull(sites.deletedAt)),
    )
  }

  @Post()
  @RequiresPermission('site.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['customerId', 'designation'])

    const [created] = await this.database.forTenant(identity, (tx) =>
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
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(sites)
        .set({ ...(values as Partial<typeof sites.$inferInsert>), updatedAt: new Date() })
        .where(and(eq(sites.id, id as SiteId), isNull(sites.deletedAt)))
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

  /**
   * Marked as deleted, not removed. A row that is gone is a row a device that
   * was offline never hears about, because a delta pull delivers what changed
   * and a row that is no longer there is not among it.
   */
  @Delete(':id')
  @RequiresPermission('site.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(sites)
        .set({ deletedAt: new Date() })
        .where(and(eq(sites.id, id as SiteId), isNull(sites.deletedAt)))
        .returning(),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
