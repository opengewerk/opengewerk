import type { AuditVocabulary } from '@opengewerk/platform-domain'
import { probeAuditVocabulary } from '@opengewerk/platform-domain/testing'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { probeSyncMade } from '../sync/probe-sync.js'
import { auditVocabularyGaps } from './vocabulary-gaps.js'

/**
 * The kit that holds the vocabulary of the change log against the database,
 * with an application that is nobody's (ADR 0010): the foundation and the
 * tables of the probe application, shelves, notes, letters and their lines,
 * all watched by the audit trigger.
 */

let foundation: ProbeFoundation
let admin: Pool

beforeAll(async () => {
  foundation = await probeFoundation(probeSyncMade)
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
}, 60_000)

afterAll(async () => {
  await admin.end()
  foundation.remove()
})

/** The vocabulary of the probe application with one thing changed. */
function changed(over: Partial<AuditVocabulary>): AuditVocabulary {
  return { ...probeAuditVocabulary, ...over }
}

describe('the vocabulary of the change log against the database', () => {
  it('fits for the probe application, and the foundation names its own tables in it', async () => {
    expect(await auditVocabularyGaps(admin, probeAuditVocabulary)).toEqual([])
  })

  it('finds a watched table without words, and words for a table nobody watches', async () => {
    const { letter_lines: lines, ...others } = probeAuditVocabulary.tables

    expect(lines).toBeDefined()
    expect(
      await auditVocabularyGaps(
        admin,
        changed({
          tables: { ...others, parcels: { label: 'Paket' } },
          parts: { shelves: probeAuditVocabulary.parts['shelves'] ?? [] },
          titles: { shelves: ['label'], notes: ['text'], letters: ['subject'] },
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        'table letter_lines is watched and has no words',
        'table parcels has words and is not watched',
      ]),
    )
  })

  it('finds a column nobody named', async () => {
    const gaps = await auditVocabularyGaps(
      admin,
      changed({
        tables: {
          ...probeAuditVocabulary.tables,
          shelves: { label: 'Regal', fields: { label: 'Beschriftung' } },
        },
      }),
    )

    expect(gaps).toEqual(['column shelves.closed has no name'])
  })

  it('finds a table of the foundation the application names itself', async () => {
    const gaps = await auditVocabularyGaps(
      admin,
      changed({
        tables: { ...probeAuditVocabulary.tables, memberships: { label: 'Eigener Zugang' } },
      }),
    )

    expect(gaps).toEqual(['table memberships belongs to the foundation, which names it'])
  })

  it('finds rules over tables and columns that do not exist', async () => {
    const gaps = await auditVocabularyGaps(
      admin,
      changed({
        parts: { shelves: [{ table: 'notes', column: 'rack_id' }] },
        records: ['shelves', 'parcels'],
        references: { shelf_id: 'shelves', rack_id: 'racks' },
        personFields: ['keeper_id'],
        titles: { ...probeAuditVocabulary.titles, notes: ['heading'], parcels: ['number'] },
      }),
    )

    expect(gaps.sort()).toEqual(
      [
        'part notes.rack_id of shelves',
        'record parcels, which is not watched',
        'reference rack_id to racks',
        'person field keeper_id, which no watched table has',
        'title of notes: none of its naming fields exists',
        'title of parcels, which is not watched',
      ].sort(),
    )
  })

  it('finds words of its own for a reason the foundation words', async () => {
    const gaps = await auditVocabularyGaps(
      admin,
      changed({ reasons: { tidy: 'Aufräumen', 'session.start': 'Eigene Anmeldung' } }),
    )

    expect(gaps).toEqual(["reason session.start is the foundation's, which words it"])
  })
})
