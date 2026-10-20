import { sql } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { type RepeatingJob, startRepeating } from '../start/repeat.js'
import type { FileStorage } from './store.js'

/**
 * How long a file stays in the store with no row naming it (#657). A route
 * stores the bytes and writes the row of the file a moment later, in the same
 * request; a day is far beyond that, and a put of the same bytes makes a file
 * new again. A file a restore brought back with no row stays a day too, and
 * whatever the restore brought back with its row stays for good.
 */
export const fileSweepGraceMs = 24 * 60 * 60 * 1000

/**
 * Takes out of the store every file older than the grace that no tenant holds
 * any more (#657), and says how many went. The rows of a file are deleted
 * only on the ways an application opens for it (#658); this takes out the
 * bytes once the last row is gone.
 *
 * Which names any tenant still holds is asked of `files_held`, which runs as
 * the owner of the tables: the run works for every tenant and acts for no
 * person, like the other jobs in the background.
 */
export async function sweepFileStore(
  database: Database,
  store: FileStorage,
  now: Date = new Date(),
): Promise<number> {
  if (store.sweep === undefined) {
    return 0
  }

  return store.sweep(
    async (names) => {
      // The names are hashes, hex and nothing else, so a comma parts them.
      const result = await database.forInstance((tx) =>
        tx.execute<{ sha256: string }>(
          sql`select held as sha256 from files_held(string_to_array(${names.join(',')}, ',')) as held`,
        ),
      )

      return new Set(result.rows.map((row) => row.sha256))
    },
    new Date(now.getTime() - fileSweepGraceMs),
  )
}

/**
 * The sweep of the store as a job of an instance: an hour after the start,
 * then once a day. Not on a closed instance, which writes nothing; the
 * application decides that and does not start it there.
 */
export function startFileSweep(
  database: Database,
  store: FileStorage,
  complain?: (line: string, error: unknown) => void,
): RepeatingJob {
  return startRepeating({
    run: () => sweepFileStore(database, store),
    intervalMs: 24 * 60 * 60 * 1000,
    firstAfterMs: 60 * 60 * 1000,
    failure:
      'Das Aufräumen des Dateispeichers ist gescheitert, der nächste Lauf kommt in einem Tag.',
    ...(complain === undefined ? {} : { complain }),
  })
}
