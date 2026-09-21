import type { RecordState } from '@opengewerk/domain'

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

const entities: Readonly<Record<string, string>> = {
  customers: 'Kunde',
  contacts: 'Ansprechpartner',
  sites: 'Objekt',
  installations: 'Anlage',
  distribution_boards: 'Verteiler',
  board_sections: 'Feld',
  circuits: 'Stromkreis',
  equipment: 'Betriebsmittel',
  inverters: 'Wechselrichter',
  pv_strings: 'String',
  pv_modules: 'Modul',
  jobs: 'Auftrag',
  documents: 'Beleg',
  document_lines: 'Belegposition',
}

const fields: Readonly<Record<string, string>> = {
  name: 'Name',
  kind: 'Art',
  status: 'Status',
  designation: 'Bezeichnung',
  description: 'Beschreibung',
  notes: 'Notizen',
  email: 'E-Mail',
  phone: 'Telefon',
  street: 'Straße',
  houseNumber: 'Hausnummer',
  postalCode: 'PLZ',
  city: 'Ort',
  country: 'Land',
  manufacturer: 'Hersteller',
  model: 'Typ',
  serialNumber: 'Seriennummer',
  commissionedOn: 'In Betrieb seit',
  warrantyEndsOn: 'Gewährleistung bis',
  customerId: 'Kunde',
  siteId: 'Objekt',
  installationId: 'Anlage',
  documentId: 'Beleg',
  number: 'Nummer',
  quantityMilli: 'Menge',
  unitPriceCents: 'Einzelpreis',
  netCents: 'Netto',
  vatRate: 'Steuersatz',
  taxTreatment: 'Steuerfall',
  serviceFrom: 'Leistung ab',
  serviceUntil: 'Leistung bis',
  vatId: 'USt-IdNr.',
  isBusiness: 'Unternehmen',
  isConstructionServiceRecipient: 'Bauleistungsempfänger',
}

export function entityLabel(entity: string): string {
  return entities[entity] ?? entity
}

export function fieldLabel(field: string): string {
  return fields[field] ?? field
}

/**
 * The name a record goes by on a screen, for the places that only have an id.
 *
 * A customer has a `name`, everything else a `designation`, and a document a
 * number. Nothing falls through to an empty string: a row with no name at all
 * still has to be clickable, so it says what it is.
 */
export function titleOf(entity: string, record: RecordState | null): string {
  const named =
    maybeText(record, 'name') ?? maybeText(record, 'designation') ?? maybeText(record, 'number')

  return named ?? `${entityLabel(entity)} ohne Bezeichnung`
}
