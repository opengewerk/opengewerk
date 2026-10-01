import { referenceChecks } from '@opengewerk/platform-server'

// The check is the foundation's (ADR 0010): it reads the references of a table
// off its foreign keys. What it cannot read off a schema is in this file, the
// two lists of this application and the words of its sentence.
//
// Three keys fall outside the check on purpose. The person of a task points
// at the membership by user and not by id, and `assigneeRefusal` asks the
// question that goes with it, whether that person may still be given work. The
// key from a circuit to its section pairs the section with the board and
// carries no tenant; the board's own key holds the business, and the section's
// check lives with the structure. A version of an attachment names its file by
// hash, which a device knows before any row exists, and `versionFileRefusal`
// asks whether the upload arrived.

/**
 * The references that may name a record marked as deleted, per table. A
 * showing of a value, written on a device without a network, has to arrive
 * even when the office deleted the access before the next exchange: the
 * showing happened, and its record is what was promised (Greptile on #445).
 * The key holds, since a deleted row stays.
 */
const mayNameDeleted: Readonly<Record<string, readonly string[]>> = {
  site_access_reveals: ['siteAccessId'],
}

/** What a record of each table is called in a sentence, with its article. */
const called: Readonly<Record<string, string>> = {
  customers: 'Den Kunden',
  sites: 'Das Objekt',
  installations: 'Die Anlage',
  jobs: 'Den Auftrag',
  documents: 'Den Beleg',
  files: 'Die Datei',
  attachments: 'Die Datei',
  invitations: 'Die Einladung',
  tasks: 'Die Aufgabe',
  inverters: 'Den Wechselrichter',
  pv_strings: 'Den String',
  distribution_boards: 'Den Verteiler',
  board_sections: 'Das Feld',
  circuits: 'Den Stromkreis',
  suppliers: 'Den Lieferanten',
  articles: 'Den Artikel',
  supplier_articles: 'Den Lieferanten des Artikels',
}

/**
 * `missingReference`: the first reference among some values that names no
 * record of this business, or null when every one of them does.
 *
 * `missingReferenceText`: the sentence a route refuses it with, "Den Kunden
 * aus customerId gibt es in diesem Betrieb nicht."
 */
export const { missingReference, missingReferenceText } = referenceChecks({
  mayNameDeleted,
  called,
  within: 'in diesem Betrieb',
})
