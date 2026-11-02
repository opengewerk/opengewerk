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
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type GridOperatorId,
  gridOperatorProblems,
  type InstallationKind,
} from '@opengewerk/domain'
import {
  Database,
  isUuid,
  pick,
  requireFields,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, count, eq, isNull } from 'drizzle-orm'

import { customers, gridOperators, installations, sites } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = [
  'name',
  'portalUrl',
  'requirements',
  'contactName',
  'contactEmail',
  'contactPhone',
  'registrationNumber',
  'registeredUntil',
  'responsibleElectrician',
] as const

type Writable = (typeof writableFields)[number]

/** A grid operator as the list shows it, with how many installations name it. */
export interface GridOperatorEntry extends Omit<typeof gridOperators.$inferSelect, 'deletedAt'> {
  readonly installations: number
}

/** An installation that names a grid operator, as the page of the operator lists it. */
export interface GridOperatorInstallation {
  readonly id: string
  readonly kind: InstallationKind
  readonly designation: string
  readonly site: string
  readonly customer: string
  readonly reference: string | null
}

/**
 * The values as they are stored: a name trimmed, an empty text null, the rest
 * as sent. Checked as a whole with what is already there, so that a last day
 * is not kept for an entry whose number was just taken out.
 */
function checked(
  values: Partial<Record<Writable, unknown>>,
  existing: typeof gridOperators.$inferSelect | null,
): Partial<typeof gridOperators.$inferInsert> {
  const stored: Partial<Record<Writable, unknown>> = {}

  // Over the fields this route writes, never over the keys of the body.
  for (const field of writableFields) {
    if (!(field in values)) {
      continue
    }

    const value = values[field]

    stored[field] =
      typeof value === 'string'
        ? field === 'requirements'
          ? value.trim() === ''
            ? null
            : value
          : value.trim() === ''
            ? null
            : value.trim()
        : value
  }

  const whole: Record<string, unknown> = { ...(existing ?? {}), ...stored }

  if (!('registrationNumber' in whole)) {
    whole['registrationNumber'] = null
  }

  // Judged with what stays, so that a date and a number taken apart are refused.
  const problems = gridOperatorProblems(whole)
  const [field, problem] = Object.entries(problems)[0] ?? []

  if (field !== undefined && problem !== undefined) {
    throw new UnprocessableEntityException(problem)
  }

  return stored as Partial<typeof gridOperators.$inferInsert>
}

async function living(
  tx: TenantTransaction,
  id: string,
): Promise<typeof gridOperators.$inferSelect | null> {
  if (!isUuid(id)) {
    return null
  }

  const [row] = await tx
    .select()
    .from(gridOperators)
    .where(and(eq(gridOperators.id, id as GridOperatorId), isNull(gridOperators.deletedAt)))

  return row ?? null
}

function entry(
  row: typeof gridOperators.$inferSelect,
  installationCount: number,
): GridOperatorEntry {
  const { deletedAt: _deleted, ...rest } = row

  return { ...rest, installations: installationCount }
}

/**
 * The grid operators of the business and its entry in their installer
 * directories (#306): the owner and the office keep them, as with the
 * suppliers. A grid operator is removed by marking it, and not while a living
 * installation names it: the papers of that installation would lose who they
 * go to.
 */
@Controller('grid-operators')
export class GridOperatorsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('grid_operator.read')
  async list(@CurrentIdentity() identity: RequestIdentity): Promise<readonly GridOperatorEntry[]> {
    return this.database.forTenant(identity, async (tx) => {
      const rows = await tx
        .select()
        .from(gridOperators)
        .where(isNull(gridOperators.deletedAt))
        .orderBy(asc(gridOperators.name), asc(gridOperators.id))
      const counted = await tx
        .select({ id: installations.gridOperatorId, installations: count() })
        .from(installations)
        .where(isNull(installations.deletedAt))
        .groupBy(installations.gridOperatorId)
      const byOperator = new Map(counted.map((row) => [row.id, row.installations]))

      return rows.map((row) => entry(row, byOperator.get(row.id) ?? 0))
    })
  }

  @Get(':id')
  @RequiresPermission('grid_operator.read')
  async one(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<GridOperatorEntry & { readonly named: readonly GridOperatorInstallation[] }> {
    return this.database.forTenant(identity, async (tx) => {
      const row = await living(tx, id)

      if (!row) {
        throw new NotFoundException()
      }

      const named = await tx
        .select({
          id: installations.id,
          kind: installations.kind,
          designation: installations.designation,
          site: sites.designation,
          customer: customers.name,
          reference: installations.gridOperatorReference,
        })
        .from(installations)
        .innerJoin(sites, eq(sites.id, installations.siteId))
        .innerJoin(customers, eq(customers.id, sites.customerId))
        .where(and(eq(installations.gridOperatorId, row.id), isNull(installations.deletedAt)))
        .orderBy(asc(installations.designation), asc(installations.id))

      return { ...entry(row, named.length), named }
    })
  }

  @Post()
  @RequiresPermission('grid_operator.write')
  async create(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<GridOperatorEntry> {
    const values = pick(body, writableFields)
    requireFields(values, ['name'])

    const stored = checked(values, null)
    const [created] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(gridOperators)
        .values({ ...stored, name: stored.name as string, tenantId: identity.tenantId })
        .returning(),
    )

    if (!created) {
      throw new Error('The grid operator was not written.')
    }

    return entry(created, 0)
  }

  @Patch(':id')
  @RequiresPermission('grid_operator.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GridOperatorEntry> {
    const values = pick(body, writableFields)
    requireSomething(values)

    return this.database.forTenant(identity, async (tx) => {
      const existing = await living(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      const [updated] = await tx
        .update(gridOperators)
        .set({ ...checked(values, existing), updatedAt: new Date() })
        .where(eq(gridOperators.id, existing.id))
        .returning()

      if (!updated) {
        throw new NotFoundException()
      }

      const [named] = await tx
        .select({ installations: count() })
        .from(installations)
        .where(and(eq(installations.gridOperatorId, updated.id), isNull(installations.deletedAt)))

      return entry(updated, named?.installations ?? 0)
    })
  }

  /**
   * Marked as removed, and refused while a living installation names it. An
   * installation deleted long ago may go on naming it: the row stays.
   */
  @Delete(':id')
  @RequiresPermission('grid_operator.write')
  async remove(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<{ readonly removed: string }> {
    return this.database.forTenant(identity, async (tx) => {
      const existing = await living(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      const [named] = await tx
        .select({ installations: count() })
        .from(installations)
        .where(and(eq(installations.gridOperatorId, existing.id), isNull(installations.deletedAt)))
      const naming = named?.installations ?? 0

      if (naming > 0) {
        throw new ConflictException(
          naming === 1
            ? 'Eine Anlage nennt diesen Netzbetreiber. Solange sie ihn nennt, lässt er sich nicht entfernen.'
            : `${String(naming)} Anlagen nennen diesen Netzbetreiber. Solange sie ihn nennen, lässt er sich nicht entfernen.`,
        )
      }

      await tx
        .update(gridOperators)
        .set({ deletedAt: new Date() })
        .where(eq(gridOperators.id, existing.id))

      return { removed: existing.id }
    })
  }
}
