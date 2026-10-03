import type { FileId, TenantId } from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { files } from '../database/schema/files.js'
import type { StoredBlob } from './store.js'

/**
 * The row that makes a stored file belong to a tenant, created if it is not
 * there yet. Returns its id either way.
 *
 * Content and tenant decide whether it exists, not the upload. The same bytes
 * stored twice by one tenant are one file, and the second call finds the row
 * the first one wrote. A second tenant storing the same bytes gets a row of
 * its own, pointing at the same file on disk, and that is the whole sharing
 * there is: each of them reaches it through its own row.
 *
 * DO NOTHING is safe here, unlike in the audit chain. Two transactions
 * inserting the same file meet at the unique index, the second waits for the
 * first to commit, and the select that follows sees the row either way.
 */
export async function fileRowFor(
  tx: TenantTransaction,
  tenantId: TenantId,
  blob: StoredBlob,
  mediaType: string,
): Promise<FileId> {
  await tx
    .insert(files)
    .values({ tenantId, sha256: blob.sha256, sizeBytes: blob.sizeBytes, mediaType })
    .onConflictDoNothing({ target: [files.tenantId, files.sha256] })

  const [row] = await tx
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.tenantId, tenantId), eq(files.sha256, blob.sha256)))

  if (!row) {
    throw new Error(`The file ${blob.sha256} was stored and is not readable afterwards.`)
  }

  return row.id
}
