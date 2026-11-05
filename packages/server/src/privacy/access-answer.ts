import {
  accessDay,
  accessPurposes,
  accessRecipients,
  accessRightsText,
  accessSource,
  accessStorage,
  accessSubjectLabel,
  auditLanguage,
  auditVocabulary,
  type ErasureRequestChannel,
  erasureRequestChannelPhrase,
  type IsoDate,
  type PersonalSubject,
  valueWords,
} from '@opengewerk/domain'
import { type PrintJob, present, text } from '@opengewerk/platform-server'

import { momentText } from '../forms/defect-report.js'
import { type GridParty, sheetHead, sheetJob } from '../forms/grid-documents.js'
import { type AccessReport, type ReportRow } from './access-report.js'
import { type ZipEntry } from './zip.js'

/**
 * The answer to a request for access (#318) as the person gets it, one ZIP:
 *
 * - `Auskunft.pdf`, to read (Art. 15 DSGVO): what the law asks besides the
 *   data (purposes, recipients, how long, rights, source), then every table
 *   with its rows in the words of the change log, what the person did on
 *   records of others, the change log of their rows and the list of files.
 * - `daten.json`, to carry over (Art. 20): the same rows with every column
 *   but the withheld ones, as the database holds them.
 * - `dateien/`, the stored files.
 */

/** Everything the answer is made of. */
export interface AccessAnswer {
  readonly keeper: GridParty
  readonly name: string
  readonly request: { readonly receivedOn: IsoDate; readonly channel: ErasureRequestChannel }
  readonly on: IsoDate
  readonly createdAt: string
  readonly report: AccessReport
  /** The names of the accounts the report names, by id. */
  readonly names: ReadonlyMap<string, string>
  readonly gridOperators: readonly string[]
  /**
   * The account of somebody of the staff, as the instance keeps it: its name
   * and address. Its sign-ins, passkeys and second factor the instance keeps
   * for every business the account works in, and they are not this
   * business's to give out.
   */
  readonly account: { readonly name: string; readonly email: string } | null
}

const language = auditLanguage(auditVocabulary)

/** Where a file of the report lies in the archive. */
export function filePaths(report: AccessReport): string[] {
  return report.files.map((file) => {
    const extension = extensionOf(file.mediaType, file.name)

    return `dateien/${file.name.endsWith(extension) ? file.name : `${file.name}${extension}`}`
  })
}

function extensionOf(mediaType: string, name: string): string {
  const known: Readonly<Record<string, string>> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'application/xml': '.xml',
    'text/xml': '.xml',
  }

  return /\.[a-z0-9]{2,5}$/i.test(name) ? '' : (known[mediaType] ?? '')
}

const isoMoment = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const isoDate = /^\d{4}-\d{2}-\d{2}$/

/** Columns that say nothing to the person on paper; the JSON keeps them. */
const technical = new Set([
  'id',
  'version',
  'change_sequence',
  'device_id',
  'sequence',
  'hash',
  'previous_hash',
])

/** A value of a row as the PDF prints it, or null where it prints nothing. */
function shown(
  table: string,
  column: string,
  value: unknown,
  names: AccessAnswer['names'],
): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (language.isPersonField(column) || /(^|_)user_id$/.test(column) || /_by$/.test(column)) {
    return typeof value === 'string' ? (names.get(value) ?? 'Jemand aus dem Betrieb') : null
  }

  if (/(^|_)path$/.test(column) || column === 'signature_path') {
    return 'Unterschrift vorhanden'
  }

  const word = typeof value === 'string' ? valueWords[table]?.[column]?.[value] : undefined

  if (word !== undefined) {
    return word
  }

  if (typeof value === 'boolean') {
    return value ? 'Ja' : 'Nein'
  }

  if (typeof value === 'number' && column.endsWith('_cents')) {
    return `${(value / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`
  }

  if (typeof value === 'string' && isoMoment.test(value)) {
    return momentText(new Date(value))
  }

  if (typeof value === 'string' && isoDate.test(value)) {
    return accessDay(value as IsoDate)
  }

  const said = typeof value === 'string' ? value : JSON.stringify(value)

  return said.length > 1500 ? `${said.slice(0, 1500)} …` : said
}

/** The columns of a row the PDF prints, with their words. */
function facts(table: string, row: ReportRow, names: AccessAnswer['names']): [string, string][] {
  return Object.entries(row).flatMap(([column, value]) => {
    if (technical.has(column) || (column.endsWith('_id') && !/(^|_)user_id$/.test(column))) {
      return []
    }

    const label =
      language.fieldName(table, column) ?? (column === 'created_at' ? 'Angelegt am' : null)
    const said =
      label === null || language.isSecret(table, column) ? null : shown(table, column, value, names)

    return label === null || said === null ? [] : [[label, said] as [string, string]]
  })
}

const answerStyle = `
.entry { padding: 1.2mm 0; border-top: 0.3pt solid #d5d9de; break-inside: avoid; }
.entry table th { width: 52mm; font-size: 8.5pt; font-weight: 400; color: #5b6573; border: 0; padding: 0.4mm 2mm 0.4mm 0; vertical-align: top; }
.entry table td { border: 0; padding: 0.4mm 0; overflow-wrap: anywhere; }
.log td, .log th { font-size: 8pt; }
.log td { overflow-wrap: anywhere; }
.muted { color: #5b6573; }
`

function section(title: string, body: string): string {
  return `<h2>${text(title)}</h2>\n${body}`
}

function paragraph(value: string): string {
  return `<p>${text(value)}</p>`
}

/** The PDF of the answer, portrait A4. */
export function accessPrintJob(answer: AccessAnswer): Required<Omit<PrintJob, 'size'>> {
  const { report, names } = answer
  const subject: PersonalSubject = report.subject
  const asked = `Anfrage vom ${accessDay(answer.request.receivedOn)} ${erasureRequestChannelPhrase[answer.request.channel]}`
  const mails = report.tables.get('mail_outbox')?.length ?? 0
  const paths = filePaths(report)
  const intro = `<div class="box"><div class="box-title">Was diese Auskunft enthält</div>${text(
    `Sie haben am ${accessDay(answer.request.receivedOn)} gefragt, welche Daten ${answer.keeper.name} über Sie gespeichert hat. Hier steht alles, was der Betrieb zu Ihnen als ${accessSubjectLabel[subject]} führt, Stand ${accessDay(answer.on)}. Dieselben Daten liegen im ZIP als daten.json zum Übertragen in eine andere Anwendung (Art. 20 DSGVO)${paths.length === 0 ? '' : ', die gespeicherten Dateien im Ordner dateien'}.`,
  )}</div>`

  const tables = [...report.tables.entries()]
    .map(([table, rows]) =>
      section(
        `${language.tableLabel(table)} (${String(rows.length)})`,
        rows
          .map((row) => {
            const lines = facts(table, row, names)

            return lines.length === 0
              ? ''
              : `<div class="entry"><table><tbody>${lines
                  .map(
                    ([label, value]) => `<tr><th>${text(label)}</th><td>${text(value)}</td></tr>`,
                  )
                  .join('')}</tbody></table></div>`
          })
          .join(''),
      ),
    )
    .join('\n')

  const counted = new Map<string, { count: number; first: string | null; last: string | null }>()

  for (const action of report.actions) {
    const entry = counted.get(action.table) ?? { count: 0, first: null, last: null }

    counted.set(action.table, {
      count: entry.count + 1,
      first: entry.first ?? action.at,
      last: action.at ?? entry.last,
    })
  }

  const actions =
    counted.size === 0
      ? ''
      : section(
          'Was Sie im Betrieb getan haben',
          `${paragraph('An Datensätzen, die nicht Ihre sind, nennt der Betrieb Sie als den, der etwas angelegt, geändert oder bekommen hat. Ihr Inhalt gehört anderen; hier steht, woran und wann. Jeder einzelne Vorgang steht in daten.json.')}
<table class="log"><thead><tr><th>Woran</th><th>Wie oft</th><th>Zeitraum</th></tr></thead><tbody>${[
            ...counted.entries(),
          ]
            .map(
              ([table, entry]) =>
                `<tr><td>${text(language.tableLabel(table))}</td><td>${String(entry.count)}</td><td>${text(
                  [entry.first, entry.last]
                    .filter(present)
                    .map((at) => momentText(new Date(at)).slice(0, 10))
                    .filter((value, index, all) => all.indexOf(value) === index)
                    .join(' bis '),
                )}</td></tr>`,
            )
            .join('')}</tbody></table>`,
        )

  const changes =
    report.changes.length === 0
      ? ''
      : section(
          `Änderungsprotokoll (${String(report.changes.length)})`,
          `<table class="log"><thead><tr><th>Wann</th><th>Was</th><th>Vorher</th><th>Nachher</th><th>Von</th></tr></thead><tbody>${report.changes
            .map((change) => {
              const value = (said: string | null) =>
                said === null ? '' : (shown(change.table, change.field, said, names) ?? '')

              return `<tr><td>${text(momentText(new Date(change.at)))}</td><td>${text(
                language.fieldLabel(change.table, change.field),
              )}</td><td>${text(value(change.before))}</td><td>${text(value(change.after))}</td><td>${text(
                change.by === null ? '' : (names.get(change.by) ?? 'Jemand aus dem Betrieb'),
              )}</td></tr>`
            })
            .join('')}</tbody></table>`,
        )

  const files =
    report.files.length === 0
      ? ''
      : section(
          `Dateien (${String(report.files.length)})`,
          `<table class="log"><thead><tr><th>Datei im ZIP</th><th>Art</th></tr></thead><tbody>${report.files
            .map(
              (file, index) =>
                `<tr><td>${text(paths[index] ?? file.name)}</td><td>${text(file.mediaType)}</td></tr>`,
            )
            .join('')}</tbody></table>`,
        )

  const body = `${sheetHead('Auskunft nach Art. 15 DSGVO', [answer.name, asked], answer.keeper)}
${intro}
${section('Zwecke und Rechtsgrundlagen', paragraph(accessPurposes[subject]))}
${section('Empfänger', paragraph(accessRecipients(answer.gridOperators, mails)))}
${section('Wie lange die Daten bleiben', paragraph(accessStorage[subject]))}
${section('Ihre Rechte', paragraph(accessRightsText))}
${section('Herkunft', paragraph(accessSource[subject]))}
${
  answer.account === null
    ? ''
    : section(
        'Zugang',
        `<div class="entry"><table><tbody><tr><th>Name</th><td>${text(answer.account.name)}</td></tr><tr><th>E-Mail-Adresse</th><td>${text(answer.account.email)}</td></tr></tbody></table></div>${paragraph('Wann und von welchem Gerät Sie sich angemeldet haben, führt die Instanz, auf der die Anwendung läuft, für alle Betriebe, in denen Sie arbeiten. Die Anmeldungen in diesem Betrieb stehen unten.')}`,
      )
}
${tables}
${actions}
${changes}
${files}`

  return sheetJob(
    `Auskunft, ${answer.name}`,
    body,
    `Auskunft nach Art. 15 DSGVO, ${answer.name}, ${accessDay(answer.on)}`,
    answerStyle,
  )
}

/** The same data, to carry over (Art. 20 DSGVO): every column but the withheld ones. */
export function accessJson(answer: AccessAnswer): string {
  const { report } = answer
  const paths = filePaths(report)

  return JSON.stringify(
    {
      format: 'opengewerk.access-report',
      version: 1,
      createdAt: answer.createdAt,
      business: answer.keeper.name,
      request: { receivedOn: answer.request.receivedOn, channel: answer.request.channel },
      subject: { kind: report.subject, id: report.subjectId, name: answer.name },
      account: answer.account,
      accounts: report.accounts.map((id) => ({ id, name: answer.names.get(id) ?? null })),
      tables: Object.fromEntries(report.tables),
      actions: report.actions,
      changes: report.changes,
      files: report.files.map((file, index) => ({ ...file, path: paths[index] })),
    },
    null,
    2,
  )
}

/**
 * What goes into the archive, in order: the PDF, the JSON and the files, each
 * read when its turn comes. A file the store no longer has, or has damaged,
 * becomes a line of text in its place, so that the answer still comes and
 * says what is missing.
 */
export function accessEntries(
  answer: AccessAnswer,
  pdf: Uint8Array,
  read: (sha256: string) => Promise<Uint8Array>,
): ZipEntry[] {
  const encoder = new TextEncoder()
  const paths = filePaths(answer.report)

  return [
    { name: 'Auskunft.pdf', bytes: () => Promise.resolve(pdf) },
    { name: 'daten.json', bytes: () => Promise.resolve(encoder.encode(accessJson(answer))) },
    ...answer.report.files.map((file, index) => {
      const path = paths[index] ?? `dateien/${file.name}`

      return {
        name: path,
        bytes: async () => {
          try {
            return await read(file.sha256)
          } catch {
            return {
              name: `${path} (fehlt).txt`,
              bytes: encoder.encode(
                `Diese Datei (${file.name}) ist im Dateispeicher des Betriebs nicht mehr lesbar. Ihr Fingerabdruck: ${file.sha256}.\n`,
              ),
            }
          }
        },
      }
    }),
  ]
}
