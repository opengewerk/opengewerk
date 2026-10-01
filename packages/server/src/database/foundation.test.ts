import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, foundationDeviations } from './test-database.js'

// The foundation of this application came about over sixty migrations, and
// since ADR 0010 it is also a set of building blocks a new application starts
// from. This holds the two against each other: a database built from the
// blocks alone, and this one after every migration.
//
// It is the migrations that are right. Each of them has run on somebody's
// installation and stays as it is; a deviation therefore means a block has to
// follow, or that a migration changed the foundation without anybody noticing
// that it is the foundation.

let admin: Pool

beforeAll(async () => {
  admin = await connect()
})

afterAll(async () => {
  await admin.end()
})

describe('the foundation in this database', () => {
  it('is what its building blocks say, after every migration', async () => {
    const deviations = await foundationDeviations(admin, {
      // The log of the instance (#188) records a business being created or
      // removed. The instance area is still this application's own and moves
      // into the foundation with it.
      triggers: ['tenants.instance_changes'],
    })

    expect(deviations).toEqual([])
  })
})
