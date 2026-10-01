import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applicationRoleName } from '../database/roles.js'
import { writeMigrationsFolder } from '../database/test-database.js'
import {
  foundationBlocks,
  readBlock,
  readBlockRollback,
  readRolesBlock,
  statementBreakpoint,
} from './blocks.js'
import type { TableGuard } from './guards.js'
import {
  completeInitialMigration,
  completeInitialMigrationIn,
  initialMigrationRollback,
} from './initial.js'

// The tool that puts the building blocks around a first migration, on text.
// Whether the result builds a database is `foundation.test.ts`; here it is the
// order of the parts and everything the tool refuses, which is what keeps a
// table from being created unguarded.

/** What drizzle-kit writes for two tables, a type, a key and two policies. */
const generated = [
  `CREATE TYPE "public"."probe_kind" AS ENUM('one', 'two');`,
  `CREATE TABLE "probe_owners" (\n\t"id" uuid PRIMARY KEY NOT NULL\n);\n`,
  `ALTER TABLE "probe_owners" ENABLE ROW LEVEL SECURITY;`,
  `CREATE TABLE "probe_things" (\n\t"id" uuid PRIMARY KEY NOT NULL,\n\t"owner_id" uuid NOT NULL,\n\t"kind" "probe_kind" NOT NULL\n);\n`,
  `ALTER TABLE "probe_things" ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE "probe_things" ADD CONSTRAINT "probe_things_owner_id_probe_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."probe_owners"("id") ON DELETE restrict ON UPDATE no action;`,
  `CREATE POLICY "open" ON "probe_owners" AS PERMISSIVE FOR ALL TO public USING (true);`,
  `CREATE POLICY "reads_owners" ON "probe_things" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from probe_owners));`,
].join(`${statementBreakpoint}\n`)

const guards: readonly TableGuard[] = [
  { table: 'probe_owners', grants: ['select'], audited: true, synced: false },
  { table: 'probe_things', grants: ['select', 'insert'], audited: false, synced: true },
]

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

function positions(text: string, ...parts: string[]): number[] {
  return parts.map((part) => {
    const position = text.indexOf(part)

    if (position < 0) {
      throw new Error(`Not in the migration: ${part}`)
    }

    return position
  })
}

describe('a completed first migration', () => {
  const completed = completeInitialMigration(generated, { guards })

  it('creates the role before the first policy names it', () => {
    const [role, policy] = positions(completed, 'CREATE ROLE', 'CREATE POLICY')

    expect(role).toBeLessThan(policy as number)
  })

  it('keeps what drizzle-kit generated, untouched and in one piece', () => {
    expect(completed).toContain(generated)
  })

  it('forces and grants after the tables and before a function could read them', () => {
    const order = positions(
      completed,
      'CREATE TABLE "probe_things"',
      'ALTER TABLE "probe_owners" FORCE ROW LEVEL SECURITY;',
      'GRANT SELECT, INSERT ON "probe_things"',
      'CREATE FUNCTION "audit_fingerprint"',
      'CREATE FUNCTION "next_sync_sequence"',
      'CREATE FUNCTION "instance_is_empty"',
      'CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "probe_owners"',
      'CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "probe_things"',
    )

    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it('carries every block whole', () => {
    expect(completed).toContain(readRolesBlock())

    for (const block of foundationBlocks) {
      expect(completed).toContain(readBlock(block))
    }
  })

  it('leaves no statement that is a comment and nothing else', () => {
    // The runner sends each piece between two marks as one statement. A piece
    // with nothing but a comment in it is an empty query, which a driver may
    // take or may not; none is written, so the question never comes up.
    for (const piece of completed.split(statementBreakpoint)) {
      const code = piece
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim()

      expect(code).not.toBe('')
    }
  })

  it('refuses a table nobody described, instead of creating it unguarded', () => {
    expect(() => completeInitialMigration(generated, { guards: guards.slice(0, 1) })).toThrow(
      /nothing would guard them: probe_things/,
    )
  })

  it('refuses a description without its table, which is a schema without the foundation', () => {
    const withOneMore: readonly TableGuard[] = [
      ...guards,
      { table: 'probe_absent', grants: ['select'], audited: false, synced: false },
    ]

    expect(() => completeInitialMigration(generated, { guards: withOneMore })).toThrow(
      /does not create these tables, though they are described: probe_absent/,
    )
  })

  it('takes the tables of the foundation for the ones to guard unless told otherwise', () => {
    // So a migration generated from a schema without them is refused, whichever
    // of the two refusals comes first.
    expect(() => completeInitialMigration(generated)).toThrow(/nothing would guard them/)
  })

  it('refuses to be run over its own result', () => {
    expect(() => completeInitialMigration(completed, { guards })).toThrow(/completed before/)
  })

  it('refuses a migration that creates nothing', () => {
    expect(() => completeInitialMigration('ALTER TABLE "probe" ADD COLUMN "x" text;')).toThrow(
      /not an initial migration/,
    )
  })
})

describe('the rollback of a first migration', () => {
  const rollback = initialMigrationRollback(generated)

  it('takes the functions out before the tables they stand on', () => {
    const order = positions(
      rollback,
      'DROP FUNCTION IF EXISTS "every_tenant"();',
      'DROP FUNCTION IF EXISTS "next_sync_sequence"(uuid);',
      'DROP FUNCTION IF EXISTS "audit_fingerprint"(public.audit_entries);',
      'DROP TABLE IF EXISTS',
    )

    expect(order).toEqual([...order].sort((left, right) => left - right))

    for (const block of foundationBlocks) {
      expect(rollback).toContain(readBlockRollback(block))
    }
  })

  it('drops the policies before any table, because one of them may read another', () => {
    const [lastPolicy, firstTable] = [
      rollback.lastIndexOf('DROP POLICY IF EXISTS'),
      rollback.indexOf('DROP TABLE IF EXISTS'),
    ]

    expect(rollback).toContain('DROP POLICY IF EXISTS "reads_owners" ON "probe_things";')
    expect(lastPolicy).toBeLessThan(firstTable)
  })

  it('drops whatever points at a table before the table, and never with CASCADE', () => {
    const [things, owners, type] = positions(
      rollback,
      'DROP TABLE IF EXISTS "probe_things";',
      'DROP TABLE IF EXISTS "probe_owners";',
      'DROP TYPE IF EXISTS "public"."probe_kind";',
    )

    expect(things).toBeLessThan(owners as number)
    expect(owners).toBeLessThan(type as number)
    expect(rollback).not.toMatch(/CASCADE;/)
  })

  it('ends with the record of the runner, wherever the application keeps it', () => {
    expect(rollback.trimEnd().endsWith('DROP SCHEMA IF EXISTS "drizzle";')).toBe(true)

    const elsewhere = initialMigrationRollback(generated, { schema: 'public', table: 'applied' })

    expect(elsewhere.trimEnd().endsWith('DROP TABLE IF EXISTS "public"."applied";')).toBe(true)
    expect(elsewhere).not.toContain('DROP SCHEMA')
  })

  it('leaves the role standing and takes back its way into the schema', () => {
    expect(rollback).toContain(`REVOKE USAGE ON SCHEMA "public" FROM "${applicationRoleName}";`)
    expect(rollback).not.toContain('DROP ROLE')
  })

  it('refuses tables that point at each other in a circle', () => {
    const circle = [
      'CREATE TABLE "probe_left" (\n\t"id" uuid PRIMARY KEY NOT NULL\n);\n',
      'CREATE TABLE "probe_right" (\n\t"id" uuid PRIMARY KEY NOT NULL\n);\n',
      'ALTER TABLE "probe_left" ADD CONSTRAINT "left_fk" FOREIGN KEY ("id") REFERENCES "public"."probe_right"("id");',
      'ALTER TABLE "probe_right" ADD CONSTRAINT "right_fk" FOREIGN KEY ("id") REFERENCES "public"."probe_left"("id");',
    ].join(`${statementBreakpoint}\n`)

    expect(() => initialMigrationRollback(circle)).toThrow(/in a circle/)
  })

  it('lets a table point at itself', () => {
    const tree = [
      'CREATE TABLE "probe_nodes" (\n\t"id" uuid PRIMARY KEY NOT NULL,\n\t"parent_id" uuid\n);\n',
      'ALTER TABLE "probe_nodes" ADD CONSTRAINT "nodes_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."probe_nodes"("id");',
    ].join(`${statementBreakpoint}\n`)

    expect(initialMigrationRollback(tree)).toContain('DROP TABLE IF EXISTS "probe_nodes";')
  })

  it('refuses a record of the runner under a name that would need quoting', () => {
    expect(() =>
      initialMigrationRollback(generated, {
        schema: 'drizzle"; drop schema public; --',
        table: 'x',
      }),
    ).toThrow(/Not a name for the migration history/)
  })
})

describe('completing the first migration where it lies', () => {
  function folderOf(...tags: string[]): string {
    const folder = writeMigrationsFolder(
      tags.map((tag, position) => ({ tag, sql: generated, when: 1_000 * (position + 1) })),
    )
    folders.push(folder)

    return folder
  }

  it('rewrites the file and writes its rollback beside it', () => {
    const folder = folderOf('0000_probe')

    const done = completeInitialMigrationIn(folder, { guards })

    expect(done.tag).toBe('0000_probe')
    expect(readFileSync(done.file, 'utf8')).toBe(completeInitialMigration(generated, { guards }))
    expect(readFileSync(done.rollback, 'utf8')).toBe(initialMigrationRollback(generated))
    expect(readdirSync(join(folder, 'down'))).toEqual(['0000_probe.sql'])
  })

  it('refuses a folder with a second migration and leaves the first as it was', () => {
    // A second migration means the first has run somewhere, and a migration
    // that has run is not changed.
    const folder = folderOf('0000_probe', '0001_later')

    expect(() => completeInitialMigrationIn(folder, { guards })).toThrow(/Only the first migration/)
    expect(readFileSync(join(folder, '0000_probe.sql'), 'utf8')).toBe(generated)
  })

  it('writes nothing when the migration is refused', () => {
    const folder = folderOf('0000_probe')

    expect(() => completeInitialMigrationIn(folder)).toThrow(/nothing would guard them/)
    expect(readFileSync(join(folder, '0000_probe.sql'), 'utf8')).toBe(generated)
    expect(readdirSync(folder).sort()).toEqual(['0000_probe.sql', 'meta'])
  })

  it('refuses a folder in which nothing has been generated yet', () => {
    expect(() => completeInitialMigrationIn(folderOf())).toThrow(/holds 0/)
  })
})

describe('the building blocks', () => {
  const blocks = [
    readRolesBlock(),
    ...foundationBlocks.map(readBlock),
    ...foundationBlocks.map(readBlockRollback),
  ]

  it('name the role the code names, and no other', () => {
    // The policies come from the code and the grants from these files. A role
    // spelled differently in one of them would be created, granted and never
    // used, and the application would find its tables closed.
    const named = blocks.flatMap((block) => [...block.matchAll(/(?:TO|FROM) "([a-z_]+)"/g)])

    expect(named.length).toBeGreaterThan(4)
    expect(new Set(named.map((match) => match[1]))).toEqual(new Set([applicationRoleName]))
    expect(readRolesBlock()).toContain(`CREATE ROLE "${applicationRoleName}" NOLOGIN;`)
  })

  it('give the role no password and no way to sign in', () => {
    // Credentials do not belong in a file that sits in every clone. Asked of
    // the statements, not of the comment above them, which says the same in
    // words.
    const statements = readRolesBlock()
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n')

    expect(statements).toContain('NOLOGIN')
    expect(statements).not.toMatch(/PASSWORD|\bLOGIN\b/i)
  })

  it('create every function once and replace none', () => {
    // A block is the first migration of a database that has nothing. OR
    // REPLACE there would hide a function that is defined twice.
    for (const block of blocks) {
      expect(block).not.toContain('OR REPLACE')
    }
  })

  it('end every statement at a mark, so the runner sends them one by one', () => {
    for (const block of blocks) {
      for (const piece of block.split(statementBreakpoint)) {
        expect(piece.trimEnd().endsWith(';')).toBe(true)
      }
    }
  })
})
