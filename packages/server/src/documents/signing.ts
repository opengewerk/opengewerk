import { type ConflictReason, type DocumentId, signedContentFingerprint } from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { documentLines, documents } from '../database/schema/index.js'

/** Why a signature may not land, in the shape a sync conflict records. */
export interface SignatureRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

/**
 * Whether a signature arriving from a device is about what this server holds.
 *
 * The device sends a fingerprint of the page the customer signed, and here it
 * is worked out again from the rows. Equal, the signature lands and freezes
 * its document. Different, somebody changed the report between the moment the
 * customer looked at it and the moment the signature arrived, usually the
 * office while the technician was still on site, and the signature is refused
 * as a conflict: it would otherwise sit under a page the customer never saw.
 *
 * Also the one place that notices a document deleted in the meantime. The sync
 * rules find a parent by id whether it is deleted or not, and the trigger that
 * signs the document would then refuse inside the transaction, taking the
 * whole transmission with it. A conflict takes only this one operation.
 */
export async function signatureRefusal(
  tx: TenantTransaction,
  values: Readonly<Record<string, unknown>>,
): Promise<SignatureRefusal | null> {
  const documentId = String(values['documentId'] ?? '') as DocumentId

  const [document] = await tx
    .select({
      introText: documents.introText,
      fieldValues: documents.fieldValues,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(eq(documents.id, documentId))

  if (!document || document.deletedAt) {
    return { reason: 'record_missing', fields: ['documentId'] }
  }

  const lines = await tx
    .select({
      id: documentLines.id,
      position: documentLines.position,
      kind: documentLines.kind,
      designation: documentLines.designation,
      description: documentLines.description,
      quantityMilli: documentLines.quantityMilli,
      unit: documentLines.unit,
    })
    .from(documentLines)
    .where(and(eq(documentLines.documentId, documentId), isNull(documentLines.deletedAt)))

  // The fields of the business (#78) are part of the page the customer read.
  const held = signedContentFingerprint({
    introText: document.introText,
    lines,
    fields: document.fieldValues,
  })

  return values['contentFingerprint'] === held
    ? null
    : { reason: 'changed_elsewhere', fields: ['contentFingerprint'] }
}
