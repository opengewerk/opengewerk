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
import type { CustomerId } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { customers } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

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
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(customers).where(isNull(customers.deletedAt)),
    )
  }

  @Post()
  @RequiresPermission('customer.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['kind', 'name'])

    const [created] = await this.database.forTenant(identity, (tx) =>
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
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(customers)
        .set(values as Partial<typeof customers.$inferInsert>)
        .where(and(eq(customers.id, id as CustomerId), isNull(customers.deletedAt)))
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
  @RequiresPermission('customer.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(customers)
        .set({ deletedAt: new Date() })
        .where(and(eq(customers.id, id as CustomerId), isNull(customers.deletedAt)))
        .returning(),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
