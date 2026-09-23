import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type BackupStatus, backupOverdueAfterHours } from '@opengewerk/domain'

/** What `backup.sh` writes after every backup, as far as the office needs it. */
interface Record {
  readonly finished: string
  readonly archive: string
  readonly bytes: number
  readonly encrypted: boolean
}

function recordOf(text: string): Record | null {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const { finished, archive, bytes, encrypted } = value as { readonly [key: string]: unknown }

  return typeof finished === 'string' &&
    !Number.isNaN(Date.parse(finished)) &&
    typeof archive === 'string' &&
    typeof bytes === 'number' &&
    typeof encrypted === 'boolean'
    ? { finished, archive, bytes, encrypted }
    : null
}

/**
 * The last backup of the instance and whether it is too old (#130).
 *
 * Read from the record `backup.sh` writes into `directory` after every backup,
 * the nightly one and one made by hand alike. The application sees that record
 * and nothing else: the archives hold every business of the instance, and the
 * application reaches the data of each only through row level security.
 *
 * `since` is the moment a missing backup starts to count, the day the business
 * was set up. An hour old, it has no backup yet and is not warned about it; a
 * week old without one, it is. A record that cannot be read counts as none,
 * the same answer an operator gets from a backup that never ran.
 */
export async function backupStatus(
  directory: string | null,
  since: Date,
  now: Date = new Date(),
): Promise<BackupStatus> {
  if (directory === null) {
    return { state: 'unknown' }
  }

  const limit = backupOverdueAfterHours * 60 * 60 * 1000
  let text: string

  try {
    text = await readFile(join(directory, 'last.json'), 'utf8')
  } catch {
    return { state: 'none', overdue: now.getTime() - since.getTime() > limit }
  }

  const record = recordOf(text)

  if (record === null) {
    return { state: 'none', overdue: now.getTime() - since.getTime() > limit }
  }

  return {
    state: 'recorded',
    finishedAt: new Date(record.finished).toISOString(),
    archive: record.archive,
    bytes: record.bytes,
    encrypted: record.encrypted,
    overdue: now.getTime() - Date.parse(record.finished) > limit,
  }
}
