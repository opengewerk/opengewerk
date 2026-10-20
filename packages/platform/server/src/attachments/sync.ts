import {
  attachmentEntity,
  type AttachmentRules,
  attachmentVersionEntity,
  fileHashProblem,
  fileSizeProblem,
  type TenantId,
} from '@opengewerk/platform-domain'
import { and, eq, isNull, or } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import type {
  AttachmentsTable,
  AttachmentVersionsTable,
  OwnAttachmentColumns,
} from '../database/schema/attachments.js'
import { files } from '../database/schema/files.js'
import { type FilePlace, mayNameFile } from '../files/naming.js'
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
 * Whether the files a version names are there for this tenant and the person
 * may name them, and whether its size is theirs.
 *
 * A device uploads the bytes before it sends the version, so a missing file is
 * one whose upload never arrived, and that is a conflict about this one
 * version: the key in the database would refuse it too, but for the whole
 * transmission. A size that differs from the stored file's is a mistake only
 * the client can make, since it counted the same bytes it sent.
 *
 * Asked under row level security, like every other reference: the file of
 * another tenant is not there, whoever knows its hash. And a file of the
 * tenant is there for the version only when the person sending it stored it,
 * or a row in reach names it already (`mayNameFile`, with the places the
 * application lists): the preview as much as the file, since both are handed
 * out through the version. One the person may not name is answered like one
 * that is missing.
 */
export async function attachmentVersionFileRefusal(
  tx: TenantTransaction,
  tenantId: TenantId,
  values: Readonly<Record<string, unknown>>,
  places: readonly FilePlace[] = [],
): Promise<SyncRefusal | null> {
  const stored = async (hash: unknown) => {
    const [row] = await tx
      .select({ sizeBytes: files.sizeBytes })
      .from(files)
      .where(and(eq(files.tenantId, tenantId), eq(files.sha256, String(hash))))

    return row && (await mayNameFile(tx, String(hash), places)) ? row : null
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
 * The versions of an application as a place a file may be named from
 * (`mayNameFile`): a version in reach of the person, of a file not removed
 * from the records, that has these bytes as its file or as its preview. That
 * is what the routes of the files hand out (`attachmentParts`), so a file
 * laid over one document may be laid over another by whoever can open it
 * there.
 *
 * An application whose routes ask more than the policies before they hand
 * out a file (`readable`) names a question of its own instead, one that asks
 * the same.
 */
export function attachmentVersionPlace<
  Own extends OwnAttachmentColumns,
  VersionOwn extends OwnAttachmentColumns,
>(tables: {
  readonly attachments: AttachmentsTable<Own>
  readonly attachmentVersions: AttachmentVersionsTable<VersionOwn>
}): FilePlace {
  const attachments = tables.attachments as unknown as AttachmentsTable
  const versions = tables.attachmentVersions as unknown as AttachmentVersionsTable

  return async (tx, sha256) => {
    const [named] = await tx
      .select({ id: versions.id })
      .from(versions)
      .innerJoin(
        attachments,
        and(eq(attachments.tenantId, versions.tenantId), eq(attachments.id, versions.attachmentId)),
      )
      .where(
        and(
          isNull(attachments.deletedAt),
          or(eq(versions.sha256, sha256), eq(versions.previewSha256, sha256)),
        ),
      )
      .limit(1)

    return named !== undefined
  }
}

/**
 * The check of a new version among the checks of an application's sync: a
 * version names its file by tenant and hash, a key a check of the references
 * between records does not read. Its own question: is the file there,
 * uploaded ahead of the version by the person sending it or named in a row
 * of one of the places the application lists, and is the size the one it has.
 *
 * The places are where else a file may come from: the versions of the
 * application themselves, for a file laid again over another document, and
 * whatever else of its records names files. Where a version is handed out to
 * fewer people than its policies let see it, the application names its
 * versions as a question that asks the same.
 *
 * An application puts it in front of its check of the references, so that a
 * version whose file is missing is answered about the file.
 */
export function attachmentVersionFiles<Sender>(
  places: readonly FilePlace[] = [],
): SyncCheck<Sender> {
  return ({ tx, tenantId, operation, values }) =>
    operation.entity !== attachmentVersionEntity || operation.kind !== 'create'
      ? null
      : attachmentVersionFileRefusal(tx, tenantId, values, places)
}
