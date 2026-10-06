import {
  attachmentEntity,
  type AttachmentRules,
  attachmentVersionEntity,
  fileHashProblem,
  fileSizeProblem,
  type TenantId,
} from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { files } from '../database/schema/files.js'
import type { SyncCheck, SyncRefusal } from '../sync/apply.js'
import type { RecordRule, RecordRules } from '../sync/record-rules.js'

/**
 * The rules over the fields of a file and of a version, for the record rules
 * of an application whose devices make them (`recordRulesCheck`), by entity.
 *
 * A file hangs on at least one of the records the application names: the
 * rule a screen holds by taking the places from where it stands, so that on
 * none it is a mistake only a broken client makes.
 *
 * A version has no check in the database for type, size and hash, and is here
 * all the same. Its key onto the stored files holds the hash and the size of
 * what it finds, and a version that breaks one of these is a mistake of the
 * client that should say so, not reach the key.
 */
export function attachmentRecordRules(rules: AttachmentRules): RecordRules {
  const home: RecordRule = {
    fields: rules.homes,
    problem: (at) =>
      rules.homeProblem(Object.fromEntries(rules.homes.map((field) => [field, at(field)]))),
  }

  return {
    [attachmentEntity]: [home],
    [attachmentVersionEntity]: [
      { fields: ['sha256'], problem: (at) => fileHashProblem(at('sha256')) },
      {
        fields: ['previewSha256'],
        problem: (at) => {
          const preview = at('previewSha256')

          return preview === null || preview === undefined ? null : fileHashProblem(preview)
        },
      },
      { fields: ['mediaType'], problem: (at) => rules.mediaTypeProblem(at('mediaType')) },
      {
        fields: ['sizeBytes'],
        problem: (at) => {
          const size = at('sizeBytes')

          return fileSizeProblem(typeof size === 'number' ? size : Number.NaN)
        },
      },
    ],
  }
}

/** What the foundation says to a version whose size is not the size of its file. */
export const attachmentVersionSizeMismatch = 'Die Größe der Fassung passt nicht zu ihrer Datei.'

/**
 * Whether the files a version names are there for this tenant, and whether
 * its size is theirs.
 *
 * A device uploads the bytes before it sends the version, so a missing file is
 * one whose upload never arrived, and that is a conflict about this one
 * version: the key in the database would refuse it too, but for the whole
 * transmission. A size that differs from the stored file's is a mistake only
 * the client can make, since it counted the same bytes it sent.
 *
 * Asked under row level security, like every other reference: the file of
 * another tenant is not there, whoever knows its hash.
 */
export async function attachmentVersionFileRefusal(
  tx: TenantTransaction,
  tenantId: TenantId,
  values: Readonly<Record<string, unknown>>,
): Promise<SyncRefusal | null> {
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
    return { kind: 'client', message: attachmentVersionSizeMismatch }
  }

  const preview = values['previewSha256']

  if (preview !== null && preview !== undefined && !(await stored(preview))) {
    return { kind: 'conflict', reason: 'record_missing', fields: ['previewSha256'] }
  }

  return null
}

/**
 * The check of a new version among the checks of an application's sync: a
 * version names its file by tenant and hash, a key a check of the references
 * between records does not read. Its own question: is the file there,
 * uploaded ahead of the version, and is the size the one it has.
 *
 * An application puts it in front of its check of the references, so that a
 * version whose file is missing is answered about the file.
 */
export function attachmentVersionFiles<Sender>(): SyncCheck<Sender> {
  return ({ tx, tenantId, operation, values }) =>
    operation.entity !== attachmentVersionEntity || operation.kind !== 'create'
      ? null
      : attachmentVersionFileRefusal(tx, tenantId, values)
}
