import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common'
import type { CustomerId, Identity } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { customers } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity } from './identity.js'

const writableFields = [
  'kind',
  'name',
  'email',
  'phone',
  'street',
  'houseNumber',
  'postalCode',
  'city',
  'country',
  'vatId',
  'isBusiness',
  'isConstructionServiceRecipient',
  'taxExemptionCertificateNumber',
  'taxExemptionValidUntil',
  'notes',
] as const

@Controller('customers')
export class CustomersController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('customer.read')
  list(@CurrentIdentity() identity: Identity) {
    return this.database.forTenant(identity.tenantId, (tx) => tx.select().from(customers))
  }

  @Post()
  @RequiresPermission('customer.write')
  async create(@CurrentIdentity() identity: Identity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['kind', 'name'])

    const [created] = await this.database.forTenant(identity.tenantId, (tx) =>
      tx
        .insert(customers)
        // The values came through `pick`, so no column can be set that this
        // route does not offer. What is left is whether the values fit their
        // columns, and that is the database's job: enums, not null, formats.
        .values({ ...(values as typeof customers.$inferInsert), tenantId: identity.tenantId })
        .returning(),
    )

    return created
  }

  @Patch(':id')
  @RequiresPermission('customer.write')
  async update(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity.tenantId, (tx) =>
      tx
        .update(customers)
        .set({ ...(values as Partial<typeof customers.$inferInsert>), updatedAt: new Date() })
        .where(eq(customers.id, id as CustomerId))
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
