import {
  type PersonalSubject,
  personalDataCatalogue,
  personalSubjects,
  type TenantId,
} from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  accessLeftOut,
  accessRoots,
  accessWays,
  accountColumns,
  customerWalksInto,
  onlyAboutStaff,
  type ReportSchema,
  reportSchema,
  soundsSecret,
} from '../privacy/access-report.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from './test-database.js'

/**
 * The answer to a request for access (#318) against the database as it is
 * migrated: every table the catalogue of personal data (#317) says is about a
 * kind of person is reached along the foreign keys from the person's row, by
 * a way of its own, or left out with a reason; and no column the application
 * may read holds a key or a secret that the answer would give out.
 */

let admin: Pool
let database: Database
let schema: ReportSchema

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  database = Database.connect(applicationDatabaseUrl())
  // The schema as the application role sees it, in a business that has no rows.
  schema = await database.forTenant(
    { tenantId: newId<'tenant'>() as TenantId, userId: 'nobody' },
    (tx) => reportSchema(tx),
  )
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

/** The tables the foreign keys lead to from some tables, as far as `into` lets the walk go. */
function walked(from: readonly string[], into: (table: string) => boolean): Set<string> {
  const reached = new Set(from)
  const queue = [...from]

  while (queue.length > 0) {
    const parent = queue.shift() as string

    for (const key of schema.keys) {
      if (key.parent === parent && into(key.child) && !reached.has(key.child)) {
        reached.add(key.child)
        queue.push(key.child)
      }
    }
  }

  return reached
}

const about = (table: string, subject: PersonalSubject) =>
  personalDataCatalogue[table]?.about.includes(subject) ?? false

/** The tables the answer to one kind of person reads, as `access-report.ts` walks them. */
function covered(subject: PersonalSubject): Set<string> {
  const ways = [...accessWays[subject], ...Object.keys(accessLeftOut[subject])]

  switch (subject) {
    case 'customer':
      return new Set([...walked([accessRoots.customer], customerWalksInto), ...ways])
    case 'contact':
    case 'prospect':
      return new Set([...walked([accessRoots[subject]], (table) => about(table, subject)), ...ways])
    case 'person': {
      // One step from the file and the membership into what is about the
      // staff, then on through what is about the staff only; and every table
      // with a column that names an account.
      const first = schema.keys
        .filter(
          (key) =>
            (key.parent === 'people' || key.parent === 'memberships') && about(key.child, 'person'),
        )
        .map((key) => key.child)
      const byAccount = Object.keys(personalDataCatalogue).filter((table) => {
        const { holders, actors } = accountColumns(table)

        return holders.length + actors.length > 0
      })

      return new Set([
        ...walked(['people', 'memberships', ...first.filter(onlyAboutStaff)], onlyAboutStaff),
        ...first,
        ...byAccount,
        ...ways,
      ])
    }
  }
}

describe('the answer to a request for access', () => {
  it.each(personalSubjects)(
    'reaches every table about a %s by a key, a way of its own or a reason to leave it out',
    (subject) => {
      const reached = covered(subject)
      const missing = Object.keys(personalDataCatalogue)
        .filter((table) => about(table, subject) && !reached.has(table))
        .sort()

      expect(missing).toEqual([])
    },
  )

  it('names only tables of the catalogue in its ways and in what it leaves out', () => {
    const named = personalSubjects.flatMap((subject) => [
      accessRoots[subject],
      ...accessWays[subject],
      ...Object.keys(accessLeftOut[subject]),
    ])

    expect(named.filter((table) => !Object.hasOwn(personalDataCatalogue, table))).toEqual([])
  })

  it('reads no column that holds a key or a secret', () => {
    // Of the tables an answer may read: not those it leaves out, which are
    // invisible in a business, nor the change log, which is read by its own
    // query and withholds what the log's page withholds.
    const read = new Set(personalSubjects.flatMap((subject) => [...covered(subject)]))
    const unread = new Set([...Object.keys(accessLeftOut.person), 'audit_entries'])
    const secret = [...schema.columns.entries()]
      .filter(([table]) => read.has(table) && !unread.has(table))
      .flatMap(([table, columns]) =>
        columns.filter(soundsSecret).map((column) => `${table}.${column}`),
      )
      .sort()

    expect(secret).toEqual([])
  })
})
