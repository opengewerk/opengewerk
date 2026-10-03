import { quantityFactor } from '@opengewerk/domain'
import type { SyncValue } from '@opengewerk/domain'
import type { ConflictWay, RecordWords } from '@opengewerk/platform-web'
import { amount, euros } from '@opengewerk/platform-web/format'

import { draftFromFixed, fixedDocumentOf } from './fixed-draft.js'
import { lineUnitLabel, vatRateLabel } from './labels.js'
import { entityLabel, fieldLabel, titleOf } from './naming.js'

/**
 * What this application says about its records where a screen of the
 * foundation shows one it knows only by name (ADR 0010): the screens of the
 * conflicts in both entries.
 */

/**
 * A value the way the document screen shows it: a line reads "2" and
 * "48,50 €", not 2000 and 4850. Null for everything else, which the foundation
 * writes as it is.
 */
function valueText(field: string, value: SyncValue): string | null {
  if (typeof value === 'number' && field === 'quantityMilli') {
    return amount(value)
  }

  if (typeof value === 'number' && field === 'unitPriceCents') {
    return euros(value)
  }

  if (typeof value === 'number' && field === 'priceBase') {
    return `je ${amount(value * quantityFactor)}`
  }

  if (typeof value === 'string' && field === 'unit' && Object.hasOwn(lineUnitLabel, value)) {
    return lineUnitLabel[value as keyof typeof lineUnitLabel]
  }

  if (typeof value === 'string' && field === 'vatRate' && Object.hasOwn(vatRateLabel, value)) {
    return vatRateLabel[value as keyof typeof vatRateLabel]
  }

  return null
}

/**
 * Fields of a line that say where it hangs and where it sits, not what it
 * says. On the card for an issued document they would be rows nobody can do
 * anything with, and the new draft sets all three itself.
 */
const placement = new Set(['documentId', 'position', 'kind'])

/**
 * The order of the document screen, head first and a line as it reads.
 *
 * What the device wanted arrives as `jsonb`, and PostgreSQL hands its keys back
 * shortest first: a line would read unit, rate, designation. Fields not in the
 * list keep their order behind the rest.
 */
const documentOrder = [
  'subject',
  'introText',
  'closingText',
  'serviceFrom',
  'serviceUntil',
  'paymentTermDays',
  'designation',
  'description',
  'quantityMilli',
  'unit',
  'unitPriceCents',
  'priceBase',
  'vatRate',
]

function inDocumentOrder(fields: readonly string[]): string[] {
  const rank = (field: string) => {
    const at = documentOrder.indexOf(field)

    return at === -1 ? documentOrder.length : at
  }

  return [...fields].sort((left, right) => rank(left) - rank(right))
}

/**
 * A change to a document that was issued in the meantime cannot win: the
 * document is not changed any more, and taking the device's version is
 * refused again. The choice there is a new draft or the state in the system
 * (#139, ADR 0005 point 4), and the new draft takes every such change to the
 * same document at once, see `draftFromFixed`.
 */
const newDraft: ConflictWay = {
  groupOf: fixedDocumentOf,
  fields: (wanted) => inDocumentOrder(Object.keys(wanted).filter((field) => !placement.has(field))),
  explanation:
    'Der Beleg ist inzwischen festgeschrieben und wird nicht mehr geändert. Was auf diesem ' +
    'Gerät dazukam oder geändert wurde, lässt sich als neuer Entwurf für denselben Kunden und ' +
    'Auftrag anlegen; sein Betreff nennt den festgeschriebenen Beleg. Sonst bleibt es beim ' +
    'Stand im System.',
  action: 'Als neuen Entwurf anlegen',
  take: async (client, conflicts, documentId) => {
    const result = await draftFromFixed(client, conflicts, documentId)

    return result.outcome === 'made' ? { outcome: 'made', summary: result.subject } : result
  },
  madeLabel: 'Als neuer Entwurf angelegt',
  made: (subject) =>
    `Entwurf angelegt: ${subject}. Er gehört zum selben Kunden und Auftrag wie der ` +
    'festgeschriebene Beleg.',
  stillOpen:
    'Der Entwurf ist angelegt. Die Konflikte lassen sich erst mit Verbindung schließen, ' +
    'dann mit "Stand im System behalten".',
}

export const records: RecordWords = {
  entityLabel,
  fieldLabel,
  titleOf,
  valueText,
  /**
   * A signature is refused when the report changed while the customer was
   * signing, and taken anyway it would stand under a page the customer never
   * saw, which is the whole of what the refusal prevents. The way on is a new
   * signature on the report as it is now, and that is what the card says
   * instead of offering a choice that is not one.
   */
  settledElsewhere: {
    document_signatures:
      'Die Unterschrift gilt nicht, weil sich der Bericht geändert hat, während unterschrieben ' +
      'wurde. Der Bericht ist wieder offen; bitte ansehen und noch einmal unterschreiben lassen.',
  },
  otherWay: newDraft,
}
