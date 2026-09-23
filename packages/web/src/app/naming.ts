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
  document_signatures: 'Unterschrift',
  tasks: 'Aufgabe',
  attachments: 'Datei',
  attachment_versions: 'Fassung einer Datei',
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
  givenName: 'Vorname',
  familyName: 'Nachname',
  role: 'Rolle',
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
  jobId: 'Auftrag',
  title: 'Titel',
  dueOn: 'Fällig am',
  assigneeUserId: 'Verantwortlich',
  installationId: 'Anlage',
  documentId: 'Beleg',
  number: 'Nummer',
  quantityMilli: 'Menge',
  unit: 'Einheit',
  unitPriceCents: 'Einzelpreis',
  netCents: 'Netto',
  vatRate: 'Steuersatz',
  taxTreatment: 'Steuerfall',
  documentDate: 'Belegdatum',
  subject: 'Betreff',
  introText: 'Text über den Positionen',
  closingText: 'Text unter den Positionen',
  position: 'Stelle',
  predecessorDocumentId: 'Vorgänger',
  serviceFrom: 'Leistung ab',
  serviceUntil: 'Leistung bis',
  vatId: 'USt-IdNr.',
  buyerReference: 'Käuferreferenz',
  isBusiness: 'Unternehmen',
  isConstructionServiceRecipient: 'Bauleistungsempfänger',
  signerName: 'Unterschrieben von',
  signedAt: 'Unterschrieben am',
  deviceInfo: 'Gerät',
  path: 'Unterschrift',
  contentFingerprint: 'Unterschriebener Stand',
  location: 'Ort',
  distributionBoardId: 'Verteiler',
  boardSectionId: 'Feld',
  circuitId: 'Stromkreis',
  consumer: 'Verbraucher',
  overcurrentDevice: 'Schutzeinrichtung',
  tripCharacteristic: 'Charakteristik',
  ratedCurrentMilli: 'Nennstrom',
  rcdType: 'RCD-Typ',
  ratedResidualCurrentMilli: 'Bemessungsdifferenzstrom',
  cableType: 'Leitungstyp',
  cableCores: 'Aderzahl',
  cableCrossSectionMilli: 'Querschnitt',
  cableLengthMilli: 'Leitungslänge',
  cableInstallationMethod: 'Verlegeart',
  attachmentId: 'Datei',
  fileName: 'Dateiname',
  mediaType: 'Dateityp',
  sizeBytes: 'Größe',
  sha256: 'Prüfsumme',
  previewSha256: 'Vorschau',
  createdBy: 'Angelegt von',
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
