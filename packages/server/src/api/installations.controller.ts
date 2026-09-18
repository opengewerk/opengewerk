import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common'
import type { InstallationId, Identity } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { installations } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity } from './identity.js'

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
  list(@CurrentIdentity() identity: Identity) {
    return this.database.forTenant(identity.tenantId, (tx) => tx.select().from(installations))
  }

  @Post()
  @RequiresPermission('installation.write')
  async create(@CurrentIdentity() identity: Identity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['siteId', 'kind', 'designation'])

    const [created] = await this.database.forTenant(identity.tenantId, (tx) =>
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
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity.tenantId, (tx) =>
      tx
        .update(installations)
        .set({ ...(values as Partial<typeof installations.$inferInsert>), updatedAt: new Date() })
        .where(eq(installations.id, id as InstallationId))
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
