import {
  auditVocabulary,
  cableInstallationMethodLabel,
  distributionBoardKindLabel,
  type NumberRangeKey,
  overcurrentDeviceLabel,
  rcdTypeLabel,
  tripCharacteristicLabel,
} from '@opengewerk/domain'
import { elektroRegistry } from '@opengewerk/gewerk-elektro'
import type { AuditScreenWords } from '@opengewerk/platform-web/office'

import { documentStateLabel } from '../app/document-state.js'
import {
  customerKindLabel,
  documentKindLabel,
  installationKindLabel,
  jobKindLabel,
  jobStatusLabel,
  lineUnitLabel,
  snippetPurposeLabel,
  taskStatusLabel,
  taxTreatmentLabel,
  vatRateLabel,
} from '../app/labels.js'
import { timeEntryKindLabel } from '../app/time.js'

/**
 * The change log of the business in the words of the office (#285): what the
 * values of its fields are called and where its records are opened. The
 * screen and the rules under it are the foundation's (ADR 0010); the log holds
 * text as the database wrote it, `issued` or `12500`, and the owner reads
 * "Festgeschrieben" and "125,00 €".
 */

type Words = Readonly<Record<string, string>>

const numberRangeWords: Readonly<Record<NumberRangeKey, string>> = {
  job: 'Aufträge',
  quote: 'Angebote',
  order_confirmation: 'Auftragsbestätigungen',
  delivery_note: 'Lieferscheine',
  report: 'Regieberichte',
  invoice: 'Rechnungen',
}

/** The forms of the trade packages by their key, "Prüfprotokoll Erstprüfung nach DIN VDE 0100-600". */
const formWords: Words = Object.fromEntries(
  elektroRegistry.current().map((definition) => [definition.key, definition.title]),
)

/** Where a record is opened in the office, for the records that have a screen. */
const screens: Words = {
  customers: '/kunden/',
  sites: '/objekte/',
  installations: '/anlagen/',
  jobs: '/auftraege/',
  documents: '/belege/',
  distribution_boards: '/verteiler/',
  circuits: '/stromkreise/',
  inverters: '/wechselrichter/',
  pv_strings: '/strings/',
  form_records: '/pruefprotokolle/',
  articles: '/artikel/',
  suppliers: '/lieferanten/',
}

/** The label of the link to a record, "Zum Kunden". */
const links: Words = {
  customers: 'Zum Kunden',
  sites: 'Zum Objekt',
  installations: 'Zur Anlage',
  jobs: 'Zum Auftrag',
  documents: 'Zum Beleg',
  distribution_boards: 'Zum Verteiler',
  circuits: 'Zum Stromkreis',
  inverters: 'Zum Wechselrichter',
  pv_strings: 'Zum String',
  form_records: 'Zum Protokoll',
  articles: 'Zum Artikel',
  suppliers: 'Zum Lieferanten',
}

/** What happened to a document where one word says it. */
const documentSteps: Words = {
  issued: 'Festgeschrieben',
  cancelled: 'Storniert',
  signed: 'Unterschrieben',
}

export const auditScreenWords: AuditScreenWords = {
  vocabulary: auditVocabulary,
  values: {
    customers: { kind: customerKindLabel },
    installations: { kind: installationKindLabel },
    jobs: { kind: jobKindLabel, status: jobStatusLabel },
    tasks: { status: taskStatusLabel },
    documents: {
      kind: documentKindLabel,
      status: documentStateLabel,
      tax_treatment: taxTreatmentLabel,
    },
    document_lines: { unit: lineUnitLabel, vat_rate: vatRateLabel },
    text_snippets: { purpose: snippetPurposeLabel },
    distribution_boards: { kind: distributionBoardKindLabel },
    circuits: {
      overcurrent_device: overcurrentDeviceLabel,
      trip_characteristic: tripCharacteristicLabel,
      rcd_type: rcdTypeLabel,
      cable_installation_method: cableInstallationMethodLabel,
    },
    time_entries: { kind: timeEntryKindLabel },
    number_ranges: { key: numberRangeWords },
    form_records: { definition_key: formWords },
  },
  lists: { kinds: documentKindLabel },
  // Keys of a browser, never shown, only that they are set.
  hidden: ['p256dh', 'auth', 'endpoint'],
  fingerprints: ['sha256', 'preview_sha256', 'content_fingerprint'],
  summary(change) {
    const status = change.fields.find((field) => field.field === 'status')

    return change.table === 'documents' && status?.after
      ? (documentSteps[status.after] ?? null)
      : null
  },
  kindOf: (table, kind) =>
    table === 'documents' && kind ? ((documentKindLabel as Words)[kind] ?? 'Beleg') : null,
  href: (table, id) => {
    const start = screens[table]

    return start ? `${start}${id}` : null
  },
  linkWords: (table) => links[table] ?? null,
  partsWords: {
    customers: 'mit seinen Ansprechpartnern',
    sites: 'mit seinen Ansprechpartnern',
    installations: 'mit ihrer Struktur',
    jobs: 'mit Notizen und Einteilung',
    documents: 'mit Positionen, Unterschrift und Zahlungen',
  },
}
