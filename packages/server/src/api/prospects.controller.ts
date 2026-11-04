import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  berlinClock,
  conversionProblem,
  countryProblem,
  isAllowed,
  missingPermission,
  type Permission,
  type ProspectId,
  prospectChangeProblem,
  prospectDeletionProblem,
  prospectProblems,
  siteDesignationOf,
} from '@opengewerk/domain'
import {
  Database,
  isUuid,
  pick,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { desc, eq } from 'drizzle-orm'

import { customers, prospects, sites } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** The fields the office writes. The customer, the site and the moment come from converting. */
const writableFields = [
  'kind',
  'name',
  'concern',
  'email',
  'phone',
  'street',
  'houseNumber',
  'postalCode',
  'city',
  'country',
  'source',
  'stage',
  'lastContactOn',
] as const

type Writable = (typeof writableFields)[number]

/** A lead as the office reads it. */
export type ProspectEntry = typeof prospects.$inferSelect

/** What a new lead is unless the office says otherwise. */
function defaults(today: string): Partial<Record<Writable, unknown>> {
  return { kind: 'private', stage: 'new', country: 'DE', lastContactOn: today }
}

/** A text as it is kept: trimmed, the concern with its lines, and null where nothing is left. */
function kept(field: Writable, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  if (value.trim() === '') {
    return field === 'country' ? value : null
  }

  return field === 'concern' ? value : value.trim()
}

/**
 * The values as they are stored, checked as a whole with what is already
 * there, so a change that sends only the stage is held against the rest.
 */
function checked(
  values: Partial<Record<Writable, unknown>>,
  existing: ProspectEntry | null,
  today: string,
): Partial<typeof prospects.$inferInsert> {
  const stored: Partial<Record<Writable, unknown>> = {}

  // Over the fields this route writes, never over the keys of the body.
  for (const field of writableFields) {
    if (field in values) {
      stored[field] = kept(field, values[field])
    }
  }

  const whole: Record<string, unknown> = { ...defaults(today), ...(existing ?? {}), ...stored }
  const [, problem] = Object.entries(prospectProblems(whole, today as never))[0] ?? []

  if (problem !== undefined) {
    throw new UnprocessableEntityException(problem)
  }

  return (existing === null ? { ...defaults(today), ...stored } : stored) as Partial<
    typeof prospects.$inferInsert
  >
}

function todayInBerlin(): string {
  return berlinClock(new Date()).day
}

function requireRight(identity: RequestIdentity, permission: Permission): void {
  if (!isAllowed(identity, permission)) {
    throw new ForbiddenException(missingPermission(permission))
  }
}

async function lockedProspect(tx: TenantTransaction, id: string): Promise<ProspectEntry> {
  if (!isUuid(id)) {
    throw new NotFoundException()
  }

  const [record] = await tx
    .select()
    .from(prospects)
    .where(eq(prospects.id, id as ProspectId))
    .for('update')

  if (!record) {
    // Either it does not exist or it belongs to somebody else, the same answer on purpose.
    throw new NotFoundException()
  }

  return record
}

/** Where the site of a converted lead lies, when not at the lead's address. */
interface SiteAddress {
  readonly street: string | null
  readonly houseNumber: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly country: string
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The body of a conversion, `{ designation, address }`: what the site is
 * called, and its address when it is not the lead's. Both may be left out.
 */
function conversionFrom(body: unknown): {
  designation: string | null
  address: SiteAddress | null
} {
  const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const designation = value['designation']

  if (designation !== undefined && designation !== null && typeof designation !== 'string') {
    throw new UnprocessableEntityException('Die Bezeichnung des Objekts ist Text.')
  }

  if (typeof designation === 'string' && designation.trim().length > 200) {
    throw new UnprocessableEntityException('Eine Bezeichnung hat höchstens 200 Zeichen.')
  }

  const raw = value['address']

  if (raw === undefined || raw === null) {
    return { designation: textOrNull(designation), address: null }
  }

  if (typeof raw !== 'object') {
    throw new UnprocessableEntityException('Die Anschrift des Objekts fehlt.')
  }

  const fields = raw as Record<string, unknown>
  const country = typeof fields['country'] === 'string' ? fields['country'] : 'DE'
  const problem = countryProblem(country)

  if (problem !== null) {
    throw new UnprocessableEntityException(problem)
  }

  return {
    designation: textOrNull(designation),
    address: {
      street: textOrNull(fields['street']),
      houseNumber: textOrNull(fields['houseNumber']),
      postalCode: textOrNull(fields['postalCode']),
      city: textOrNull(fields['city']),
      country,
    },
  }
}

/**
 * The leads of the business (#312): the office records who asked, qualifies
 * them and makes a customer with a site out of one in a single step. A lead
 * that became a customer stays as it was, the record of how the customer
 * came; one that never did is deleted for real.
 */
@Controller('prospects')
export class ProspectsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('prospect.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(prospects).orderBy(desc(prospects.lastContactOn), desc(prospects.createdAt)),
    )
  }

  @Get(':id')
  @RequiresPermission('prospect.read')
  async one(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    if (!isUuid(id)) {
      throw new NotFoundException()
    }

    const [record] = await this.database.forTenant(identity, (tx) =>
      tx
        .select()
        .from(prospects)
        .where(eq(prospects.id, id as ProspectId)),
    )

    if (!record) {
      throw new NotFoundException()
    }

    return record
  }

  @Post()
  @RequiresPermission('prospect.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = checked(pick(body, writableFields), null, todayInBerlin())
    const [created] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(prospects)
        .values({ ...(values as typeof prospects.$inferInsert), tenantId: identity.tenantId })
        .returning(),
    )

    return created
  }

  @Patch(':id')
  @RequiresPermission('prospect.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)

    requireSomething(values)

    return this.database.forTenant(identity, async (tx) => {
      const existing = await lockedProspect(tx, id)
      const problem = prospectChangeProblem(existing)

      if (problem !== null) {
        throw new ConflictException(problem)
      }

      const [updated] = await tx
        .update(prospects)
        .set({ ...checked(values, existing, todayInBerlin()), updatedAt: new Date() })
        .where(eq(prospects.id, existing.id))
        .returning()

      return updated
    })
  }

  @Delete(':id')
  @RequiresPermission('prospect.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
      const existing = await lockedProspect(tx, id)
      const problem = prospectDeletionProblem(existing)

      if (problem !== null) {
        throw new ConflictException(problem)
      }

      await tx.delete(prospects).where(eq(prospects.id, existing.id))

      return { id: existing.id }
    })
  }

  /**
   * Makes a customer and a site out of a lead, in one step and without
   * typing anything again (3.1): the customer with the lead's kind, name, ways
   * to reach them, address and source; the site at the lead's address unless
   * the body names another, called by its street unless the body names it.
   * Whoever does it also creates customers and keeps sites.
   */
  @Post(':id/conversion')
  @RequiresPermission('prospect.write')
  async convert(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    requireRight(identity, 'customer.create')
    requireRight(identity, 'site.write')

    const conversion = conversionFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      const existing = await lockedProspect(tx, id)
      const problem = conversionProblem(existing)

      if (problem !== null) {
        throw new ConflictException(problem)
      }

      const [customer] = await tx
        .insert(customers)
        .values({
          tenantId: identity.tenantId,
          kind: existing.kind,
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          street: existing.street,
          houseNumber: existing.houseNumber,
          postalCode: existing.postalCode,
          city: existing.city,
          country: existing.country,
          source: existing.source,
        })
        .returning({ id: customers.id })

      if (!customer) {
        throw new Error('The customer of a converted lead was not written.')
      }

      const place = conversion.address ?? existing
      const [site] = await tx
        .insert(sites)
        .values({
          tenantId: identity.tenantId,
          customerId: customer.id,
          designation:
            conversion.designation ??
            siteDesignationOf({
              name: existing.name,
              street: place.street,
              houseNumber: place.houseNumber,
              city: place.city,
            }),
          street: place.street,
          houseNumber: place.houseNumber,
          postalCode: place.postalCode,
          city: place.city,
          country: place.country,
        })
        .returning({ id: sites.id })

      if (!site) {
        throw new Error('The site of a converted lead was not written.')
      }

      const now = new Date()
      const [converted] = await tx
        .update(prospects)
        .set({ customerId: customer.id, siteId: site.id, convertedAt: now, updatedAt: now })
        .where(eq(prospects.id, existing.id))
        .returning()

      return converted
    })
  }
}
