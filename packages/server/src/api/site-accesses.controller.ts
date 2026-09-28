import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { accessProblem, type SiteAccessId, type SiteId } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database, type TenantTransaction } from '../database/database.js'
import { siteAccesses, siteAccessReveals, sites } from '../database/schema/index.js'
import { forgetAccessValue, keepAccessValue, readAccessValue } from '../secrets/site-access.js'
import type { SecretKey } from '../secrets/key.js'
import { RequiresPermission } from './authorization.js'
import { pick } from './body.js'
import { SECRETS } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** The fields of an access as a request sends them, the value apart from the rest. */
function accessFrom(body: unknown, creating: boolean) {
  const { designation, hint, value } = pick(body, ['designation', 'hint', 'value'] as const)

  if (creating && typeof designation !== 'string') {
    throw new BadRequestException('designation ist die Bezeichnung des Zugangs.')
  }

  for (const [name, field] of [
    ['designation', designation],
    ['hint', hint],
    ['value', value],
  ] as const) {
    if (field !== undefined && field !== null && typeof field !== 'string') {
      throw new BadRequestException(`${name} ist Text.`)
    }
  }

  const shaped = {
    designation: typeof designation === 'string' ? designation.trim() : undefined,
    hint:
      hint === undefined
        ? undefined
        : typeof hint === 'string' && hint.trim() !== ''
          ? hint.trim()
          : null,
    // An empty value keeps the one there is; it never empties it.
    value: typeof value === 'string' && value !== '' ? value : undefined,
  }

  return shaped
}

/**
 * An access that is not deleted, at a site that is not deleted either. The
 * trigger on `sites` marks the accesses of a deleted site; this asks the site
 * as well, so that no route shows or changes a way into a site that is gone
 * (Greptile on #445). `lock` holds the access until the transaction ends.
 */
async function openAccess(tx: TenantTransaction, siteId: string, id: string, lock: boolean) {
  const query = tx
    .select({ access: siteAccesses })
    .from(siteAccesses)
    .innerJoin(sites, and(eq(sites.id, siteAccesses.siteId), isNull(sites.deletedAt)))
    .where(
      and(
        eq(siteAccesses.id, id as SiteAccessId),
        eq(siteAccesses.siteId, siteId as SiteId),
        isNull(siteAccesses.deletedAt),
      ),
    )
  const [found] = lock ? await query.for('no key update', { of: siteAccesses }) : await query

  return found?.access
}

/**
 * The ways into a site (#286), kept by the office. Under `sites`, so that no
 * new prefix of the API has to be added in three places.
 *
 * None of these answers carries a value but `reveal`, which asks for it
 * explicitly and leaves a row that says who saw it and when.
 */
@Controller('sites/:siteId/accesses')
export class SiteAccessesController {
  constructor(
    private readonly database: Database,
    @Inject(SECRETS) private readonly key: SecretKey | null,
  ) {}

  private sealing(): SecretKey {
    if (!this.key) {
      throw new ServiceUnavailableException('Diese Instanz versiegelt keine Werte.')
    }

    return this.key
  }

  @Post()
  @RequiresPermission('site.access')
  async create(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ) {
    const access = accessFrom(body, true)
    const problem = accessProblem({
      designation: access.designation ?? '',
      hint: access.hint,
      value: access.value,
    })

    if (problem) {
      throw new UnprocessableEntityException(problem)
    }

    const key = access.value === undefined ? null : this.sealing()

    return this.database.forTenant(identity, async (tx) => {
      // Held until the access is written: a site deleted meanwhile would
      // otherwise miss the new access, and its value would outlive it.
      const [site] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, siteId as SiteId), isNull(sites.deletedAt)))
        .for('share')

      if (!site) {
        throw new NotFoundException()
      }

      const [created] = await tx
        .insert(siteAccesses)
        .values({
          tenantId: identity.tenantId,
          siteId: site.id,
          designation: access.designation ?? '',
          hint: access.hint ?? null,
          valueSetAt: access.value === undefined ? null : new Date(),
        })
        .returning()

      if (created && key && access.value !== undefined) {
        await keepAccessValue(tx, key, identity.tenantId, created.id, access.value)
      }

      return created
    })
  }

  @Patch(':id')
  @RequiresPermission('site.access')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const access = accessFrom(body, false)
    const key = access.value === undefined ? null : this.sealing()

    return this.database.forTenant(identity, async (tx) => {
      const existing = await openAccess(tx, siteId, id, true)

      if (!existing) {
        throw new NotFoundException()
      }

      const problem = accessProblem({
        designation: access.designation ?? existing.designation,
        hint: access.hint === undefined ? existing.hint : access.hint,
        value: access.value,
      })

      if (problem) {
        throw new UnprocessableEntityException(problem)
      }

      if (key && access.value !== undefined) {
        await keepAccessValue(tx, key, identity.tenantId, existing.id, access.value)
      }

      const [updated] = await tx
        .update(siteAccesses)
        .set({
          ...(access.designation === undefined ? {} : { designation: access.designation }),
          ...(access.hint === undefined ? {} : { hint: access.hint }),
          ...(access.value === undefined ? {} : { valueSetAt: new Date() }),
        })
        .where(eq(siteAccesses.id, existing.id))
        .returning()

      return updated
    })
  }

  /** Marked as deleted, and the sealed value forgotten at once: nothing keeps it. */
  @Delete(':id')
  @RequiresPermission('site.access')
  async remove(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.database.forTenant(identity, async (tx) => {
      const [removed] = await tx
        .update(siteAccesses)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(siteAccesses.id, id as SiteAccessId),
            eq(siteAccesses.siteId, siteId as SiteId),
            isNull(siteAccesses.deletedAt),
          ),
        )
        .returning({ id: siteAccesses.id })

      if (!removed) {
        throw new NotFoundException()
      }

      await forgetAccessValue(tx, identity.tenantId, removed.id)

      return { removed: removed.id }
    })
  }

  /**
   * The value, asked for on purpose, and a row that says who saw it and when,
   * in the same transaction: there is no answer with the value that leaves no
   * trace.
   */
  @Post(':id/reveal')
  @RequiresPermission('site.access')
  async reveal(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    const key = this.sealing()

    return this.database.forTenant(identity, async (tx) => {
      const access = await openAccess(tx, siteId, id, false)

      if (!access) {
        throw new NotFoundException()
      }

      const stored = await readAccessValue(tx, key, identity.tenantId, access.id)

      if (stored.state === 'readable') {
        await tx.insert(siteAccessReveals).values({
          tenantId: identity.tenantId,
          siteAccessId: access.id,
          // Written over by the database from the request.
          userId: identity.userId,
          revealedAt: new Date(),
          // Which value was opened, so that the log says which code was seen.
          valueSetAt: access.valueSetAt,
        })
      }

      return stored.state === 'readable'
        ? { state: 'readable' as const, value: stored.value }
        : { state: stored.state }
    })
  }
}
