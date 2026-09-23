import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from './identifier.js'
import {
  MigrationHistoryError,
  migrationsFolder,
  readMigrationIndex,
  runMigrations,
} from './migrations.js'
import type { AddedMigration } from './test-database.js'
import {
  appliedMigrationCount,
  changeMigration,
  columnNames,
  connect,
  migrationsFolderUpTo,
  ownerDatabaseUrl,
  resetSchema,
  tableNames,
} from './test-database.js'

/**
 * What an update has to survive, tested the way an installation goes through
 * it: a database on the state an older release left behind, then the migration
 * run of the current one against exactly that.
 *
 * The interesting case is not the empty database. It is the one with data in
 * it, because that is where a migration first learns what it forgot, and it is
 * the state nobody can try out again afterwards.
 */

/**
 * How many migrations the older release carried. Four leaves the two that
 * follow as the ones to pass over: 0004 hangs five columns on every table that
 * holds records, 0005 brings the rule engine. Both have to get along with rows
 * that are already there.
 */
const olderRelease = 4

const tenant = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
const folders: string[] = []

beforeAll(async () => {
  admin = await connect()
})

afterAll(async () => {
  await admin.end()

  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/** The migrations folder of an older release, removed again when tests end. */
function releaseFolder(count: number, ...added: AddedMigration[]): string {
  const folder = migrationsFolderUpTo(count, ...added)
  folders.push(folder)

  return folder
}

/**
 * A database on the older state, with the kind of data that makes a migration
 * fail: rows in the tables it wants to change, and an audit chain over them.
 */
async function olderInstallation(): Promise<void> {
  await resetSchema(admin)
  await runMigrations(ownerDatabaseUrl(), releaseFolder(olderRelease))

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
  await admin.query(
    "insert into customers (tenant_id, kind, name) values ($1, 'business', 'Bauherr Nord'), " +
      "($1, 'private', 'Familie Weber')",
    [tenant.id],
  )
  await admin.query("update customers set city = 'Mannheim' where name = 'Bauherr Nord'")
}

interface Chain {
  readonly nextSequence: string
  readonly headHash: string | null
}

async function chain(): Promise<Chain> {
  const { rows } = await admin.query<{ next_sequence: string; head_hash: string | null }>(
    'select next_sequence, head_hash from audit_chains where tenant_id = $1',
    [tenant.id],
  )

  const row = rows[0]

  if (!row) {
    throw new Error('The tenant has no audit chain')
  }

  return { nextSequence: row.next_sequence, headHash: row.head_hash }
}

/** What the database says about its own log: null when nothing is broken. */
async function chainProblem(): Promise<string | null> {
  const { rows } = await admin.query<{ problem: string | null }>(
    'select problem from verify_audit_chain($1)',
    [tenant.id],
  )

  return rows[0]?.problem ?? null
}

async function customerNames(): Promise<string[]> {
  const { rows } = await admin.query<{ name: string }>('select name from customers order by name')

  return rows.map((row) => row.name)
}

async function addCustomer(name: string): Promise<void> {
  await admin.query("insert into customers (tenant_id, kind, name) values ($1, 'business', $2)", [
    tenant.id,
    name,
  ])
}

/**
 * Everything the error chain says. The runner wraps the database error in one
 * of its own that repeats only the statement, so the sentence naming the
 * column sits one or two causes further down.
 */
function reasonOf(error: unknown): string {
  const sentences: string[] = []
  let current: unknown = error

  while (current instanceof Error) {
    sentences.push(current.message)
    current = (current as { cause?: unknown }).cause
  }

  return sentences.join(' | ')
}

describe('an update from an older release', () => {
  it('carries the data across two migrations and leaves the audit chain whole', async () => {
    await olderInstallation()

    expect(await appliedMigrationCount(admin)).toBe(olderRelease)
    expect(await columnNames(admin, 'customers')).not.toContain('change_sequence')

    const before = await chain()
    expect(Number(before.nextSequence)).toBeGreaterThan(3)

    // The update itself: the call the migration container makes, against the
    // folder of the current image.
    await runMigrations(ownerDatabaseUrl())

    expect(await appliedMigrationCount(admin)).toBe(readMigrationIndex().length)
    expect(await tableNames(admin)).toContain('tenant_parameters')
    expect(await columnNames(admin, 'customers')).toContain('change_sequence')
    expect(await customerNames()).toEqual(['Bauherr Nord', 'Familie Weber'])

    // The rows written before the update carry the new columns with their
    // defaults. A NOT NULL column without one would have stopped the update,
    // which is the reason to look rather than assume.
    const { rows: stamped } = await admin.query<{ version: number }>(
      'select version from customers order by name',
    )
    expect(stamped.map((row) => row.version)).toEqual([1, 1])

    // The chain is the part that cannot be repaired afterwards. Its head was
    // computed over entries the update passes over, so a column added to the
    // log itself would turn up here as a forgery.
    expect(await chain()).toEqual(before)
    expect(await chainProblem()).toBeNull()

    // And it goes on from where it stood, rather than starting again beside it.
    await addCustomer('Nach dem Update')

    expect(Number((await chain()).nextSequence)).toBeGreaterThan(Number(before.nextSequence))
    expect(await chainProblem()).toBeNull()
  })

  it('rolls the whole update back when one migration fails, and names the reason', async () => {
    await olderInstallation()

    const namesBefore = await customerNames()
    const chainBefore = await chain()

    // Two migrations, the second of which only works on an empty table. That
    // is the mistake this really guards against: a column added without a
    // default passes every development database that has no rows in it yet.
    const broken = releaseFolder(
      olderRelease,
      { tag: '0004_first_step', sql: 'CREATE TABLE "warranties" ("id" uuid PRIMARY KEY);' },
      {
        tag: '0005_second_step',
        sql: 'ALTER TABLE "customers" ADD COLUMN "credit_limit" numeric(12, 2) NOT NULL;',
      },
    )

    const failure = await runMigrations(ownerDatabaseUrl(), broken).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(reasonOf(failure)).toContain('credit_limit')

    // All or nothing. The first migration ran without complaint, and its table
    // is gone as well, because both were inside one transaction.
    expect(await tableNames(admin)).not.toContain('warranties')
    expect(await columnNames(admin, 'customers')).not.toContain('credit_limit')
    expect(await appliedMigrationCount(admin)).toBe(olderRelease)

    // Runnable, not merely unharmed: the old release goes on writing to this
    // database, and the log goes on with it.
    expect(await customerNames()).toEqual(namesBefore)
    await addCustomer('Nach dem Fehlschlag')

    expect(Number((await chain()).nextSequence)).toBeGreaterThan(Number(chainBefore.nextSequence))
    expect(await chainProblem()).toBeNull()
  })

  it('refuses to take a kind away from a board that still carries it', async () => {
    // `meter_cabinet` leaves `distribution_board_kind` in 0008. It leaves the
    // code, not a database somebody has already filled, and a cast that simply
    // went through would put such a board on a kind nobody chose for it. The
    // database refuses instead, and this is that refusal written down: the
    // whole update stops, the row keeps what it says, and the reason names the
    // value rather than the file.
    //
    // The release is looked up by the tag, not counted. A count would be right
    // today and point at the wrong migration the next time one is added.
    const beforeTheChange = readMigrationIndex().findIndex(
      (entry) => entry.tag === '0008_anlagenarten',
    )
    expect(beforeTheChange).toBeGreaterThan(0)

    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl(), releaseFolder(beforeTheChange))
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
    await admin.query(
      `with customer as (
         insert into customers (tenant_id, kind, name)
           values ($1, 'business', 'Hausverwaltung Süd') returning id
       ), site as (
         insert into sites (tenant_id, customer_id, designation)
           select $1, id, 'Haus 4' from customer returning id
       ), installation as (
         insert into installations (tenant_id, site_id, kind, designation)
           select $1, id, 'meter_cabinet', 'Zählerschrank' from site returning id
       )
       insert into distribution_boards (tenant_id, installation_id, kind, designation)
         select $1, id, 'meter_cabinet', 'Zählerschrank' from installation`,
      [tenant.id],
    )

    const failure = await runMigrations(ownerDatabaseUrl()).catch((error: unknown) => error)

    expect(reasonOf(failure)).toContain('meter_cabinet')
    expect(await appliedMigrationCount(admin)).toBe(beforeTheChange)

    const { rows } = await admin.query<{ kind: string }>('select kind from distribution_boards')
    expect(rows.map((row) => row.kind)).toEqual(['meter_cabinet'])
  })

  it('refuses to tie a reference to its business while it points into another one', async () => {
    // Up to 0031 a key on the id alone let a record of one business hang on
    // a record of the next, and nothing in the database said no. 0031 builds
    // the keys over the tenant, and a row that already crosses over would
    // make that fail with a sentence about a constraint. Worse would be to
    // repair it: which of the two businesses the site belongs to is not
    // something a migration can know. So it counts first, names what it
    // found, and stops.
    const beforeTheChange = readMigrationIndex().findIndex(
      (entry) => entry.tag === '0031_references_in_tenant',
    )
    expect(beforeTheChange).toBeGreaterThan(0)

    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl(), releaseFolder(beforeTheChange))

    const other = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }
    await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
      tenant.id,
      tenant.name,
      other.id,
      other.name,
    ])

    const planted = await admin.query<{ customer: string; site: string }>(
      `with customer as (
         insert into customers (tenant_id, kind, name) values ($1, 'business', 'Bauherr Süd')
           returning id
       )
       insert into sites (tenant_id, customer_id, designation)
         select $1, id, 'Haus Süd' from customer returning customer_id as customer, id as site`,
      [other.id],
    )
    const foreign = planted.rows[0]
    if (!foreign) {
      throw new Error('The other business has no site to point at')
    }

    // One site of this business on a customer of the other, two installations
    // on a site of the other: one of each count, so the sentence is tried in
    // both forms.
    await admin.query(
      "insert into sites (tenant_id, customer_id, designation) values ($1, $2, 'Übergriff')",
      [tenant.id, foreign.customer],
    )
    await admin.query(
      `insert into installations (tenant_id, site_id, kind, designation)
         values ($1, $2, 'meter', 'Zähler 1'), ($1, $2, 'meter', 'Zähler 2')`,
      [tenant.id, foreign.site],
    )

    const failure = await runMigrations(ownerDatabaseUrl()).catch((error: unknown) => error)

    expect(reasonOf(failure)).toContain('sites.customer_id mit 1 Zeile')
    expect(reasonOf(failure)).toContain('installations.site_id mit 2 Zeilen')
    expect(await appliedMigrationCount(admin)).toBe(beforeTheChange)

    // Nothing bent into shape: the site still points where it did.
    const { rows: crossing } = await admin.query<{ customer_id: string }>(
      "select customer_id from sites where designation = 'Übergriff'",
    )
    expect(crossing.map((row) => row.customer_id)).toEqual([foreign.customer])

    // The check lifts FORCE to see the rows at all, and the failed update has
    // to leave it as it was. A table left without it would show its owner
    // every business, and nothing would ever say so.
    const { rows: unforced } = await admin.query<{ relname: string }>(
      `select relname from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
          and relrowsecurity and not relforcerowsecurity`,
    )
    expect(unforced).toEqual([])

    // Put right, the same update goes through, which is what the sentence
    // tells whoever reads it to do.
    const own = await admin.query<{ id: string }>(
      "insert into customers (tenant_id, kind, name) values ($1, 'business', 'Bauherr Nord') returning id",
      [tenant.id],
    )
    await admin.query("update sites set customer_id = $1 where designation = 'Übergriff'", [
      own.rows[0]?.id,
    ])
    await admin.query(
      "update installations set site_id = (select id from sites where designation = 'Übergriff')",
    )

    await runMigrations(ownerDatabaseUrl())
    expect(await appliedMigrationCount(admin)).toBe(readMigrationIndex().length)
  })

  it('refuses to keep a chain from branching while a document already has two successors', async () => {
    // Up to 0033 any number of successors could be made out of one document,
    // and a final invoice next to a progress invoice deducted nothing of it.
    // 0033 allows one that counts. Which of two stays is a person's decision,
    // so the migration counts first, names the number, and stops.
    const beforeTheChange = readMigrationIndex().findIndex(
      (entry) => entry.tag === '0033_one_successor',
    )
    expect(beforeTheChange).toBeGreaterThan(0)

    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl(), releaseFolder(beforeTheChange))
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])

    const planted = await admin.query<{ id: string; customer_id: string }>(
      `with customer as (
         insert into customers (tenant_id, kind, name) values ($1, 'business', 'Bauherr Nord')
           returning id
       )
       insert into documents (tenant_id, customer_id, kind, document_date)
         select $1, id, 'quote', '2026-09-01' from customer returning id, customer_id`,
      [tenant.id],
    )
    const quote = planted.rows[0]
    if (!quote) {
      throw new Error('There is no quote to make successors out of')
    }

    const side = await admin.query<{ id: string; kind: string }>(
      `insert into documents (tenant_id, customer_id, kind, document_date, predecessor_document_id)
         values ($1, $2, 'progress_invoice', '2026-09-02', $3),
                ($1, $2, 'final_invoice', '2026-09-02', $3)
         returning id, kind`,
      [tenant.id, quote.customer_id, quote.id],
    )

    const failure = await runMigrations(ownerDatabaseUrl()).catch((error: unknown) => error)

    expect(reasonOf(failure)).toContain('Aus einem Beleg ist schon mehr als ein Folgebeleg')
    expect(await appliedMigrationCount(admin)).toBe(beforeTheChange)

    // The count lifts FORCE to see the rows, and a failed update leaves it on.
    const { rows: unforced } = await admin.query<{ relname: string }>(
      `select relname from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
          and relrowsecurity and not relforcerowsecurity`,
    )
    expect(unforced).toEqual([])

    // A deleted draft does not count, so deleting the second one is the way
    // on the sentence names, and the same update goes through.
    await admin.query('update documents set deleted_at = now() where id = $1', [
      side.rows.find((row) => row.kind === 'final_invoice')?.id,
    ])

    await runMigrations(ownerDatabaseUrl())
    expect(await appliedMigrationCount(admin)).toBe(readMigrationIndex().length)
  })
})

/**
 * 0029 changed the shipped instructions of every business with four UPDATEs,
 * and as the owner under FORCE ROW LEVEL SECURITY they found no row. 0032 says
 * the same again with FORCE lifted. These are the rows 0027 wrote, planted as
 * the superuser, and the way from there runs as an update does.
 */
describe('the instructions a business had before 0029', () => {
  const release = (tag: string) => readMigrationIndex().findIndex((entry) => entry.tag === tag)

  interface Instruction {
    readonly template: string | null
    readonly title: string
    readonly kinds: string[]
    readonly with_document: boolean
    readonly position: number
  }

  /** The three rows 0027 wrote for a business, and one the business wrote itself. */
  async function plantAsIn0027(): Promise<void> {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
    await admin.query(
      `insert into instructions (tenant_id, template, title, kinds, consumers_only, with_document, position)
         values ($1, 'withdrawal', 'Widerrufsbelehrung', '{cost_estimate,quote}', true, false, 1),
                ($1, 'withdrawal_form', 'Muster-Widerrufsformular', '{cost_estimate,quote}', true, false, 2),
                ($1, 'early_start', 'Beginn vor Ablauf der Widerrufsfrist', '{cost_estimate,quote}', true, false, 3)`,
      [tenant.id],
    )
    // Nothing here may touch it, whatever it carries: every statement names
    // the shipped instruction it is for.
    await admin.query(
      `insert into instructions (tenant_id, title, body, kinds, with_document, position)
         values ($1, 'Hinweise zur Baustelle', 'Bitte räumen Sie den Zählerplatz frei.',
                 '{cost_estimate,quote}', false, 5)`,
      [tenant.id],
    )
  }

  async function standing(): Promise<Instruction[]> {
    const { rows } = await admin.query<Instruction>(
      `select template::text as template, title, kinds::text[] as kinds, with_document, position
         from instructions order by position, title`,
    )

    return rows
  }

  const own: Instruction = {
    template: null,
    title: 'Hinweise zur Baustelle',
    kinds: ['cost_estimate', 'quote'],
    with_document: false,
    position: 5,
  }

  it('carries what 0029 meant them to be after an update from before it', async () => {
    const before = release('0029_instructions_for_quotes')
    expect(before).toBeGreaterThan(0)

    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl(), releaseFolder(before))
    await plantAsIn0027()

    // One migration more behind 0032 in the same run, the way a later one
    // will come. It fails if the reason 0032 gives the audit log were still
    // set, so the reason ends with its statements and not with the run.
    const reasonGone = releaseFolder(readMigrationIndex().length, {
      tag: '9999_reason_is_gone',
      sql: `DO $$ BEGIN
              IF current_setting('app.reason', true) = 'migration' THEN
                RAISE EXCEPTION 'The reason of 0032 is still set';
              END IF;
            END $$;`,
    })
    await runMigrations(ownerDatabaseUrl(), reasonGone)

    expect(await standing()).toEqual([
      {
        template: 'withdrawal',
        title: 'Widerrufsbelehrung',
        kinds: ['quote'],
        with_document: true,
        position: 1,
      },
      {
        template: 'withdrawal_form',
        title: 'Muster-Widerrufsformular',
        kinds: ['quote'],
        with_document: true,
        position: 3,
      },
      {
        template: 'early_start',
        title: 'Verlangen auf vorzeitigen Leistungsbeginn',
        kinds: ['quote'],
        with_document: false,
        position: 4,
      },
      own,
    ])

    // FORCE is back on, which the next business on the instance depends on.
    const { rows: forced } = await admin.query<{ forced: boolean }>(
      "select relforcerowsecurity as forced from pg_class where oid = 'instructions'::regclass",
    )
    expect(forced).toEqual([{ forced: true }])

    // Every change is in the log like any other, marked as the migration's,
    // and the chain over it holds.
    const { rows: logged } = await admin.query<{ reason: string | null; role: string }>(
      `select reason, database_role as role from audit_entries
        where table_name = 'instructions' and operation = 'update'`,
    )
    expect(logged.length).toBeGreaterThan(0)
    expect(new Set(logged.map((entry) => `${entry.reason ?? ''} ${entry.role}`))).toEqual(
      new Set(['migration opengewerk_owner']),
    )
    expect(await chainProblem()).toBeNull()
  })

  it('carries it as well where 0029 already ran and the notes came in since', async () => {
    // The case of an installation updated on the day 0029 came out: the
    // migration ran and did nothing, and the next time anybody looked at the
    // instructions the server wrote the notes into second place, beside the
    // form that should have moved.
    const after = release('0029_instructions_for_quotes') + 1

    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl(), releaseFolder(after))
    await plantAsIn0027()
    await admin.query(
      `insert into instructions (tenant_id, template, title, kinds, consumers_only, with_document, position)
         values ($1, 'withdrawal_notes', 'Hinweise zum Erlöschen des Widerrufsrechts', '{quote}', true, true, 2)`,
      [tenant.id],
    )

    await runMigrations(ownerDatabaseUrl())

    expect(
      (await standing()).map((row) => [row.template, row.position, row.kinds, row.with_document]),
    ).toEqual([
      ['withdrawal', 1, ['quote'], true],
      ['withdrawal_notes', 2, ['quote'], true],
      ['withdrawal_form', 3, ['quote'], true],
      ['early_start', 4, ['quote'], false],
      [null, 5, ['cost_estimate', 'quote'], false],
    ])
  })
})

describe('the migration run', () => {
  it('refuses a migration that was changed after it had run', async () => {
    await olderInstallation()

    const changed = releaseFolder(olderRelease)
    changeMigration(
      changed,
      '0002_nummernkreise',
      'CREATE TABLE "smuggled" ("id" uuid PRIMARY KEY);',
    )

    const failure = await runMigrations(ownerDatabaseUrl(), changed).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(MigrationHistoryError)
    expect((failure as Error).message).toContain('0002_nummernkreise')

    // Without the refusal this would go through without a word: the runner
    // compares timestamps, finds nothing newer and does nothing. Whoever made
    // the change would take it for applied.
    expect(await tableNames(admin)).not.toContain('smuggled')
    expect(await appliedMigrationCount(admin)).toBe(olderRelease)
  })

  it('refuses to pass over a migration the runner would skip', async () => {
    await olderInstallation()

    const index = readMigrationIndex()
    const outOfOrder = releaseFolder(olderRelease, {
      tag: '0004_late_arrival',
      sql: 'CREATE TABLE "warranties" ("id" uuid PRIMARY KEY);',
      // Before the last one that has already run, which is what two branches
      // merged in the wrong order leave behind.
      when: (index[olderRelease - 1]?.when ?? 0) - 1000,
    })

    const failure = await runMigrations(ownerDatabaseUrl(), outOfOrder).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(MigrationHistoryError)
    expect((failure as Error).message).toContain('0004_late_arrival')

    // The table really is missing, so the migration really was skipped. The
    // check after the run is the only thing that says so.
    expect(await tableNames(admin)).not.toContain('warranties')
  })

  it('refuses an image that is older than the database', async () => {
    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl())

    const failure = await runMigrations(ownerDatabaseUrl(), releaseFolder(olderRelease)).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(MigrationHistoryError)
    expect((failure as Error).message).toContain('älter als die Datenbank')
  })
})

describe('the migrations in this repository', () => {
  const index = readMigrationIndex()

  it('have a rollback file each', () => {
    for (const migration of index) {
      const path = join(migrationsFolder, 'down', `${migration.tag}.sql`)

      expect(
        () => readFileSync(path, 'utf8'),
        `${migration.tag} has no rollback file`,
      ).not.toThrow()
    }
  })

  it('have timestamps that only ever increase', () => {
    // The runner compares against the newest applied migration and nothing
    // else. One arriving with an older timestamp is skipped, and the check
    // that catches it runs on somebody's installation. Here it costs a line.
    const timestamps = index.map((migration) => migration.when)

    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right))
    expect(new Set(timestamps).size).toBe(timestamps.length)
  })

  it('hold nothing that cannot run inside a transaction', () => {
    // Every pending migration shares one transaction, which is what leaves a
    // failed update on the state before it. CREATE INDEX CONCURRENTLY and
    // VACUUM refuse to run in one and would take that away.
    for (const migration of index) {
      const sql = readFileSync(join(migrationsFolder, `${migration.tag}.sql`), 'utf8')

      expect(sql, `${migration.tag} uses CONCURRENTLY`).not.toMatch(/\bconcurrently\b/i)
      expect(sql, `${migration.tag} uses VACUUM`).not.toMatch(/\bvacuum\b/i)
    }
  })
})
