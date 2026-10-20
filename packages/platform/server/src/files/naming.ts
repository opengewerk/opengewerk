import { eq, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from '../database/database.js'
import { fileUploads } from '../database/schema/files.js'

/**
 * Where a file is named already: a column of a table that holds hashes, asked
 * under the policies of the person, or a question of the application's own,
 * for a place that is not a plain column (a list of files in one value) or
 * that a person sees by more than the policies of its table.
 */
export type FilePlace =
  AnyPgColumn | ((tx: TenantTransaction, sha256: string) => Promise<boolean> | boolean)

/**
 * Whether the person of the transaction may name a stored file in a record:
 * when they stored it themselves (`file_uploads`, written by `fileRowFor`),
 * or when a row they see names it already, in one of the places the
 * application lists.
 *
 * The row of a file is one for the whole tenant, while the records that name
 * files lie in areas and behind rights. A record that names a file is how its
 * bytes are handed out, so a hash taken from anywhere, a record of another
 * area seen once, a log, would otherwise open the file through a record of
 * the person's own. Having sent the bytes is the proof of having them, and a
 * row that is in reach shows the file anyway.
 *
 * Asked in the transaction of the request, so the policies of the person
 * decide what is in reach: the tenant, and the areas wherever an application
 * has them. A place the application lets through to more people than may read
 * the file there is to be named as a question of its own that asks what the
 * route that hands the file out asks.
 *
 * Every route and every check of the sync that takes a hash for a record asks
 * this, and answers a file that may not be named exactly like one that is not
 * there, so that the answer does not say whether it exists.
 */
export async function mayNameFile(
  tx: TenantTransaction,
  sha256: string,
  places: readonly FilePlace[] = [],
): Promise<boolean> {
  // The policy of the table shows a person their own rows and no others
  // (`heldByThePersonAsking`), so a row here is one of the person asking.
  const [stored] = await tx
    .select({ id: fileUploads.id })
    .from(fileUploads)
    .where(eq(fileUploads.sha256, sha256))
    .limit(1)

  if (stored) {
    return true
  }

  for (const place of places) {
    if (typeof place === 'function') {
      if (await place(tx, sha256)) {
        return true
      }

      continue
    }

    const [named] = await tx
      .select({ one: sql<number>`1` })
      .from(place.table)
      .where(eq(place, sha256))
      .limit(1)

    if (named) {
      return true
    }
  }

  return false
}
