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
  Query,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type ContractTerms,
  type CustomerId,
  type DocumentId,
  endAfterNotice,
  type InstallationId,
  type IsoDate,
  type MaintenanceContractId,
  maintenanceContractProblems,
  type RenewalKind,
  type SiteId,
} from '@opengewerk/domain'
import {
  Database,
  isUuid,
  pick,
  requireFields,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, arrayContains, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm'

import { assignNumber } from '../database/number-ranges.js'
import { documents, installations, jobs, maintenanceContracts } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The fields the office writes. The customer and the site come from the
 * quote, the number from the range, and the notice from its own route.
 */
const writableFields = [
  'designation',
  'services',
  'installationIds',
  'startsOn',
  'firstVisitOn',
  'intervalMonths',
  'termMonths',
  'renewal',
  'renewalMonths',
  'noticeMonths',
  'priceKind',
  'flatCents',
  'paymentRhythm',
  'issueByItself',
] as const

type Writable = (typeof writableFields)[number]

/** A maintenance contract as the office reads it. */
export type MaintenanceContractEntry = typeof maintenanceContracts.$inferSelect

/** A text as it is kept: the designation trimmed, the services with their lines, and null where nothing is left. */
function kept(field: Writable, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  if (value.trim() === '') {
    return null
  }

  return field === 'services' ? value : value.trim()
}

/**
 * The values as they are stored, checked as a whole with what is already
 * there: a contract that renews for a fixed time keeps its months, whichever
 * of the two a change sends, and an end after notice follows new terms.
 */
function checked(
  values: Partial<Record<Writable, unknown>>,
  existing: MaintenanceContractEntry | null,
): Partial<typeof maintenanceContracts.$inferInsert> {
  const stored: Partial<Record<Writable, unknown>> = {}

  // Over the fields this route writes, never over the keys of the body.
  for (const field of writableFields) {
    if (field in values) {
      stored[field] = kept(field, values[field])
    }
  }

  // A contract that stops renewing for a fixed time has no months of renewal,
  // and one at effort no flat price, unless the body said otherwise.
  if ('renewal' in stored && stored['renewal'] !== 'fixed' && !('renewalMonths' in stored)) {
    stored['renewalMonths'] = null
  }

  if ('priceKind' in stored && stored['priceKind'] !== 'flat' && !('flatCents' in stored)) {
    stored['flatCents'] = null
  }

  // Paid per maintenance again, nothing goes out by itself.
  if (stored['paymentRhythm'] === 'visit' && !('issueByItself' in stored)) {
    stored['issueByItself'] = false
  }

  const whole: Record<string, unknown> = {
    installationIds: [],
    paymentRhythm: 'visit',
    issueByItself: false,
    ...(existing ?? {}),
    ...stored,
  }

  for (const field of writableFields) {
    if (!(field in whole)) {
      whole[field] = null
    }
  }

  const [, problem] = Object.entries(maintenanceContractProblems(whole))[0] ?? []

  if (problem !== undefined) {
    throw new UnprocessableEntityException(problem)
  }

  const result = stored as Partial<typeof maintenanceContracts.$inferInsert>

  if (existing !== null && existing.cancelledOn !== null) {
    return {
      ...result,
      endsOn: endAfterNotice(termsOf(whole), existing.cancelledOn as IsoDate),
    }
  }

  return result
}

function termsOf(contract: Readonly<Record<string, unknown>>): ContractTerms {
  return {
    startsOn: contract['startsOn'] as IsoDate,
    termMonths: contract['termMonths'] as number,
    renewal: contract['renewal'] as RenewalKind,
    renewalMonths: (contract['renewalMonths'] as number | null) ?? null,
    noticeMonths: contract['noticeMonths'] as number,
  }
}

async function one(tx: TenantTransaction, id: string): Promise<MaintenanceContractEntry | null> {
  if (!isUuid(id)) {
    return null
  }

  const [row] = await tx
    .select()
    .from(maintenanceContracts)
    .where(eq(maintenanceContracts.id, id as MaintenanceContractId))

  return row ?? null
}

/**
 * The installations of a contract are the site's, each once and not
 * removed: the list is checked against what the business sees, so an
 * installation of another business, or of another site, is refused.
 */
async function checkInstallations(
  tx: TenantTransaction,
  ids: readonly string[],
  siteId: string | null,
): Promise<void> {
  if (ids.length === 0) {
    return
  }

  if (siteId === null || !ids.every((id) => isUuid(id))) {
    throw new UnprocessableEntityException('Die Anlagen eines Vertrags sind die seines Objekts.')
  }

  const found = await tx
    .select({ id: installations.id })
    .from(installations)
    .where(
      and(
        inArray(installations.id, ids as InstallationId[]),
        eq(installations.siteId, siteId as SiteId),
        isNull(installations.deletedAt),
      ),
    )

  if (found.length !== new Set(ids).size) {
    throw new UnprocessableEntityException('Die Anlagen eines Vertrags sind die seines Objekts.')
  }
}

/** The day a notice came in, read from the body. */
function receivedOn(body: unknown): IsoDate {
  const value = (body as { receivedOn?: unknown } | null)?.receivedOn

  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new UnprocessableEntityException('Der Tag, an dem die Kündigung kam, fehlt.')
  }

  return value as IsoDate
}

/**
 * The maintenance contracts of the business (#294): the owner and the office
 * make one out of an issued quote, change it, enter a notice and take it
 * back, and see them at a customer, a site and an installation. Reading
 * needs what reading a document needs. Writing needs what issuing one
 * needs: a contract binds the business for years like an issued document,
 * and a technician, who writes reports, makes none.
 */
@Controller('maintenance-contracts')
export class MaintenanceContractsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('document.read')
  async list(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('customerId') customerId?: string,
    @Query('siteId') siteId?: string,
    @Query('installationId') installationId?: string,
    @Query('quoteId') quoteId?: string,
  ): Promise<readonly MaintenanceContractEntry[]> {
    const filters: SQL[] = []

    for (const [value, condition] of [
      [customerId, (id: string) => eq(maintenanceContracts.customerId, id as CustomerId)],
      [siteId, (id: string) => eq(maintenanceContracts.siteId, id as SiteId)],
      [installationId, (id: string) => arrayContains(maintenanceContracts.installationIds, [id])],
      [quoteId, (id: string) => eq(maintenanceContracts.quoteId, id as DocumentId)],
    ] as const) {
      if (value !== undefined) {
        if (!isUuid(value)) {
          return []
        }

        filters.push(condition(value))
      }
    }

    return this.database.forTenant(identity, (tx) =>
      tx
        .select()
        .from(maintenanceContracts)
        .where(and(...filters))
        .orderBy(asc(maintenanceContracts.number), asc(maintenanceContracts.id)),
    )
  }

  @Get(':id')
  @RequiresPermission('document.read')
  async one(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<MaintenanceContractEntry> {
    const row = await this.database.forTenant(identity, (tx) => one(tx, id))

    if (!row) {
      throw new NotFoundException()
    }

    return row
  }

  /**
   * A contract out of an issued quote: its customer and site are the
   * quote's, its number the next of the range `contract`. One per quote.
   */
  @Post()
  @RequiresPermission('document.issue')
  async create(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<MaintenanceContractEntry> {
    const quoteId = (body as { quoteId?: unknown } | null)?.quoteId
    const values = pick(body, writableFields)
    requireFields(values, [
      'designation',
      'startsOn',
      'firstVisitOn',
      'intervalMonths',
      'termMonths',
      'renewal',
      'noticeMonths',
      'priceKind',
    ])

    const stored = checked(values, null)

    return this.database.forTenant(identity, async (tx) => {
      const [quote] =
        typeof quoteId === 'string' && isUuid(quoteId)
          ? await tx
              .select({
                id: documents.id,
                kind: documents.kind,
                status: documents.status,
                customerId: documents.customerId,
                siteId: documents.siteId,
              })
              .from(documents)
              .where(eq(documents.id, quoteId as DocumentId))
          : []

      if (!quote || quote.kind !== 'quote' || quote.status !== 'issued') {
        throw new UnprocessableEntityException(
          'Ein Wartungsvertrag entsteht aus einem festgeschriebenen Angebot.',
        )
      }

      const [taken] = await tx
        .select({ number: maintenanceContracts.number })
        .from(maintenanceContracts)
        .where(eq(maintenanceContracts.quoteId, quote.id))

      if (taken) {
        throw new ConflictException(
          `Aus diesem Angebot ist schon der Wartungsvertrag ${taken.number} entstanden.`,
        )
      }

      await checkInstallations(
        tx,
        (stored.installationIds as string[] | undefined) ?? [],
        quote.siteId,
      )

      const [created] = await tx
        .insert(maintenanceContracts)
        .values({
          ...stored,
          tenantId: identity.tenantId,
          number: await assignNumber(tx, identity.tenantId, 'contract', new Date()),
          designation: stored.designation as string,
          customerId: quote.customerId,
          siteId: quote.siteId,
          quoteId: quote.id,
          startsOn: stored.startsOn as string,
          firstVisitOn: stored.firstVisitOn as string,
          intervalMonths: stored.intervalMonths as number,
          termMonths: stored.termMonths as number,
          renewal: stored.renewal as string,
          noticeMonths: stored.noticeMonths as number,
          priceKind: stored.priceKind as string,
        })
        .returning()

      if (!created) {
        throw new Error('The maintenance contract was not written.')
      }

      return created
    })
  }

  @Patch(':id')
  @RequiresPermission('document.issue')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MaintenanceContractEntry> {
    const values = pick(body, writableFields)
    requireSomething(values)

    return this.database.forTenant(identity, async (tx) => {
      const existing = await one(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      const stored = checked(values, existing)

      if (stored.installationIds !== undefined) {
        await checkInstallations(tx, stored.installationIds, existing.siteId)
      }

      const [updated] = await tx
        .update(maintenanceContracts)
        .set({ ...stored, updatedAt: new Date() })
        .where(eq(maintenanceContracts.id, existing.id))
        .returning()

      if (!updated) {
        throw new NotFoundException()
      }

      return updated
    })
  }

  /**
   * A notice that came in: the contract ends with the term the notice was
   * still in time for, and no maintenance after that day is made.
   */
  @Post(':id/notice')
  @RequiresPermission('document.issue')
  async notice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MaintenanceContractEntry> {
    const on = receivedOn(body)

    return this.database.forTenant(identity, async (tx) => {
      const existing = await one(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      if (existing.cancelledOn !== null) {
        throw new ConflictException('Der Vertrag ist schon gekündigt.')
      }

      const [updated] = await tx
        .update(maintenanceContracts)
        .set({
          cancelledOn: on,
          endsOn: endAfterNotice(termsOf(existing), on),
          updatedAt: new Date(),
        })
        .where(eq(maintenanceContracts.id, existing.id))
        .returning()

      if (!updated) {
        throw new NotFoundException()
      }

      return updated
    })
  }

  /** A notice taken back, entered by mistake or withdrawn by agreement: the contract runs on. */
  @Delete(':id/notice')
  @RequiresPermission('document.issue')
  async withdrawNotice(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<MaintenanceContractEntry> {
    return this.database.forTenant(identity, async (tx) => {
      const existing = await one(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      const [updated] = await tx
        .update(maintenanceContracts)
        .set({ cancelledOn: null, endsOn: null, updatedAt: new Date() })
        .where(eq(maintenanceContracts.id, existing.id))
        .returning()

      if (!updated) {
        throw new NotFoundException()
      }

      return updated
    })
  }

  /**
   * A contract entered by mistake: deleted for real while no service job
   * names it. Once a maintenance was made, it stays and is given notice.
   */
  @Delete(':id')
  @RequiresPermission('document.issue')
  async remove(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<{ readonly removed: string }> {
    return this.database.forTenant(identity, async (tx) => {
      const existing = await one(tx, id)

      if (!existing) {
        throw new NotFoundException()
      }

      const [made] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.maintenanceContractId, existing.id))
        .limit(1)

      if (made) {
        throw new ConflictException(
          'Zu diesem Vertrag gibt es schon einen Serviceauftrag. Er bleibt und lässt sich kündigen.',
        )
      }

      await tx.delete(maintenanceContracts).where(eq(maintenanceContracts.id, existing.id))

      return { removed: existing.id }
    })
  }
}
