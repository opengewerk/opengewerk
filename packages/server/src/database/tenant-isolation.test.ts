import { createHash } from 'node:crypto'

import type { TenantId } from '@opengewerk/domain'
import { type SQL, sql } from 'drizzle-orm'
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
  foreignKeyViolation,
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
  await applyMigrations()
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

    // The floor moves with the schema and is only here so that a query which
    // returns nothing cannot pass as "no table unprotected". It stood at 14,
    // the count right after the first migration, while five migrations have
    // been added since.
    expect(rows.length).toBeGreaterThanOrEqual(21)

    const unprotected = rows.filter(
      (row) => !row.enabled || !row.forced || Number(row.policies) === 0 || !row.granted,
    )
    expect(unprotected).toEqual([])
  })

  /**
   * The test above asks whether a table has a policy, not what the policy
   * says. A later one with `using (true)`, or one that compares against the
   * wrong setting, would have passed it and opened the table to every
   * business (#148). So this reads the expression of every policy the
   * application falls under and holds it against the one comparison that is
   * allowed: the tenant of the row against the tenant of the transaction.
   *
   * A restrictive policy with that comparison covers a table on its own,
   * because it is ANDed with whatever else there is; that is how the audit log
   * and the change sequence let their trigger write while nobody else can.
   * Anything else that opens a table outside a business is listed below with
   * its reason, and the list is checked against the catalogue as well, so an
   * entry cannot outlive its policy.
   */
  it('let the application reach a row only through the tenant of the transaction', async () => {
    const outsideABusiness: Readonly<Record<string, string>> = {
      'memberships.own_membership_outside_tenant':
        'the chooser after a sign in reads its own memberships, outside any business',
      'tenants.own_tenants_outside_tenant':
        'the chooser reads the names of the businesses somebody belongs to',
      'tenants.created_by_setup':
        'the first run setup; no_application_insert keeps the application out of it',
    }

    const { rows } = await admin.query<{
      table_name: string
      policy: string
      permissive: boolean
      command: string
      applies: boolean
      using: string | null
      checking: string | null
      has_tenant: boolean
    }>(
      `select c.relname as table_name,
              p.polname as policy,
              p.polpermissive as permissive,
              p.polcmd as command,
              (p.polroles = '{0}' or $1::regrole = any(p.polroles)) as applies,
              pg_get_expr(p.polqual, p.polrelid) as using,
              pg_get_expr(p.polwithcheck, p.polrelid) as checking,
              exists (
                select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
              ) as has_tenant
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'`,
      [applicationRole],
    )

    const comparison = (column: string) =>
      `(${column} = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`
    const tables = new Set(
      rows
        .filter((row) => row.has_tenant || row.table_name === 'tenants')
        .map((row) => row.table_name),
    )
    const violations: string[] = []

    for (const table of tables) {
      const expected = comparison(table === 'tenants' ? 'id' : 'tenant_id')
      const policies = rows.filter((row) => row.table_name === table && row.applies)
      const restrictive = policies.filter((row) => !row.permissive)
      const reads = (command: string) => ['*', 'r', 'w', 'd'].includes(command)
      const writes = (command: string) => ['*', 'a', 'w'].includes(command)
      const readsFenced = restrictive.some((row) => row.command === '*' && row.using === expected)
      const writesFenced = restrictive.some(
        (row) =>
          (row.command === '*' || row.command === 'a') &&
          (row.checking === expected || row.checking === 'false'),
      )

      for (const row of policies.filter((policy) => policy.permissive)) {
        if (`${table}.${row.policy}` in outsideABusiness) {
          continue
        }

        if (reads(row.command) && !readsFenced && row.using !== expected) {
          violations.push(`${table}.${row.policy} reads: ${String(row.using)}`)
        }

        if (writes(row.command) && !writesFenced && row.checking !== expected) {
          violations.push(`${table}.${row.policy} writes: ${String(row.checking)}`)
        }
      }
    }

    // Floor, for the same reason as above: 37 tables carried a tenant on
    // 23.09.2026, and a query that finds none must not pass as "all fenced".
    expect(tables.size).toBeGreaterThanOrEqual(37)
    expect(violations).toEqual([])

    const listed = new Set(rows.map((row) => `${row.table_name}.${row.policy}`))
    expect(Object.keys(outsideABusiness).filter((entry) => !listed.has(entry))).toEqual([])
  })
})

describe('a tenant', () => {
  it('sees only its own rows, even without a where clause', async () => {
    const seenByNorth = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx.select().from(schema.customers),
    )
    const seenBySouth = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(schema.customers),
    )

    expect(seenByNorth).toHaveLength(1)
    expect(seenBySouth).toHaveLength(1)
    expect(seenByNorth[0]?.tenantId).toBe(north.id)
    expect(seenBySouth[0]?.tenantId).toBe(south.id)
    expect(seenByNorth[0]?.id).not.toBe(seenBySouth[0]?.id)
  })

  it('sees nothing of the other tenant through a join either', async () => {
    const rows = await database.forTenant({ tenantId: north.id }, (tx) =>
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
    const foreign = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(schema.customers),
    )
    const foreignId = foreign[0]?.id
    if (!foreignId) {
      throw new Error('The other tenant has no customer to try')
    }

    const found = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .select()
        .from(schema.customers)
        .where(sql`${schema.customers.id} = ${foreignId}`),
    )

    expect(found).toEqual([])
  })

  it('cannot write a row into the other tenant', async () => {
    const refused = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
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

    const stillOne = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(schema.customers),
    )
    expect(stillOne).toHaveLength(1)
  })

  it('cannot update a row of the other tenant', async () => {
    const changed = await database.forTenant({ tenantId: north.id }, (tx) =>
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

    const untouched = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(schema.customers),
    )
    expect(untouched[0]?.name).toBe('Gleicher Name GmbH')
  })

  it('cannot delete a row of the other tenant', async () => {
    const deleted = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx
        .delete(schema.sites)
        .where(sql`true`)
        .returning(),
    )
    expect(deleted).toHaveLength(1)
    expect(deleted[0]?.tenantId).toBe(north.id)

    const stillThere = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(schema.sites),
    )
    expect(stillThere).toHaveLength(1)
  })
})

/**
 * The table the policy sits on rather than points at. Everywhere else the
 * tenant is a foreign key; here it is the primary key, and that is a different
 * enough case to be worth its own run with two tenants in the database.
 */
describe('the tenants table', () => {
  it('shows a tenant its own row and no other', async () => {
    const seenByNorth = await database.forTenant({ tenantId: north.id }, (tx) =>
      tx.select().from(schema.tenants),
    )
    const seenBySouth = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(schema.tenants),
    )

    expect(seenByNorth).toHaveLength(1)
    expect(seenBySouth).toHaveLength(1)
    expect(seenByNorth[0]?.id).toBe(north.id)
    expect(seenBySouth[0]?.id).toBe(south.id)
  })

  it('cannot be written by the application role at all', async () => {
    // Reading was never the hole. The policy narrowed that to the session
    // tenant from the first migration on. What stood open was the blanket
    // grant from 0001: a tenant could rename itself, and it could delete its
    // own row, which the foreign keys would follow all the way down.
    const inserted = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx.insert(schema.tenants).values({ name: 'Selbst angelegt' }),
      ),
    )
    expect(inserted.code).toBe(insufficientPrivilege)

    const renamed = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx
          .update(schema.tenants)
          .set({ name: 'Selbst umbenannt' })
          .where(sql`true`),
      ),
    )
    expect(renamed.code).toBe(insufficientPrivilege)

    const removed = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx.delete(schema.tenants).where(sql`true`),
      ),
    )
    expect(removed.code).toBe(insufficientPrivilege)

    const { rows } = await admin.query<{ count: string }>('select count(*) from tenants')
    expect(rows[0]?.count).toBe('2')
  })
})

describe('without a tenant', () => {
  it('refuses before it even takes a connection', async () => {
    await expect(
      database.forTenant({ tenantId: '' as TenantId }, async (tx) =>
        tx.select().from(schema.customers),
      ),
    ).rejects.toThrow(/Not a tenant id/)

    await expect(
      database.forTenant({ tenantId: 'kein-mandant' as TenantId }, async (tx) =>
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
    await database.forTenant({ tenantId: north.id }, (tx) => tx.select().from(schema.customers))

    const leaked = await database.forTenant({ tenantId: south.id }, (tx) =>
      tx.select().from(schema.customers),
    )
    expect(leaked).toHaveLength(1)
    expect(leaked[0]?.tenantId).toBe(south.id)

    const setting = await database.forTenant({ tenantId: south.id }, async (tx) => {
      const result = await tx.execute(sql`select current_setting('app.tenant_id', true) as value`)

      return (result.rows[0] as { value: string | null }).value
    })
    expect(setting).toBe(south.id)
  })
})

/** The key of the lines, which the trigger in front of it keeps from the list. */
const lineKey = 'document_lines_document_in_tenant'

/**
 * Every key between two records of a business, with the write that tries it.
 * An update where the application may change the row, an insert where it may
 * only add one: snapshots, files and signatures are written once and never
 * again.
 */
const crossings: readonly {
  readonly key: string
  readonly write: (own: Planted, other: Planted) => SQL
}[] = [
  {
    key: 'contacts_customer_in_tenant',
    write: (own, other) => repoint('contacts', 'customer_id', own.customerContact, other.customer),
  },
  {
    key: 'contacts_site_in_tenant',
    write: (own, other) => repoint('contacts', 'site_id', own.siteContact, other.site),
  },
  {
    key: 'sites_customer_in_tenant',
    write: (own, other) => repoint('sites', 'customer_id', own.site, other.customer),
  },
  {
    key: 'installations_site_in_tenant',
    write: (own, other) => repoint('installations', 'site_id', own.installation, other.site),
  },
  {
    key: 'jobs_customer_in_tenant',
    write: (own, other) => repoint('jobs', 'customer_id', own.job, other.customer),
  },
  {
    key: 'jobs_site_in_tenant',
    write: (own, other) => repoint('jobs', 'site_id', own.job, other.site),
  },
  {
    key: 'jobs_installation_in_tenant',
    write: (own, other) => repoint('jobs', 'installation_id', own.job, other.installation),
  },
  {
    key: 'jobs_parent_in_tenant',
    write: (own, other) => repoint('jobs', 'parent_job_id', own.job, other.job),
  },
  {
    // An insert and not a repoint: a follow-up names the job before it when it
    // is made (#170), and the trigger refuses any later change before the key
    // is asked. On an insert the trigger finds no job of another business and
    // leaves the answer to the key.
    key: 'jobs_predecessor_in_tenant',
    write: (own, other) =>
      sql`insert into jobs (tenant_id, customer_id, kind, designation, predecessor_job_id)
            values (${own.tenant}, ${own.customer}, 'service', 'Wallbox', ${other.job})`,
  },
  {
    key: 'documents_customer_in_tenant',
    write: (own, other) => repoint('documents', 'customer_id', own.document, other.customer),
  },
  {
    key: 'documents_job_in_tenant',
    write: (own, other) => repoint('documents', 'job_id', own.document, other.job),
  },
  {
    key: 'documents_site_in_tenant',
    write: (own, other) => repoint('documents', 'site_id', own.document, other.site),
  },
  {
    key: 'documents_installation_in_tenant',
    write: (own, other) =>
      repoint('documents', 'installation_id', own.document, other.installation),
  },
  {
    key: 'documents_predecessor_in_tenant',
    write: (own, other) =>
      repoint('documents', 'predecessor_document_id', own.document, other.document),
  },
  {
    key: 'document_snapshots_document_in_tenant',
    write: (own, other) =>
      sql`insert into document_snapshots (tenant_id, document_id, content)
            values (${own.tenant}, ${other.document}, '{}'::jsonb)`,
  },
  {
    // The sources of a collective invoice (#135). Its trigger asks for both
    // documents under the policy, finds the one of another business nowhere
    // and leaves the answer to the key.
    key: 'document_sources_document_in_tenant',
    write: (own, other) =>
      sql`insert into document_sources (tenant_id, document_id, source_document_id, position)
            values (${own.tenant}, ${other.document}, ${own.document}, 1)`,
  },
  {
    key: 'document_sources_source_in_tenant',
    write: (own, other) =>
      sql`insert into document_sources (tenant_id, document_id, source_document_id, position)
            values (${own.tenant}, ${own.document}, ${other.document}, 1)`,
  },
  {
    key: 'payments_document_in_tenant',
    write: (own, other) =>
      sql`insert into payments (tenant_id, document_id, amount_cents, received_on)
            values (${own.tenant}, ${other.document}, 100, '2026-09-01')`,
  },
  {
    key: 'document_files_document_in_tenant',
    write: (own, other) =>
      sql`insert into document_files (tenant_id, document_id, purpose, file_id)
            values (${own.tenant}, ${other.document}, 'pdf', ${own.file})`,
  },
  {
    key: 'document_files_file_in_tenant',
    write: (own, other) =>
      sql`insert into document_files (tenant_id, document_id, purpose, file_id)
            values (${own.tenant}, ${own.document}, 'pdf', ${other.file})`,
  },
  {
    // The signature signs its document in a trigger after the insert. The key
    // is asked first, and it has to be: signed would be the document of the
    // other business.
    key: 'document_signatures_document_in_tenant',
    write: (own, other) =>
      sql`insert into document_signatures
            (tenant_id, document_id, signer_name, signed_at, path, content_fingerprint)
            values (${own.tenant}, ${other.document}, 'Max Weber', now(), 'M10,10L20,20', 'probe')`,
  },
  {
    // An insert although the choice may be changed: a document holds one, so
    // the document of the other business must not have one yet, or its unique
    // index answers before the key does.
    key: 'document_instruction_choices_document_in_tenant',
    write: (own, other) =>
      sql`insert into document_instruction_choices (tenant_id, document_id)
            values (${own.tenant}, ${other.document})`,
  },
  {
    key: 'attachments_customer_in_tenant',
    write: (own, other) => repoint('attachments', 'customer_id', own.attachment, other.customer),
  },
  {
    key: 'attachments_site_in_tenant',
    write: (own, other) => repoint('attachments', 'site_id', own.attachment, other.site),
  },
  {
    key: 'attachments_installation_in_tenant',
    write: (own, other) =>
      repoint('attachments', 'installation_id', own.attachment, other.installation),
  },
  {
    key: 'attachments_job_in_tenant',
    write: (own, other) => repoint('attachments', 'job_id', own.attachment, other.job),
  },
  {
    // Inserts, since a version is written once: the attachment of the other
    // business, a file of the other business named by its hash, and the same
    // for the preview.
    key: 'attachment_versions_attachment_in_tenant',
    write: (own, other) =>
      sql`insert into attachment_versions
            (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
            values (${own.tenant}, ${other.attachment}, ${own.fileHash}, 'Plan.png', 'image/png', 1)`,
  },
  {
    key: 'attachment_versions_file_in_tenant',
    write: (own, other) =>
      sql`insert into attachment_versions
            (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
            values (${own.tenant}, ${own.attachment}, ${other.fileHash}, 'Plan.png', 'image/png', 1)`,
  },
  {
    key: 'attachment_versions_preview_in_tenant',
    write: (own, other) =>
      sql`insert into attachment_versions
            (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes, preview_sha256)
            values (${own.tenant}, ${own.attachment}, ${own.fileHash}, 'Plan.png', 'image/png', 1,
                    ${other.fileHash})`,
  },
  {
    // Inserts, since an entry is written once; the person comes from the
    // request as it would for a device.
    key: 'time_entries_job_in_tenant',
    write: (own, other) =>
      sql`insert into time_entries (tenant_id, kind, job_id, started_at, ended_at)
            select ${own.tenant}, 'work', ${other.job}, now() - interval '1 hour', now()
              from (select set_config('app.user_id', ${own.user}, true)) as acting`,
  },
  {
    key: 'time_entries_correction_in_tenant',
    write: (own, other) =>
      sql`insert into time_entries (tenant_id, kind, started_at, ended_at, corrects_entry_id, note)
            select ${own.tenant}, 'work', now() - interval '1 hour', now(), ${other.timeEntry}, 'falsch'
              from (select set_config('app.user_id', ${own.user}, true)) as acting`,
  },
  {
    key: 'letterheads_logo_in_tenant',
    write: (own, other) => repoint('letterheads', 'logo_file_id', own.letterhead, other.file),
  },
  {
    key: 'mail_outbox_task_in_tenant',
    write: (own, other) => repoint('mail_outbox', 'task_id', own.mail, other.task),
  },
  {
    key: 'mail_outbox_document_in_tenant',
    write: (own, other) => repoint('mail_outbox', 'document_id', own.mail, other.document),
  },
  {
    key: 'mail_outbox_invitation_in_tenant',
    write: (own, other) => repoint('mail_outbox', 'invitation_id', own.mail, other.invitation),
  },
  {
    key: 'tasks_customer_in_tenant',
    write: (own, other) => repoint('tasks', 'customer_id', own.task, other.customer),
  },
  {
    key: 'tasks_site_in_tenant',
    write: (own, other) => repoint('tasks', 'site_id', own.task, other.site),
  },
  {
    key: 'tasks_job_in_tenant',
    write: (own, other) => repoint('tasks', 'job_id', own.task, other.job),
  },
  {
    // Not a record but a person: the owner of the other business, who has no
    // membership in this one.
    key: 'tasks_assignee_works_here',
    write: (own, other) => repoint('tasks', 'assignee_user_id', own.task, other.user),
  },
  {
    key: 'inverters_installation_in_tenant',
    write: (own, other) =>
      repoint('inverters', 'installation_id', own.inverter, other.installation),
  },
  {
    key: 'pv_strings_inverter_in_tenant',
    write: (own, other) => repoint('pv_strings', 'inverter_id', own.pvString, other.inverter),
  },
  {
    key: 'pv_modules_string_in_tenant',
    write: (own, other) => repoint('pv_modules', 'pv_string_id', own.pvModule, other.pvString),
  },
  {
    key: 'distribution_boards_installation_in_tenant',
    write: (own, other) =>
      repoint('distribution_boards', 'installation_id', own.board, other.installation),
  },
  {
    key: 'board_sections_board_in_tenant',
    write: (own, other) =>
      repoint('board_sections', 'distribution_board_id', own.section, other.board),
  },
  {
    key: 'circuits_board_in_tenant',
    write: (own, other) => repoint('circuits', 'distribution_board_id', own.circuit, other.board),
  },
  {
    // The exception from the catalogue, tried as well. Its own board stays,
    // the section is one of the other business, and no section of that board
    // has this id.
    key: 'circuits_section_belongs_to_board',
    write: (own, other) => repoint('circuits', 'board_section_id', own.circuit, other.section),
  },
  {
    key: 'equipment_circuit_in_tenant',
    write: (own, other) => repoint('equipment', 'circuit_id', own.equipment, other.circuit),
  },
]

/**
 * A foreign key is checked past row level security. The database looks the
 * parent up as the owner of its table, so a key on the id alone finds the
 * record of any business, and a record of this one could be hung on a customer
 * of the next. Since 0030 and 0031 every reference between two records of a
 * business runs over the tenant as well, and these are the tests that hold it:
 * one record of each kind, pointed at a record of the other business through
 * the role the application uses, and refused by the name of its key.
 *
 * The name matters as much as the refusal. A write refused for any other
 * reason, a check or a trigger in front of the key, would say nothing about
 * the key, and the one case where that is so has a test of its own below.
 */
describe('a reference to a record of another business', () => {
  let own: Planted
  let other: Planted

  beforeAll(async () => {
    own = await plant(north.id, 'nord')
    other = await plant(south.id, 'sued')
  })

  it('is refused by every key between two records of a business', async () => {
    // The catalogue asked rather than the list below: a key added by a later
    // migration that forgets the tenant is exactly the key nobody writes a
    // test for. Between two tables of a business the tenant comes first on
    // both sides, which is how 0030 and 0031 build every one of them.
    const { rows } = await admin.query<{ key: string; columns: string; target: string }>(
      `select c.conname as key,
              (select string_agg(a.attname, ',' order by k.ord)
                 from unnest(c.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
              (select string_agg(a.attname, ',' order by k.ord)
                 from unnest(c.confkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as target
         from pg_constraint c
        where c.contype = 'f'
          and c.connamespace = 'public'::regnamespace
          and exists (select 1 from pg_attribute a
                       where a.attrelid = c.conrelid and a.attname = 'tenant_id' and not a.attisdropped)
          and exists (select 1 from pg_attribute a
                       where a.attrelid = c.confrelid and a.attname = 'tenant_id' and not a.attisdropped)
        order by c.conname`,
    )

    // A floor, so that a query which finds nothing cannot pass as "no key
    // without the tenant". 35 is the count after 0031.
    expect(rows.length).toBeGreaterThanOrEqual(35)

    const withoutTheTenant = rows.filter(
      (row) => !row.columns.startsWith('tenant_id,') || !row.target.startsWith('tenant_id,'),
    )

    // The one exception, and why it holds anyway: the key from a circuit to
    // its section pairs the section with the board, and the board's own key
    // runs over the tenant. The section belongs to that board, the board to
    // the business of the circuit, so the section does as well.
    expect(withoutTheTenant.map((row) => row.key)).toEqual(['circuits_section_belongs_to_board'])

    // And every one of them has its case below, so that none is only claimed.
    const tested = new Set([...crossings.map((crossing) => crossing.key), lineKey])
    expect(rows.map((row) => row.key).filter((key) => !tested.has(key))).toEqual([])
  })

  it.each(crossings)('is refused by $key', async ({ key, write }) => {
    const refused = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) => tx.execute(write(own, other))),
    )

    expect(refused).toEqual({ code: foreignKeyViolation, constraint: key })
  })

  it('is refused for a line before the key is even asked, and by the key behind that', async () => {
    // Through the application the line never gets as far as its key. The
    // trigger that keeps the lines of an issued document asks for the status
    // of the document first, cannot see one of another business, and refuses
    // as it would for a fixed one. That is a refusal, and the right one, but
    // it is not the key.
    const throughTheApplication = await refusedBy(
      database.forTenant({ tenantId: north.id }, (tx) =>
        tx.execute(repoint('document_lines', 'document_id', own.line, other.document)),
      ),
    )
    expect(throughTheApplication.code).toBe('OG001')

    // The superuser sees every row, so the trigger finds a draft and lets the
    // line through. What is left is the key, and it holds.
    const pastEveryPolicy = await refusedBy(
      admin.query('update document_lines set document_id = $1 where id = $2', [
        other.document,
        own.line,
      ]),
    )
    expect(pastEveryPolicy).toEqual({ code: foreignKeyViolation, constraint: lineKey })
  })
})

/** One record of each kind that points at another, all of one business. */
interface Planted {
  readonly tenant: TenantId
  readonly user: string
  readonly customer: string
  readonly customerContact: string
  readonly site: string
  readonly siteContact: string
  readonly installation: string
  readonly job: string
  readonly document: string
  readonly line: string
  readonly file: string
  /** The hash of that file, which a version of an attachment names it by. */
  readonly fileHash: string
  readonly attachment: string
  readonly timeEntry: string
  readonly letterhead: string
  readonly invitation: string
  readonly task: string
  readonly mail: string
  readonly inverter: string
  readonly pvString: string
  readonly pvModule: string
  readonly board: string
  readonly section: string
  readonly circuit: string
  readonly equipment: string
}

/**
 * Planted as the superuser, the way the other fixtures here are: the point is
 * what the application role may do with them afterwards, not how they came
 * about. Every record stands alone where it can, a job without a site and a
 * circuit without a section, so that a write refused below is refused for the
 * one reference it changes and not for another it would drag along.
 */
async function plant(tenant: TenantId, slug: string): Promise<Planted> {
  const one = async (statement: string, values: unknown[]): Promise<string> => {
    const { rows } = await admin.query<{ id: string }>(`${statement} returning id`, values)
    const id = rows[0]?.id

    if (!id) {
      throw new Error(`Nothing was planted by: ${statement}`)
    }

    return id
  }
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')

  const user = `${slug}-inhaber`
  await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
    user,
    'Inhaberin',
    `inhaberin@${slug}.example`,
  ])
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{owner}')",
    [tenant, user],
  )

  const customer = await one(
    "insert into customers (tenant_id, kind, name) values ($1, 'business', 'Bauherr')",
    [tenant],
  )
  const site = await one(
    "insert into sites (tenant_id, customer_id, designation) values ($1, $2, 'Haus 1')",
    [tenant, customer],
  )
  const installation = await one(
    "insert into installations (tenant_id, site_id, kind, designation) values ($1, $2, 'pv_system', 'PV-Anlage')",
    [tenant, site],
  )
  const job = await one(
    "insert into jobs (tenant_id, customer_id, kind, designation) values ($1, $2, 'project', 'Neubau')",
    [tenant, customer],
  )
  const document = await one(
    "insert into documents (tenant_id, customer_id, kind, document_date) values ($1, $2, 'quote', '2026-09-22')",
    [tenant, customer],
  )
  const fileHash = hash(`logo-${slug}`)
  const file = await one(
    "insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 1, 'image/png')",
    [tenant, fileHash],
  )
  const invitation = await one(
    `insert into invitations (tenant_id, email, name, roles, token_hash, invited_by, expires_at)
       values ($1, $2, 'Max Monteur', '{technician}', $3, $4, now() + interval '1 day')`,
    [tenant, `monteur@${slug}.example`, hash(`einladung-${slug}`), user],
  )
  const task = await one(
    "insert into tasks (tenant_id, title, due_on, assignee_user_id) values ($1, 'Zählerschrank prüfen', '2026-09-30', $2)",
    [tenant, user],
  )
  const inverter = await one(
    "insert into inverters (tenant_id, installation_id, designation) values ($1, $2, 'WR 1')",
    [tenant, installation],
  )
  const pvString = await one(
    "insert into pv_strings (tenant_id, inverter_id, designation) values ($1, $2, 'String 1')",
    [tenant, inverter],
  )
  const board = await one(
    "insert into distribution_boards (tenant_id, installation_id, kind, designation) values ($1, $2, 'sub_distribution', 'AC-Verteiler')",
    [tenant, installation],
  )
  const circuit = await one(
    "insert into circuits (tenant_id, distribution_board_id, designation) values ($1, $2, 'F1')",
    [tenant, board],
  )

  return {
    tenant,
    user,
    customer,
    customerContact: await one(
      "insert into contacts (tenant_id, customer_id, family_name) values ($1, $2, 'Weber')",
      [tenant, customer],
    ),
    site,
    siteContact: await one(
      "insert into contacts (tenant_id, site_id, family_name) values ($1, $2, 'Hausmeister')",
      [tenant, site],
    ),
    installation,
    job,
    document,
    line: await one(
      `insert into document_lines
         (tenant_id, document_id, position, designation, quantity_milli, unit, unit_price_cents, net_cents)
         values ($1, $2, 1, 'Leitung verlegen', 1000, 'metre', 1000, 1000)`,
      [tenant, document],
    ),
    file,
    fileHash,
    attachment: await one(
      "insert into attachments (tenant_id, customer_id, title) values ($1, $2, 'Schaltplan')",
      [tenant, customer],
    ),
    // Whose time it is comes from the request, so the planting says who acts.
    timeEntry: await one(
      `insert into time_entries (tenant_id, user_id, kind, started_at, ended_at)
         select $1, $2, 'work', now() - interval '2 hours', now() - interval '1 hour'
           from (select set_config('app.user_id', $2, false)) as acting`,
      [tenant, user],
    ),
    letterhead: await one('insert into letterheads (tenant_id) values ($1)', [tenant]),
    invitation,
    task,
    mail: await one(
      `insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, subject, body)
         values ($1, 'task_due', $2, 'Elektro', 'kunde@example.com', 'Fällig', 'Heute fällig.')`,
      [tenant, `task:${task}`],
    ),
    inverter,
    pvString,
    pvModule: await one('insert into pv_modules (tenant_id, pv_string_id) values ($1, $2)', [
      tenant,
      pvString,
    ]),
    board,
    section: await one(
      "insert into board_sections (tenant_id, distribution_board_id, designation) values ($1, $2, 'Feld 1')",
      [tenant, board],
    ),
    circuit,
    equipment: await one(
      "insert into equipment (tenant_id, circuit_id, designation) values ($1, $2, 'Wallbox')",
      [tenant, circuit],
    ),
  }
}

/** A record of this business made to point at another: one column, one row. */
function repoint(table: string, column: string, row: string, target: string): SQL {
  return sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${target} where id = ${row}`
}

async function connectAsApplication() {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: applicationDatabaseUrl(), max: 1 })
  await pool.query('select 1')

  return pool
}
