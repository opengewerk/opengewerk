import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { type ContactId, contactParentProblem, contactParentText } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { contacts } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireSomething } from './body.js'
import { requireReferences } from './references.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = [
  'customerId',
  'siteId',
  'givenName',
  'familyName',
  'role',
  'email',
  'phone',
] as const

/**
 * The one name a contact cannot do without. Null counts as missing as well:
 * the column refuses it, and a sentence about a constraint helps nobody.
 */
function requireFamilyName(values: Partial<Record<string, unknown>>): void {
  const name = values['familyName']

  if (typeof name !== 'string' || name.trim() === '') {
    throw new BadRequestException('Pflichtangaben fehlen: familyName')
  }
}

/**
 * A contact hangs on one customer or on one site, judged as it would stand
 * afterwards, and the refusal is the sentence the form shows. The sync asks
 * `contactParentProblem` the same way, and the check in the database holds
 * the same rule for every other way in.
 */
function requireOneParent(standing: { readonly customerId: unknown; readonly siteId: unknown }) {
  const problem = contactParentProblem(standing)

  if (problem) {
    throw new BadRequestException(contactParentText[problem])
  }
}

/**
 * The people to talk to at a customer or at a site (#121).
 *
 * The rights are the customer's. A contact is part of it, the way the sync
 * treats it as well: writing down who opens the door is the same act as
 * writing down whose door it is. So a technician, who may create a customer
 * on site, may create a contact there, and correcting one is for whoever may
 * correct the customer.
 *
 * Creating goes through the outbox on the screens, since it has to work
 * without a network. Changing and removing come here, because master data is
 * only corrected with a connection (ADR 0005).
 */
@Controller('contacts')
export class ContactsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('customer.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(contacts).where(isNull(contacts.deletedAt)),
    )
  }

  @Post()
  @RequiresPermission('customer.create')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFamilyName(values)
    requireOneParent({ customerId: values.customerId, siteId: values.siteId })

    const [created] = await this.database.forTenant(identity, async (tx) => {
      await requireReferences(tx, contacts, values, true)

      return tx
        .insert(contacts)
        .values({ ...(values as typeof contacts.$inferInsert), tenantId: identity.tenantId })
        .returning()
    })

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

    if ('familyName' in values) {
      requireFamilyName(values)
    }

    const [updated] = await this.database.forTenant(identity, async (tx) => {
      const [current] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id as ContactId), isNull(contacts.deletedAt)))

      if (!current) {
        return []
      }

      // Moving a contact from a customer to a site takes both fields in one
      // request, one set and one emptied. Judged field by field, the first
      // would already be refused as "both".
      requireOneParent({
        customerId: 'customerId' in values ? values.customerId : current.customerId,
        siteId: 'siteId' in values ? values.siteId : current.siteId,
      })
      await requireReferences(tx, contacts, values, false)

      return tx
        .update(contacts)
        .set(values as Partial<typeof contacts.$inferInsert>)
        .where(and(eq(contacts.id, id as ContactId), isNull(contacts.deletedAt)))
        .returning()
    })

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
        .update(contacts)
        .set({ deletedAt: new Date() })
        .where(and(eq(contacts.id, id as ContactId), isNull(contacts.deletedAt)))
        .returning(),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
