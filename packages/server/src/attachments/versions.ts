import type { TenantId } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { files } from '../database/schema/index.js'

/** Why a version from a device cannot land, in the two shapes the sync answers with. */
export type VersionRefusal =
  | { readonly kind: 'client'; readonly message: string }
  | {
      readonly kind: 'conflict'
      readonly reason: 'record_missing'
      readonly fields: readonly string[]
    }

/**
 * Whether the files a version of an attachment names are there for this
 * business, and whether its size is theirs (#77).
 *
 * A device uploads the bytes before it sends the version, so a missing file is
 * one whose upload never arrived, and that is a conflict about this one
 * version: the key in the database would refuse it too, but for the whole
 * transmission. A size that differs from the stored file's is a mistake only
 * the client can make, since it counted the same bytes it sent.
 *
 * Asked under row level security, like every other reference: the file of
 * another business is not there, whoever knows its hash.
 */
export async function versionFileRefusal(
  tx: TenantTransaction,
  tenantId: TenantId,
  values: Readonly<Record<string, unknown>>,
): Promise<VersionRefusal | null> {
  const stored = async (hash: unknown) => {
    const [row] = await tx
      .select({ sizeBytes: files.sizeBytes })
      .from(files)
      .where(and(eq(files.tenantId, tenantId), eq(files.sha256, String(hash))))

    return row ?? null
  }

  const file = await stored(values['sha256'])

  if (!file) {
    return { kind: 'conflict', reason: 'record_missing', fields: ['sha256'] }
  }

  if (file.sizeBytes !== values['sizeBytes']) {
    return { kind: 'client', message: 'Die Größe der Fassung passt nicht zu ihrer Datei.' }
  }

  const preview = values['previewSha256']

  if (preview !== null && preview !== undefined && !(await stored(preview))) {
    return { kind: 'conflict', reason: 'record_missing', fields: ['previewSha256'] }
  }

  return null
}
