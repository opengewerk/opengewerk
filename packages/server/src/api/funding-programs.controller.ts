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
  type FundingEvidence,
  type FundingProgramId,
  fundingProgramProblems,
} from '@opengewerk/domain'
import {
  Database,
  isUuid,
  pick,
  requireFields,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { asc, eq } from 'drizzle-orm'

import { fundingPrograms } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = ['name', 'sponsor', 'url', 'kinds', 'evidence', 'declaration'] as const

type Writable = (typeof writableFields)[number]

/** A funding programme as the office reads it. */
export type FundingProgramEntry = typeof fundingPrograms.$inferSelect

/** A text as it is kept: trimmed, and null where nothing is left; the declaration keeps its lines. */
function kept(field: Writable, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  if (value.trim() === '') {
    return null
  }

  return field === 'declaration' ? value : value.trim()
}

/** A proof as it is kept: its source and its name, trimmed, and nothing else the body brought. */
function keptEvidence(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((entry: unknown) =>
        typeof entry === 'object' && entry !== null
          ? {
              source: (entry as { source?: unknown }).source,
              label:
                typeof (entry as { label?: unknown }).label === 'string'
                  ? (entry as { label: string }).label.trim()
                  : (entry as { label?: unknown }).label,
            }
          : entry,
      )
    : value
}

/**
 * The values as they are stored, checked as a whole with what is already
 * there: a programme that asks for a declaration keeps its text, whichever of
 * the two a change sends.
 */
function checked(
  values: Partial<Record<Writable, unknown>>,
  existing: FundingProgramEntry | null,
): Partial<typeof fundingPrograms.$inferInsert> {
  const stored: Partial<Record<Writable, unknown>> = {}

  // Over the fields this route writes, never over the keys of the body.
  for (const field of writableFields) {
    if (field in values) {
      stored[field] =
        field === 'evidence' ? keptEvidence(values[field]) : kept(field, values[field])
    }
  }

  const whole: Record<string, unknown> = { ...(existing ?? {}), ...stored }

  for (const field of writableFields) {
    if (!(field in whole)) {
      whole[field] = null
    }
  }

  const [, problem] = Object.entries(fundingProgramProblems(whole))[0] ?? []

  if (problem !== undefined) {
    throw new UnprocessableEntityException(problem)
  }

  return stored as Partial<typeof fundingPrograms.$inferInsert>
}

async function one(tx: TenantTransaction, id: string): Promise<FundingProgramEntry | null> {
  if (!isUuid(id)) {
    return null
  }

  const [row] = await tx
    .select()
    .from(fundingPrograms)
    .where(eq(fundingPrograms.id, id as FundingProgramId))

  return row ?? null
}

/**
 * The funding programmes of the business as templates (#307): the owner and
 * the office keep them and put the papers of one together at an installation.
 * A programme is deleted for real: no installation names one, and the papers
 * made from it are not kept.
 */
@Controller('funding-programs')
export class FundingProgramsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('funding_program.read')
  async list(
    @CurrentIdentity() identity: RequestIdentity,
  ): Promise<readonly FundingProgramEntry[]> {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(fundingPrograms).orderBy(asc(fundingPrograms.name), asc(fundingPrograms.id)),
    )
  }

  @Get(':id')
  @RequiresPermission('funding_program.read')
  async one(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<FundingProgramEntry> {
    const row = await this.database.forTenant(identity, (tx) => one(tx, id))

    if (!row) {
      throw new NotFoundException()
    }

    return row
  }

  @Post()
  @RequiresPermission('funding_program.write')
  async create(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<FundingProgramEntry> {
    const values = pick(body, writableFields)
    requireFields(values, ['name', 'kinds', 'evidence'])

    const stored = checked(values, null)
    const [created] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(fundingPrograms)
        .values({
          ...stored,
          name: stored.name as string,
          kinds: stored.kinds as string[],
          evidence: stored.evidence as readonly FundingEvidence[],
          tenantId: identity.tenantId,
        })
        .returning(),
    )

    if (!created) {
      throw new Error('The funding programme was not written.')
    }

    return created
  }

  @Patch(':id')
  @RequiresPermission('funding_program.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<FundingProgramEntry> {
    const values = pick(body, writableFields)
    requireSomething(values)

    return this.database.forTenant(identity, async (tx) => {
      const existing = await one(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      const [updated] = await tx
        .update(fundingPrograms)
        .set({ ...checked(values, existing), updatedAt: new Date() })
        .where(eq(fundingPrograms.id, existing.id))
        .returning()

      if (!updated) {
        throw new NotFoundException()
      }

      return updated
    })
  }

  @Delete(':id')
  @RequiresPermission('funding_program.write')
  async remove(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<{ readonly removed: string }> {
    return this.database.forTenant(identity, async (tx) => {
      const existing = await one(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      await tx.delete(fundingPrograms).where(eq(fundingPrograms.id, existing.id))

      return { removed: existing.id }
    })
  }
}
