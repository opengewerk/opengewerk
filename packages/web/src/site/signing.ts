import type { RecordState, SignedContent } from '@opengewerk/domain'
import { count } from '@opengewerk/platform-web/sync'

import { lineKindOf, lineUnitOf } from '../app/labels.js'

/**
 * What the customer is shown and signs, read off the records as this device
 * holds them.
 *
 * The fallbacks are the server's own defaults and nothing else. The server
 * works the fingerprint out again from its rows, and a field the device never
 * sent is on the server with its default; reading it here as anything else
 * would make every signature on such a line a conflict. `kind` is the one of
 * these fields with a default in the table, and `lineKindOf` falls back to
 * that same `item`.
 */
export function signedContentOf(report: RecordState, lines: readonly RecordState[]): SignedContent {
  const introText = report['introText']
  const fields = report['fieldValues']

  return {
    introText: typeof introText === 'string' ? introText : null,
    // The fields of the business (#78), as the text the report carries.
    fields: typeof fields === 'string' ? fields : null,
    lines: lines.map((line) => {
      const designation = line['designation']
      const description = line['description']

      return {
        id: String(line['id']),
        position: count(line, 'position'),
        kind: lineKindOf(line),
        designation: typeof designation === 'string' ? designation : '',
        description: typeof description === 'string' ? description : null,
        quantityMilli: count(line, 'quantityMilli'),
        unit: lineUnitOf(line),
      }
    }),
  }
}
