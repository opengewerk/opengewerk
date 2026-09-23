import type { SyncConflict } from '@opengewerk/domain'

import { refusalText, type SyncClient } from '../sync/client.js'
import { maybeText } from '../sync/fields.js'
import { today } from './format.js'
import { documentKindLabel, documentKindOf } from './labels.js'

/** What of a document's head the new draft takes over. */
const headFields = [
  'customerId',
  'jobId',
  'siteId',
  'installationId',
  'subject',
  'introText',
  'closingText',
  'taxTreatment',
  'paymentTermDays',
  'serviceFrom',
  'serviceUntil',
] as const

/** What of a line the new draft takes over. The net amount the server works out itself. */
const lineFields = [
  'kind',
  'designation',
  'description',
  'quantityMilli',
  'unit',
  'unitPriceCents',
  'vatRate',
] as const

type Values = Readonly<Record<string, unknown>>

function picked(source: Values, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]),
  )
}

/**
 * The document a conflict about an issued document is about, or null when
 * there is no draft to be made from it (#139).
 *
 * A change to the head names the document itself. A line names it through
 * `documentId`: in what the device wanted when it made the line, or in the
 * line as this device has it, since a conflict holds only the fields that
 * changed. Null for any other conflict, for a document this device does not
 * know, and for a cancellation invoice, which only the server makes.
 */
export function fixedDocumentOf(client: SyncClient, conflict: SyncConflict): string | null {
  if (conflict.reason !== 'record_is_fixed') {
    return null
  }

  let documentId: unknown = null

  if (conflict.entity === 'documents') {
    documentId = conflict.recordId
  } else if (conflict.entity === 'document_lines') {
    documentId =
      conflict.wanted['documentId'] ??
      client.get('document_lines', conflict.recordId)?.['documentId']
  }

  if (typeof documentId !== 'string') {
    return null
  }

  const fixed = client.get('documents', documentId)

  return fixed && fixed['kind'] !== 'cancellation_invoice' ? documentId : null
}

/**
 * A line the device made and the server never took: it exists nowhere but in
 * what the device wanted. A change or a deletion is about a line the issued
 * document has.
 */
function isAddition(client: SyncClient, conflict: SyncConflict): boolean {
  return (
    conflict.entity === 'document_lines' &&
    Object.keys(conflict.wanted).length > 0 &&
    client.get('document_lines', conflict.recordId) === null
  )
}

export type DraftResult =
  | { readonly outcome: 'made'; readonly id: string; readonly subject: string }
  | { readonly outcome: 'refused'; readonly message: string }

/**
 * What this device wrote to a document that was issued in the meantime, as a
 * new draft (#139, ADR 0005 point 4).
 *
 * An issued document is not changed, so taking the device's version cannot
 * succeed; until now the only other way was to throw it away, and a report
 * somebody went on writing in a cellar lost what they wrote. The new draft is
 * for the same customer, site and job, and its subject names the issued
 * document. The link is in words and not in `predecessorDocumentId`, which
 * only the server sets and only for the successor that continues a chain
 * (#129); a supplement to a report is not the next link of it.
 *
 * Every conflict of the kind about the same document goes into one draft, and
 * what the draft holds depends on what the device did:
 *
 * - It only added lines, the case of the report written on after the office
 *   issued it: the draft is a supplement with those lines and nothing else,
 *   "Nachtrag zu Regiebericht RB-2026-0001". Copying the issued lines along
 *   would bill them twice.
 * - It changed the head or a line the document has, or deleted one: the draft
 *   is the whole document as the device wanted it, "Geänderte Fassung von
 *   ...". A changed quantity on its own, without the lines around it, says
 *   nothing anybody could issue.
 *
 * Through the outbox like everything else, so it works without a network and
 * passes the same rules: whoever may write the document may write this.
 */
export async function draftFromFixed(
  client: SyncClient,
  conflicts: readonly SyncConflict[],
  documentId: string,
): Promise<DraftResult> {
  const fixed = client.get('documents', documentId)

  if (!fixed) {
    return {
      outcome: 'refused',
      message: 'Den festgeschriebenen Beleg kennt dieses Gerät nicht mehr.',
    }
  }

  const group = conflicts.filter((conflict) => fixedDocumentOf(client, conflict) === documentId)
  const supplement = group.every((conflict) => isAddition(client, conflict))
  const head = group.find((conflict) => conflict.entity === 'documents')
  const number = maybeText(fixed, 'number')
  const kind = documentKindOf(fixed)
  const named = `${documentKindLabel[kind]}${number ? ` ${number}` : ''}`
  const reference = supplement ? `Nachtrag zu ${named}` : `Geänderte Fassung von ${named}`
  const values = { ...picked(fixed, headFields), ...picked(head?.wanted ?? {}, headFields) }
  const given = typeof values['subject'] === 'string' ? values['subject'].trim() : ''
  const subject = given === '' ? reference : `${reference}: ${given}`

  const lines = new Map<string, Values>()

  if (!supplement) {
    for (const line of client.list('document_lines')) {
      if (line['documentId'] === documentId) {
        lines.set(String(line['id']), line)
      }
    }
  }

  for (const conflict of group) {
    if (conflict.entity !== 'document_lines') {
      continue
    }

    // A deletion wants nothing written, and a line the device deleted is not
    // part of what it wanted the document to be.
    if (Object.keys(conflict.wanted).length === 0 || conflict.wanted['deletedAt']) {
      lines.delete(conflict.recordId)
      continue
    }

    lines.set(conflict.recordId, {
      ...(lines.get(conflict.recordId) ?? conflict.found),
      ...conflict.wanted,
    })
  }

  const made = await client.create('documents', {
    ...values,
    kind,
    subject,
    documentDate: today(),
  })

  if (made.outcome === 'refused') {
    return { outcome: 'refused', message: refusalText[made.reason] }
  }

  const ordered = [...lines.values()].sort(
    (left, right) => Number(left['position'] ?? 0) - Number(right['position'] ?? 0),
  )

  for (const [index, line] of ordered.entries()) {
    const written = await client.create('document_lines', {
      ...picked(line, lineFields),
      documentId: made.id,
      position: index + 1,
    })

    if (written.outcome === 'refused') {
      return { outcome: 'refused', message: refusalText[written.reason] }
    }
  }

  return { outcome: 'made', id: made.id, subject }
}
