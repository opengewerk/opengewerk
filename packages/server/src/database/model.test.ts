import type { CustomerId, SiteId } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from './identifier.js'
import * as schema from './schema/index.js'
import { applyMigrations, connect, resetSchema } from './test-database.js'

let pool: Pool
let db: NodePgDatabase

beforeAll(async () => {
  pool = await connect()
  await resetSchema(pool)
  await applyMigrations(pool)
  db = drizzle(pool)
})

afterAll(async () => {
  await pool.end()
})

async function createTenant(name: string) {
  const [tenant] = await db.insert(schema.tenants).values({ name }).returning()

  if (!tenant) {
    throw new Error('The insert returned no tenant')
  }

  return tenant
}

/**
 * Runs a write that the database has to refuse, and says why it refused.
 * Drizzle wraps the driver error in one that only repeats the query, so the
 * code and the constraint name have to be read from the cause. Checking both
 * matters: a test that only asserts "it threw" would still pass if the row
 * were rejected for an entirely different reason, such as a typo in a column.
 */
async function refusedBy(write: Promise<unknown>): Promise<{ code: string; constraint: string }> {
  try {
    await write
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause

    return { code: cause?.code ?? 'unknown', constraint: cause?.constraint ?? 'unknown' }
  }

  throw new Error('The database accepted a row that it should have refused')
}

/** integrity_constraint_violation, check_violation. */
const checkViolation = '23514'
/** integrity_constraint_violation, foreign_key_violation. */
const foreignKeyViolation = '23503'

describe('a property management company with forty buildings', () => {
  it('is one customer with forty sites, each with its own system and history', async () => {
    const tenant = await createTenant('Elektro Muster GmbH')

    const customerId = newId<'customer'>()
    await db.insert(schema.customers).values({
      id: customerId,
      tenantId: tenant.id,
      kind: 'property_management',
      name: 'Hausverwaltung Neckar GmbH',
      city: 'Heidelberg',
      isBusiness: true,
    })

    // The ids are made here, not by the database: this is what a technician
    // offline does as well, and it lets the whole tree be written in one go.
    const siteIds: SiteId[] = Array.from({ length: 40 }, () => newId<'site'>())

    await db.insert(schema.sites).values(
      siteIds.map((id, index) => ({
        id,
        tenantId: tenant.id,
        customerId,
        designation: `Liegenschaft ${index + 1}`,
        street: 'Hauptstraße',
        houseNumber: String(index + 1),
        postalCode: '69117',
        city: 'Heidelberg',
      })),
    )

    await db.insert(schema.installations).values(
      siteIds.map((siteId, index) => ({
        tenantId: tenant.id,
        siteId,
        kind: 'meter_cabinet' as const,
        designation: `Zählerschrank Haus ${index + 1}`,
      })),
    )

    // One building gets a history of its own: a service call and the invoice
    // that came out of it.
    const firstSite = siteIds[0]
    const otherSite = siteIds[1]
    if (!firstSite || !otherSite) {
      throw new Error('The test needs at least two sites')
    }

    const [job] = await db
      .insert(schema.jobs)
      .values({
        tenantId: tenant.id,
        customerId,
        siteId: firstSite,
        kind: 'service',
        status: 'completed',
        designation: 'Störung Treppenhauslicht',
      })
      .returning()

    await db.insert(schema.documents).values({
      tenantId: tenant.id,
      customerId,
      jobId: job?.id ?? null,
      siteId: firstSite,
      kind: 'final_invoice',
      status: 'issued',
      number: 'RE-2026-0001',
      documentDate: '2026-09-18',
      issuedAt: new Date(),
      subject: 'Störungsbeseitigung Treppenhaus',
    })

    const sites = await db
      .select()
      .from(schema.sites)
      .where(and(eq(schema.sites.tenantId, tenant.id), eq(schema.sites.customerId, customerId)))
    expect(sites).toHaveLength(40)

    const installations = await db
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.tenantId, tenant.id))
    expect(installations).toHaveLength(40)

    // The point of the whole cut: the history belongs to the building, not to
    // the customer. Asking about one building must not drag in the other 39.
    const historyOfFirst = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.siteId, firstSite))
    expect(historyOfFirst).toHaveLength(1)
    expect(historyOfFirst[0]?.number).toBe('RE-2026-0001')

    const historyOfOther = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.siteId, otherSite))
    expect(historyOfOther).toEqual([])
  })
})

describe('the structure below an installation', () => {
  it('keeps a circuit from claiming a section of a different board', async () => {
    const tenant = await createTenant('Elektro Gegenprobe GmbH')
    const customerId = newId<'customer'>()
    await db.insert(schema.customers).values({
      id: customerId,
      tenantId: tenant.id,
      kind: 'business',
      name: 'Bauherr',
    })

    const [site] = await db
      .insert(schema.sites)
      .values({ tenantId: tenant.id, customerId, designation: 'Werkhalle' })
      .returning()
    if (!site) {
      throw new Error('The insert returned no site')
    }

    const [installation] = await db
      .insert(schema.installations)
      .values({
        tenantId: tenant.id,
        siteId: site.id,
        kind: 'meter_cabinet',
        designation: 'Hauptverteilung',
      })
      .returning()
    if (!installation) {
      throw new Error('The insert returned no installation')
    }

    const [boardOne, boardTwo] = await db
      .insert(schema.distributionBoards)
      .values([
        {
          tenantId: tenant.id,
          installationId: installation.id,
          kind: 'main_distribution' as const,
          designation: 'NSHV',
        },
        {
          tenantId: tenant.id,
          installationId: installation.id,
          kind: 'sub_distribution' as const,
          designation: 'UV Büro',
        },
      ])
      .returning()
    if (!boardOne || !boardTwo) {
      throw new Error('The insert returned no boards')
    }

    const [section] = await db
      .insert(schema.boardSections)
      .values({
        tenantId: tenant.id,
        distributionBoardId: boardOne.id,
        designation: 'Feld 1',
      })
      .returning()
    if (!section) {
      throw new Error('The insert returned no section')
    }

    // A circuit in a section of its own board: fine.
    await db.insert(schema.circuits).values({
      tenantId: tenant.id,
      distributionBoardId: boardOne.id,
      boardSectionId: section.id,
      designation: 'F1 Steckdosen',
    })

    // A small sub distribution has no sections, so a circuit may name none.
    await db.insert(schema.circuits).values({
      tenantId: tenant.id,
      distributionBoardId: boardTwo.id,
      designation: 'F1 Licht',
    })

    // The same section under a different board: the database refuses. Without
    // this a circuit chart could quietly list circuits under the wrong board,
    // and the test record printed from it would be wrong in the same way.
    expect(
      await refusedBy(
        db.insert(schema.circuits).values({
          tenantId: tenant.id,
          distributionBoardId: boardTwo.id,
          boardSectionId: section.id,
          designation: 'F2 falsch zugeordnet',
        }),
      ),
    ).toEqual({ code: foreignKeyViolation, constraint: 'circuits_section_belongs_to_board' })
  })

  it('makes a contact belong to a customer or a site, never both and never neither', async () => {
    const tenant = await createTenant('Elektro Kontakt GmbH')
    const customerId = newId<'customer'>()
    await db.insert(schema.customers).values({
      id: customerId,
      tenantId: tenant.id,
      kind: 'business',
      name: 'Kunde',
    })

    const [site] = await db
      .insert(schema.sites)
      .values({ tenantId: tenant.id, customerId, designation: 'Objekt' })
      .returning()
    if (!site) {
      throw new Error('The insert returned no site')
    }

    await db.insert(schema.contacts).values({
      tenantId: tenant.id,
      customerId,
      familyName: 'Buchhalter',
      role: 'Buchhaltung',
    })
    await db.insert(schema.contacts).values({
      tenantId: tenant.id,
      siteId: site.id,
      familyName: 'Hausmeister',
      role: 'Hausmeister',
    })

    const belongsToBoth = await refusedBy(
      db.insert(schema.contacts).values({
        tenantId: tenant.id,
        customerId,
        siteId: site.id,
        familyName: 'Beides',
      }),
    )
    expect(belongsToBoth).toEqual({
      code: checkViolation,
      constraint: 'contacts_belong_to_customer_or_site',
    })

    const belongsToNeither = await refusedBy(
      db.insert(schema.contacts).values({ tenantId: tenant.id, familyName: 'Nichts' }),
    )
    expect(belongsToNeither).toEqual({
      code: checkViolation,
      constraint: 'contacts_belong_to_customer_or_site',
    })
  })
})

describe('the branded keys', () => {
  it('keep a customer id out of a column that wants a site id', () => {
    const customerId: CustomerId = newId<'customer'>()

    // @ts-expect-error a customer id is not a site id, and the brand says so
    const siteId: SiteId = customerId

    expect(typeof siteId).toBe('string')
  })
})
