import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { backupStatus } from './backup-status.js'

/**
 * The record of the last backup, as the office reads it (#130). The schedule
 * makes a backup every night; this is what says whether it did.
 */

const now = new Date('2026-09-23T12:00:00Z')
const hours = (count: number) => new Date(now.getTime() - count * 60 * 60 * 1000)
const directories: string[] = []

function directory(record?: string): string {
  const made = mkdtempSync(join(tmpdir(), 'opengewerk-backup-status-'))

  directories.push(made)

  if (record !== undefined) {
    writeFileSync(join(made, 'last.json'), record, 'utf8')
  }

  return made
}

function record(finished: Date): string {
  return JSON.stringify({
    finished: finished.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    finishedEpoch: Math.floor(finished.getTime() / 1000),
    archive: 'opengewerk-2026-09-22T003112Z.tar.gz.age',
    bytes: 1_234_567,
    encrypted: true,
    storageFiles: 12,
    auditChains: 1,
  })
}

afterEach(() => {
  for (const made of directories.splice(0)) {
    rmSync(made, { recursive: true, force: true })
  }
})

describe('the last backup', () => {
  it('is unknown where the instance knows no record, and nothing to warn about', async () => {
    expect(await backupStatus(null, hours(24 * 30), now)).toEqual({ state: 'unknown' })
  })

  it('is recorded with when it finished, and old only after two days', async () => {
    const yesterday = await backupStatus(directory(record(hours(26))), hours(24 * 30), now)

    expect(yesterday).toEqual({
      state: 'recorded',
      finishedAt: hours(26).toISOString(),
      archive: 'opengewerk-2026-09-22T003112Z.tar.gz.age',
      bytes: 1_234_567,
      encrypted: true,
      overdue: false,
    })
    expect(await backupStatus(directory(record(hours(49))), hours(24 * 30), now)).toMatchObject({
      overdue: true,
    })
  })

  it('is missing without warning for a new business, and with one for a business of days', async () => {
    expect(await backupStatus(directory(), hours(1), now)).toEqual({
      state: 'none',
      overdue: false,
    })
    expect(await backupStatus(directory(), hours(24 * 7), now)).toEqual({
      state: 'none',
      overdue: true,
    })
  })

  it('counts a record it cannot read as none, the answer to a backup that never ran', async () => {
    for (const broken of ['{', '{"finished": "gestern"}', '[]', '"text"']) {
      expect(await backupStatus(directory(broken), hours(24 * 7), now)).toEqual({
        state: 'none',
        overdue: true,
      })
    }
  })
})
