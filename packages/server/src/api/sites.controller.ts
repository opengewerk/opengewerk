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
} from '@nestjs/common'
import type { SiteId } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { sites, siteTags } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { setTags, tagChoiceFrom } from './tag-choice.js'
import { pick, requireFields, requireSomething } from './body.js'
import { requireReferences } from './references.js'
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

    const [created] = await this.database.forTenant(identity, async (tx) => {
      await requireReferences(tx, sites, values, true)

      return tx
        .insert(sites)
        .values({ ...(values as typeof sites.$inferInsert), tenantId: identity.tenantId })
        .returning()
    })

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

    const [updated] = await this.database.forTenant(identity, async (tx) => {
      await requireReferences(tx, sites, values, false)

      return tx
        .update(sites)
        .set(values as Partial<typeof sites.$inferInsert>)
        .where(and(eq(sites.id, id as SiteId), isNull(sites.deletedAt)))
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
   * The tags of the site as the whole list (#314), `{ tagIds, newTags }`:
   * the tags it is to have and names for new ones, which become tags of the
   * business unless one by that name is there already.
   */
  @Put(':id/tags')
  @RequiresPermission('site.write')
  async tag(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const choice = tagChoiceFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      const [record] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, id as SiteId), isNull(sites.deletedAt)))
        .for('no key update')

      if (!record) {
        throw new NotFoundException()
      }

      return setTags(tx, identity.tenantId, { kind: 'site', id: record.id }, choice)
    })
  }

  /**
   * Marked as deleted, not removed. A row that is gone is a row a device that
   * was offline never hears about, because a delta pull delivers what changed
   * and a row that is no longer there is not among it.
   */
  @Delete(':id')
  @RequiresPermission('site.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, async (tx) => {
      const now = new Date()
      const [gone] = await tx
        .update(sites)
        .set({ deletedAt: now })
        .where(and(eq(sites.id, id as SiteId), isNull(sites.deletedAt)))
        .returning()

      // Its tags go with it, as a deleted tag takes its assignments (#314).
      if (gone) {
        await tx
          .update(siteTags)
          .set({ deletedAt: now })
          .where(and(eq(siteTags.siteId, gone.id), isNull(siteTags.deletedAt)))
      }

      return [gone]
    })

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
