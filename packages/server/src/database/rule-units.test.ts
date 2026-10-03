import { ruleUnits } from '@opengewerk/domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyMigrations, connect, resetSchema } from './test-database.js'

// The units a setting of a business is counted in are an enum in the database
// and a list in the foundation (`ruleUnits`), and the schema makes the one
// from the other. A unit added to the list without a migration passes every
// test that does not read the catalogue, and turns up as statements in the
// next migration somebody generates for something else. This reads it.

let admin: Pool

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
})

afterAll(async () => {
  await admin.end()
})

describe('the units of the rule engine', () => {
  it('are in the database what the list says, in its order', async () => {
    const { rows } = await admin.query<{ label: string }>(
      `select enumlabel as label from pg_enum
        where enumtypid = 'rule_unit'::regtype
        order by enumsortorder`,
    )

    expect(rows.map((row) => row.label)).toEqual([...ruleUnits])
  })
})
