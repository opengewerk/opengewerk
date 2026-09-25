import { type RecordState, syncEntityNames, syncFieldNames } from '@opengewerk/domain'

import { maybeText } from '../sync/fields.js'

/**
 * What a kind of record and a field are called in German.
 *
 * Unlike the labels for the enums, these two fall back to the raw name rather
 * than refusing to compile. The set of fields is open: a conflict can arrive
 * from a newer server about a column this build has never heard of, and
 * showing `quantityMilli` beside two values is far better than showing an
 * empty cell or nothing at all. It is also visibly a gap, which is the point.
 */

export function entityLabel(entity: string): string {
  return syncEntityNames[entity] ?? entity
}

export function fieldLabel(field: string): string {
  return syncFieldNames[field] ?? field
}

/**
 * The name a record goes by on a screen, for the places that only have an id.
 *
 * A customer has a `name`, most things a `designation`, a task a `title`, a
 * document a number, a signature the person who gave it and a contact a given
 * and a family name. Nothing falls through to an empty string: a row with no
 * name at all still has to be clickable, so it says what it is.
 */
export function titleOf(entity: string, record: RecordState | null): string {
  const named =
    maybeText(record, 'name') ??
    maybeText(record, 'designation') ??
    maybeText(record, 'title') ??
    maybeText(record, 'number') ??
    maybeText(record, 'signerName') ??
    maybeText(record, 'fileName') ??
    personName(record)

  return named ?? `${entityLabel(entity)} ohne Bezeichnung`
}

/** Given and family name as one, or null when a record has neither. */
export function personName(record: RecordState | null): string | null {
  const parts = [maybeText(record, 'givenName'), maybeText(record, 'familyName')].filter(
    (part): part is string => part !== null,
  )

  return parts.length > 0 ? parts.join(' ') : null
}
