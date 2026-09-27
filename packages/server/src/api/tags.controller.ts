import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import type { TagId } from '@opengewerk/domain'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { Database } from '../database/database.js'
import { customerTags, siteTags, tags } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { tagNameFrom } from './tag-choice.js'

/**
 * Refuses a name another tag of the business carries already, whatever its
 * case, with the name as it stands there: "Wallbox" when somebody typed
 * "wallbox". The index holds the same rule behind this for a request that
 * slips in between.
 */
async function refuseTaken(tx: TenantTransaction, name: string, except?: TagId): Promise<void> {
  const [taken] = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(sql`lower(${tags.name}) = lower(${name})`, isNull(tags.deletedAt)))

  if (taken && taken.id !== except) {
    throw new ConflictException(`Den Tag „${taken.name}“ gibt es schon.`)
  }
}

/**
 * The tags of the business (#314), under `customers` as the text snippets are
 * under `documents`: they are part of keeping customers and sites, they carry
 * the right to change customers, and they stay inside a prefix the browser
 * sends to the server already, where a new one would have to be added in
 * three places.
 *
 * A device holds the tags through the sync and never writes one. This is
 * where they are made, renamed and deleted; putting them on a customer or a
 * site is the route of that record.
 */
@Controller('customers/tags')
export class TagsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('customer.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx
        .select()
        .from(tags)
        .where(isNull(tags.deletedAt))
        .orderBy(asc(sql`lower(${tags.name})`), asc(tags.id)),
    )
  }

  @Post()
  @RequiresPermission('customer.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const name = tagNameFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      await refuseTaken(tx, name)

      const [created] = await tx
        .insert(tags)
        .values({ tenantId: identity.tenantId, name })
        .returning()

      return created
    })
  }

  /** A new name, and every customer and site that has the tag shows it. */
  @Patch(':id')
  @RequiresPermission('customer.write')
  async rename(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const name = tagNameFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      const [existing] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.id, id as TagId), isNull(tags.deletedAt)))

      if (!existing) {
        throw new NotFoundException()
      }

      await refuseTaken(tx, name, existing.id)

      const [renamed] = await tx
        .update(tags)
        .set({ name })
        .where(eq(tags.id, existing.id))
        .returning()

      return renamed
    })
  }

  /**
   * Marked as deleted, and with it every customer and site that had it, in
   * one transaction: a delta pull delivers what changed, and a row that is
   * gone is not among it. A tag of the same name can be made again at once.
   */
  @Delete(':id')
  @RequiresPermission('customer.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
      const now = new Date()
      const [removed] = await tx
        .update(tags)
        .set({ deletedAt: now })
        .where(and(eq(tags.id, id as TagId), isNull(tags.deletedAt)))
        .returning({ id: tags.id })

      if (!removed) {
        throw new NotFoundException()
      }

      await tx
        .update(customerTags)
        .set({ deletedAt: now })
        .where(and(eq(customerTags.tagId, removed.id), isNull(customerTags.deletedAt)))
      await tx
        .update(siteTags)
        .set({ deletedAt: now })
        .where(and(eq(siteTags.tagId, removed.id), isNull(siteTags.deletedAt)))

      return { removed: removed.id }
    })
  }
}
