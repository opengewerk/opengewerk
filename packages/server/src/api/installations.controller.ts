import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type InstallationId,
  inverterLinkProblem,
  pvSystemLinkProblem,
  type RecordState,
} from '@opengewerk/domain'
import {
  Database,
  pick,
  requireFields,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { installations } from '../database/schema/index.js'
import { pvLinkMisfit } from '../electrical/structure.js'
import { RequiresPermission } from './authorization.js'
import { requireReferences } from './references.js'
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
  'pvSystemId',
  'inverterId',
] as const

/**
 * Refuses a link to a PV system that does not hold (#300), with the field in
 * the sentence: the questions the sync asks, answered as a 422 like a missing
 * reference, and before the trigger in the database would answer with a
 * sentence about a constraint.
 */
async function requirePvLink(
  tx: TenantTransaction,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): Promise<void> {
  const at = (field: string) => (field in values ? values[field] : current?.[field])
  const problem =
    pvSystemLinkProblem(at('kind'), at('pvSystemId')) ??
    inverterLinkProblem(at('pvSystemId'), at('inverterId'))

  if (problem !== null) {
    throw new UnprocessableEntityException(problem)
  }

  const misfit = await pvLinkMisfit(tx, values, current)

  if (misfit === 'pvSystemId') {
    throw new UnprocessableEntityException(
      'Die Anlage aus pvSystemId ist keine PV-Anlage an diesem Objekt.',
    )
  }

  if (misfit === 'inverterId') {
    throw new UnprocessableEntityException(
      'Den Wechselrichter aus inverterId gibt es an dieser PV-Anlage nicht.',
    )
  }
}

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

    const [created] = await this.database.forTenant(identity, async (tx) => {
      await requireReferences(tx, installations, values, true)
      await requirePvLink(tx, values, null)

      return tx
        .insert(installations)
        .values({ ...(values as typeof installations.$inferInsert), tenantId: identity.tenantId })
        .returning()
    })

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

    const [updated] = await this.database.forTenant(identity, async (tx) => {
      const [current] = await tx
        .select({
          kind: installations.kind,
          siteId: installations.siteId,
          pvSystemId: installations.pvSystemId,
          inverterId: installations.inverterId,
        })
        .from(installations)
        .where(and(eq(installations.id, id as InstallationId), isNull(installations.deletedAt)))
        .for('update')

      if (!current) {
        return []
      }

      await requireReferences(tx, installations, values, false)
      await requirePvLink(tx, values, current)

      return tx
        .update(installations)
        .set(values as Partial<typeof installations.$inferInsert>)
        .where(and(eq(installations.id, id as InstallationId), isNull(installations.deletedAt)))
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
