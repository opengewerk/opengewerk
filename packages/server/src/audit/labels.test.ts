import { auditVocabulary } from '@opengewerk/domain'
import { auditVocabularyGaps } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyMigrations, connect, resetSchema } from '../database/test-database.js'

/**
 * The words of the change log against the database (#285). The owner reads
 * "Kunde, Straße" and never `customers.street`: every table the audit trigger
 * watches has a name, every column of it has one, and the rules that walk the
 * log only name columns that exist. The foundation asks the catalogue
 * (ADR 0010); a new column without a German name fails here instead of
 * showing up as a column name in front of the owner.
 */

let admin: Pool

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
})

afterAll(async () => {
  await admin.end()
})

describe('the words of the change log', () => {
  it('name every table and column the triggers watch, through columns that exist', async () => {
    expect(await auditVocabularyGaps(admin, auditVocabulary)).toEqual([])
  })
})
