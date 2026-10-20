import type { FileId, TenantId } from '@opengewerk/platform-domain'
import { and, eq, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { files, fileUploads } from '../database/schema/files.js'
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
 *
 * The person of the transaction is written down as holding the file
 * (`file_uploads`), whether the row was there already or not: the second
 * person to send the same bytes has them as much as the first, and may name
 * them in a record of their own (`mayNameFile`). A transaction without a
 * person, a photo sent from outside, writes nobody down.
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

  await tx.execute(sql`
    insert into ${fileUploads} (tenant_id, sha256, user_id)
    select ${tenantId}, ${blob.sha256}, asking.user_id
      from (select nullif(current_setting('app.user_id', true), '') as user_id) as asking
     where asking.user_id is not null
    on conflict do nothing`)

  return row.id
}
