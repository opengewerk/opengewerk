import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common'
import { type CustomerId, reminderGroundProblem } from '@opengewerk/domain'
import { Database, pick, requireFields, requireSomething } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { customers, customerTags } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { setTags, tagChoiceFrom } from './tag-choice.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { notRestricted } from '../privacy/customer-erasure.js'

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
  'buyerReference',
  'isBusiness',
  'isConstructionServiceRecipient',
  'taxExemptionCertificateNumber',
  'taxExemptionValidUntil',
  'reminderGround',
  'reminderGroundOn',
  'notes',
] as const

/**
 * A ground for reminders comes with its day (#316), both at once as the form
 * sends them, or neither: the one without the other is refused here with a
 * sentence, before the check of the table refuses it without one.
 */
function requireReminderGround(values: Readonly<Record<string, unknown>>): void {
  if (!('reminderGround' in values) && !('reminderGroundOn' in values)) {
    return
  }

  const problem = reminderGroundProblem(values['reminderGround'], values['reminderGroundOn'])

  if (problem !== null) {
    throw new UnprocessableEntityException(problem)
  }
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('customer.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    // Without the customers restricted on a request for deletion (#845).
    return this.database.forTenant(identity, (tx) =>
      tx
        .select()
        .from(customers)
        .where(and(isNull(customers.deletedAt), notRestricted(customers.id))),
    )
  }

  @Post()
  @RequiresPermission('customer.create')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['kind', 'name'])
    requireReminderGround(values)

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
    requireReminderGround(values)

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
   * The tags of the customer as the whole list (#314), `{ tagIds, newTags }`:
   * the tags it is to have and names for new ones, which become tags of the
   * business unless one by that name is there already.
   */
  @Put(':id/tags')
  @RequiresPermission('customer.write')
  async tag(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const choice = tagChoiceFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      const [record] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, id as CustomerId), isNull(customers.deletedAt)))
        .for('no key update')

      if (!record) {
        throw new NotFoundException()
      }

      return setTags(tx, identity.tenantId, { kind: 'customer', id: record.id }, choice)
    })
  }

  /**
   * Marked as deleted, not removed. A row that is gone is a row a device that
   * was offline never hears about, because a delta pull delivers what changed
   * and a row that is no longer there is not among it.
   */
  @Delete(':id')
  @RequiresPermission('customer.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, async (tx) => {
      const now = new Date()
      const [gone] = await tx
        .update(customers)
        .set({ deletedAt: now })
        .where(and(eq(customers.id, id as CustomerId), isNull(customers.deletedAt)))
        .returning()

      // Its tags go with it, as a deleted tag takes its assignments (#314).
      if (gone) {
        await tx
          .update(customerTags)
          .set({ deletedAt: now })
          .where(and(eq(customerTags.customerId, gone.id), isNull(customerTags.deletedAt)))
      }

      return [gone]
    })

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
