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
import type { InstallationId } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { installations } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = [
  'siteId',
  'kind',
  'designation',
  'manufacturer',
  'model',
  'serialNumber',
  'commissionedOn',
  'warrantyEndsOn',
  'notes',
] as const

@Controller('installations')
export class InstallationsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('installation.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(installations).where(isNull(installations.deletedAt)),
    )
  }

  @Post()
  @RequiresPermission('installation.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['siteId', 'kind', 'designation'])

    const [created] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(installations)
        .values({ ...(values as typeof installations.$inferInsert), tenantId: identity.tenantId })
        .returning(),
    )

    return created
  }

  @Patch(':id')
  @RequiresPermission('installation.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(installations)
        .set(values as Partial<typeof installations.$inferInsert>)
        .where(and(eq(installations.id, id as InstallationId), isNull(installations.deletedAt)))
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
  @RequiresPermission('installation.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(installations)
        .set({ deletedAt: new Date() })
        .where(and(eq(installations.id, id as InstallationId), isNull(installations.deletedAt)))
        .returning(),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
