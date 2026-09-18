import type { TenantId } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from './database.js'
import { newId } from './identifier.js'
import * as schema from './schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applicationRole,
  applyMigrations,
  connect,
  insufficientPrivilege,
  refusedBy,
  resetSchema,
} from './test-database.js'

/**
 * Row level security is a property of the database, not of the ORM, so these
 * tests talk to a real PostgreSQL through the role the application uses. A
 * superuser walks past every policy, which is exactly why the application must
 * never be one, and why a test run as superuser would prove nothing.
 */

let admin: Pool
let database: Database

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations(admin)
  await allowApplicationLogin(admin)

  // Creating a tenant is not something the application role does: it has no
  // tenant context yet, and the policy on `tenants` would refuse it. This is
  // the job of whoever sets up the instance.
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  // The same data on both sides, so that nothing can pass by accident: if a
  // query returned the wrong tenant's rows, the count alone would not show it.
  for (const tenant of [north, south]) {
    const customerId = newId<'customer'>()
    await admin.query('insert into customers (id, tenant_id, kind, name) values ($1, $2, $3, $4)', [
      customerId,
      tenant.id,
      'business',
      'Gleicher Name GmbH',
    ])
    await admin.query(
      'insert into sites (tenant_id, customer_id, designation) values ($1, $2, $3)',
      [tenant.id, customerId, 'Gleiche Bezeichnung'],
    )
  }

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the tables', () => {
  it('all have row level security enabled and forced, with a policy and a grant', async () => {
    // The check that keeps this working. A table added by a later migration
    // that forgets any of the three is a leak nobody would notice, because
    // everything still works: the rows are simply visible to everyone.
    const { rows } = await admin.query<{
      table_name: string
      enabled: boolean
      forced: boolean
      policies: string
      granted: boolean
    }>(
      `select c.relname as table_name,
              c.relrowsecurity as enabled,
              c.relforcerowsecurity as forced,
              (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
              has_table_privilege($1, c.oid, 'SELECT') as granted
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname <> '__drizzle_migrations'
        order by c.relname`,
      [applicationRole],
    )

    expect(rows.length).toBeGreaterThanOrEqual(14)

    const unprotected = rows.filter(
      (row) => !row.enabled || !row.forced || Number(row.policies) === 0 || !row.granted,
    )
    expect(unprotected).toEqual([])
  })
})

describe('a tenant', () => {
  it('sees only its own rows, even without a where clause', async () => {
    const seenByNorth = await database.forTenant(north.id, (tx) =>
      tx.select().from(schema.customers),
    )
    const seenBySouth = await database.forTenant(south.id, (tx) =>
      tx.select().from(schema.customers),
    )

    expect(seenByNorth).toHaveLength(1)
    expect(seenBySouth).toHaveLength(1)
    expect(seenByNorth[0]?.tenantId).toBe(north.id)
    expect(seenBySouth[0]?.tenantId).toBe(south.id)
    expect(seenByNorth[0]?.id).not.toBe(seenBySouth[0]?.id)
  })

  it('sees nothing of the other tenant through a join either', async () => {
    const rows = await database.forTenant(north.id, (tx) =>
      tx
        .select({ site: schema.sites.id, customer: schema.customers.id })
        .from(schema.sites)
        .innerJoin(schema.customers, sql`true`),
    )

    // A join without a sensible condition is a mistake, and it still must not
    // reach across: one site and one customer, both from this tenant.
    expect(rows).toHaveLength(1)
  })

  it('cannot read a row of the other tenant by its id', async () => {
    const foreign = await database.forTenant(south.id, (tx) => tx.select().from(schema.customers))
    const foreignId = foreign[0]?.id
    if (!foreignId) {
      throw new Error('The other tenant has no customer to try')
    }

    const found = await database.forTenant(north.id, (tx) =>
      tx
        .select()
        .from(schema.customers)
        .where(sql`${schema.customers.id} = ${foreignId}`),
    )

    expect(found).toEqual([])
  })

  it('cannot write a row into the other tenant', async () => {
    const refused = await refusedBy(
      database.forTenant(north.id, (tx) =>
        tx.insert(schema.customers).values({
          tenantId: south.id,
          kind: 'business',
          name: 'Untergeschoben',
        }),
      ),
    )
    // The WITH CHECK half of the policy. Without it a tenant could write rows
    // it would then not be able to see, which is the worst of both worlds.
    expect(refused.code).toBe(insufficientPrivilege)

    const stillOne = await database.forTenant(south.id, (tx) => tx.select().from(schema.customers))
    expect(stillOne).toHaveLength(1)
  })

  it('cannot update a row of the other tenant', async () => {
    const changed = await database.forTenant(north.id, (tx) =>
      tx
        .update(schema.customers)
        .set({ name: 'Umbenannt' })
        .where(sql`true`)
        .returning(),
    )

    // Its own row, and only that one. The other tenant is not visible, so the
    // update does not reach it rather than being refused: invisible rows are
    // not updated.
    expect(changed).toHaveLength(1)
    expect(changed[0]?.tenantId).toBe(north.id)

    const untouched = await database.forTenant(south.id, (tx) => tx.select().from(schema.customers))
    expect(untouched[0]?.name).toBe('Gleicher Name GmbH')
  })

  it('cannot delete a row of the other tenant', async () => {
    const deleted = await database.forTenant(north.id, (tx) =>
      tx
        .delete(schema.sites)
        .where(sql`true`)
        .returning(),
    )
    expect(deleted).toHaveLength(1)
    expect(deleted[0]?.tenantId).toBe(north.id)

    const stillThere = await database.forTenant(south.id, (tx) => tx.select().from(schema.sites))
    expect(stillThere).toHaveLength(1)
  })
})

describe('without a tenant', () => {
  it('refuses before it even takes a connection', async () => {
    await expect(
      database.forTenant('' as TenantId, async (tx) => tx.select().from(schema.customers)),
    ).rejects.toThrow(/Not a tenant id/)

    await expect(
      database.forTenant('kein-mandant' as TenantId, async (tx) =>
        tx.select().from(schema.customers),
      ),
    ).rejects.toThrow(/Not a tenant id/)
  })

  it('shows nothing when the setting is missing on the connection itself', async () => {
    // The layer above is one guard; this is the other. Even a query that gets
    // past the application somehow sees an empty database without the setting,
    // because the policy compares against null and null matches no row.
    const bare = await connectAsApplication()

    try {
      const { rows } = await bare.query('select * from customers')
      expect(rows).toEqual([])

      await expect(
        bare.query("insert into customers (tenant_id, kind, name) values ($1, 'business', 'X')", [
          north.id,
        ]),
      ).rejects.toThrow(/row-level security/i)
    } finally {
      await bare.end()
    }
  })

  it('does not inherit the tenant of the previous transaction', async () => {
    // The setting is local to the transaction. If it were not, a pooled
    // connection would hand the last tenant's rows to whoever gets it next,
    // and that is the kind of leak that only shows up under load.
    await database.forTenant(north.id, (tx) => tx.select().from(schema.customers))

    const leaked = await database.forTenant(south.id, (tx) => tx.select().from(schema.customers))
    expect(leaked).toHaveLength(1)
    expect(leaked[0]?.tenantId).toBe(south.id)

    const setting = await database.forTenant(south.id, async (tx) => {
      const result = await tx.execute(sql`select current_setting('app.tenant_id', true) as value`)

      return (result.rows[0] as { value: string | null }).value
    })
    expect(setting).toBe(south.id)
  })
})

async function connectAsApplication() {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: applicationDatabaseUrl(), max: 1 })
  await pool.query('select 1')

  return pool
}
