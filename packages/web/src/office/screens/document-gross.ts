import type { RecordState } from '@opengewerk/domain'
import { showsPrices } from '@opengewerk/domain'
import { useMemo } from 'react'

import { documentKindOf } from '../../app/labels.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecords } from '../../sync/provider.js'
import { inOrder, totalsOf } from './document-lines.js'

/**
 * The gross amount of every document, by id, for the lists that show one
 * (#219): the belege of a customer, the list of all of them.
 *
 * Worked out from the lines on the device, with the same function and the
 * same rules as the screen of a document, because a document carries no total
 * of its own over the sync. Null for a document without prices, a report, and
 * for one whose date the rules do not cover; a list shows nothing there rather
 * than a figure it cannot stand behind.
 */
export function useGrossByDocument(): ReadonlyMap<string, number | null> {
  const documents = useRecords('documents')
  const lines = useRecords('document_lines')

  return useMemo(() => {
    const linesOf = new Map<string, RecordState[]>()

    for (const line of lines) {
      const key = text(line, 'documentId')
      const list = linesOf.get(key) ?? []

      list.push(line)
      linesOf.set(key, list)
    }

    const byId = new Map(documents.map((document) => [String(document['id']), document]))
    const gross = new Map<string, number | null>()

    for (const document of documents) {
      const id = String(document['id'])
      const kind = documentKindOf(document)

      if (!showsPrices(kind)) {
        gross.set(id, null)
        continue
      }

      // A cancellation is taxed at the date of the invoice it takes back.
      const original =
        kind === 'cancellation_invoice'
          ? (byId.get(maybeText(document, 'predecessorDocumentId') ?? '') ?? null)
          : null
      const totals = totalsOf(document, inOrder(linesOf.get(id) ?? []), original)

      gross.set(id, typeof totals === 'string' ? null : totals.grossCents)
    }

    return gross
  }, [documents, lines])
}
