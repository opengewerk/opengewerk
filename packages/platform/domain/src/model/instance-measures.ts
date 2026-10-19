/**
 * What whoever runs an instance ensures while running it, and who works for
 * them doing so (opengewerk-haustechnik#358): part B of the technical and
 * organisational measures and the subprocessors, annexes 1 and 2 of the
 * template of the contract on processing on behalf on opengewerk.de. Whoever
 * runs the instance keeps them on a screen of its area; every tenant on it
 * gets them into its own measures and changes nothing of them. Part A, what
 * the application itself brings, is the application's.
 *
 * The sections and the words of their fields are those of the template, its
 * references to the contract (§ 4, § 5 Abs. 3) and to part A (A.1, A.5)
 * included, so that the made document and the template say the same.
 */

/** A field of part B: a line to write on, a box to tick, or a longer text. */
export type MeasureField =
  | { readonly key: string; readonly kind: 'text'; readonly label: string }
  | { readonly key: string; readonly kind: 'check'; readonly label: string }
  | { readonly key: string; readonly kind: 'area'; readonly label: string }

export interface MeasureSection {
  /** B.1 to B.9, as the template numbers them. */
  readonly number: string
  readonly title: string
  readonly fields: readonly MeasureField[]
}

export const instanceMeasureSections: readonly MeasureSection[] = [
  {
    number: 'B.1',
    title: 'Server und Standort',
    fields: [
      { key: 'serverPlace', kind: 'text', label: 'Land und Ort des Servers' },
      { key: 'serverRoom', kind: 'text', label: 'Rechenzentrum oder Raum' },
    ],
  },
  {
    number: 'B.2',
    title: 'Zutritt zum Server',
    fields: [
      {
        key: 'entryByProvider',
        kind: 'check',
        label: 'Rechenzentrum mit Zutrittskontrolle des Anbieters (Anlage 2)',
      },
      { key: 'entryOwnRoom', kind: 'check', label: 'eigener Raum, verschlossen' },
      { key: 'entryKeysWith', kind: 'text', label: 'Schlüssel bei' },
    ],
  },
  {
    number: 'B.3',
    title: 'Zugang zum Server und zur Datenbank',
    fields: [
      {
        key: 'accessByKeyOnly',
        kind: 'check',
        label: 'Anmeldung am Server nur mit Schlüssel, nicht mit Passwort',
      },
      {
        key: 'accessFirewall',
        kind: 'check',
        label: 'eine Firewall lässt nur die nötigen Ports durch',
      },
      {
        key: 'accessBehindWebServer',
        kind: 'check',
        label: 'Anwendung und Datenbank sind nur über den vorgeschalteten Webserver erreichbar',
      },
      { key: 'accessPeople', kind: 'text', label: 'Personen mit Zugang zum Server' },
      {
        key: 'accessKeysAt',
        kind: 'text',
        label: 'Wo die Schlüssel der Instanz liegen (die Datei .env)',
      },
    ],
  },
  {
    number: 'B.4',
    title: 'Verschlüsselung',
    fields: [
      {
        key: 'encryptionHttps',
        kind: 'check',
        label:
          'der vorgeschaltete Webserver liefert die Instanz nur über https mit einem gültigen Zertifikat aus',
      },
      {
        key: 'encryptionDisks',
        kind: 'check',
        label: 'die Datenträger des Servers sind verschlüsselt',
      },
      {
        key: 'encryptionBackups',
        kind: 'check',
        label: 'die Sicherungen sind verschlüsselt (A.5)',
      },
      {
        key: 'encryptionBackupKeyWith',
        kind: 'text',
        label: 'Der private Schlüssel der Sicherungen liegt bei',
      },
    ],
  },
  {
    number: 'B.5',
    title: 'Sicherung',
    fields: [
      { key: 'backupTarget', kind: 'text', label: 'Ziel der Sicherungen' },
      { key: 'backupGenerations', kind: 'text', label: 'Aufbewahrte Generationen' },
      { key: 'backupRestoreMonths', kind: 'text', label: 'Rückspielen zur Probe, alle … Monate' },
      {
        key: 'backupElsewhere',
        kind: 'check',
        label: 'die Sicherungen liegen nicht auf demselben Datenträger wie die Instanz',
      },
    ],
  },
  {
    number: 'B.6',
    title: 'Aktualisierung',
    fields: [
      {
        key: 'updatesSystem',
        kind: 'check',
        label: 'Sicherheitsupdates des Betriebssystems laufen automatisch',
      },
      {
        key: 'updatesApplication',
        kind: 'check',
        label: 'neue Fassungen der Anwendung nach § 5 Abs. 3',
      },
      {
        key: 'updatesBackupFirst',
        kind: 'check',
        label: 'vor jedem Update eine Sicherung von Hand',
      },
    ],
  },
  {
    number: 'B.7',
    title: 'Protokolle des Servers',
    fields: [
      {
        key: 'logsWebServer',
        kind: 'text',
        label: 'Was der Webserver protokolliert, und wie lange',
      },
      {
        key: 'logsForwardAddress',
        kind: 'check',
        label:
          'der Webserver reicht die Netzadresse der Anfrage an die Anwendung durch (A.1, § 2 Abs. 2)',
      },
    ],
  },
  {
    number: 'B.8',
    title: 'Personal',
    fields: [
      {
        key: 'staffConfidential',
        kind: 'check',
        label: 'alle Personen mit Zugang sind auf Vertraulichkeit verpflichtet (§ 4)',
      },
      { key: 'staffTrained', kind: 'check', label: 'sie sind im Datenschutz unterwiesen' },
      { key: 'staffTrainedOn', kind: 'text', label: 'zuletzt unterwiesen am' },
    ],
  },
  {
    number: 'B.9',
    title: 'Weitere Maßnahmen',
    fields: [{ key: 'further', kind: 'area', label: 'Weitere Maßnahmen' }],
  },
]

/**
 * The values of part B by the key of their field: a text, or whether a box is
 * ticked. A field that is missing is empty, or not ticked.
 */
export type InstanceMeasures = Readonly<Record<string, string | boolean>>

/** One who works for whoever runs the instance, as a row of annex 2. */
export interface Subprocessor {
  /** Name and address. */
  readonly name: string
  /** What they do: the server, the place of the backups, the mail server of the instance. */
  readonly service: string
  /** Where the processing happens. */
  readonly place: string
}

/** Part B and annex 2, as the application reads them for the documents of a tenant. */
export interface InstanceMeasuresRecord {
  readonly measures: InstanceMeasures
  readonly subprocessors: readonly Subprocessor[]
  /** When either was last changed, ISO 8601, or null while they never were. */
  readonly changedAt: string | null
}

/** The same for their screen, with who changed them last, by name. */
export interface InstanceMeasuresView extends InstanceMeasuresRecord {
  readonly changedBy: string | null
}

/** How long a line may be, how long the longer text, and how many subprocessors there are at most. */
export const measureLimits = {
  line: 500,
  area: 4_000,
  subprocessors: 30,
  subprocessorField: 500,
} as const

const fieldsByKey = new Map(
  instanceMeasureSections.flatMap((section) => section.fields.map((field) => [field.key, field])),
)

/** The field of part B by its key, or undefined where there is none. */
export function measureField(key: string): MeasureField | undefined {
  return fieldsByKey.get(key)
}

const subprocessorWords: Readonly<Record<keyof Subprocessor, string>> = {
  name: 'Name und Anschrift',
  service: 'Leistung',
  place: 'Ort der Verarbeitung',
}

/**
 * Part B and annex 2 as they are kept, from what a request sent, or why they
 * cannot be. Texts lose the spaces around them; an empty text and a box that
 * is not ticked are left out, so that what is kept says only what was said.
 * A subprocessor needs all three of its fields.
 */
export function checkedInstanceMeasures(
  body: unknown,
):
  | { readonly measures: InstanceMeasures; readonly subprocessors: readonly Subprocessor[] }
  | { readonly problem: string } {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const given = record.measures
  const list = record.subprocessors

  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    return { problem: 'Es fehlen die Maßnahmen.' }
  }

  if (!Array.isArray(list)) {
    return { problem: 'Es fehlen die Unterauftragsverarbeiter.' }
  }

  // Kept under the key of the field as this file defines it, never under a
  // name out of the request, and in a map until the end.
  const measures = new Map<string, string | boolean>()

  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    const field = measureField(key)

    if (field === undefined) {
      return { problem: `Ein Feld „${key}“ gibt es nicht.` }
    }

    if (field.kind === 'check') {
      if (typeof value !== 'boolean') {
        return { problem: `„${field.label}“ ist angekreuzt oder nicht.` }
      }

      if (value) {
        measures.set(field.key, true)
      }

      continue
    }

    if (typeof value !== 'string') {
      return { problem: `„${field.label}“ ist ein Text.` }
    }

    const text = value.replace(/\r\n?/g, '\n').trim()
    const longest = field.kind === 'area' ? measureLimits.area : measureLimits.line

    if (text.length > longest) {
      return {
        problem: `„${field.label}“: höchstens ${longest.toLocaleString('de-DE')} Zeichen.`,
      }
    }

    if (text !== '') {
      measures.set(field.key, text)
    }
  }

  if (list.length > measureLimits.subprocessors) {
    return { problem: `Höchstens ${measureLimits.subprocessors} Unterauftragsverarbeiter.` }
  }

  const subprocessors: Subprocessor[] = []

  for (const [index, entry] of list.entries()) {
    const row = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >
    const kept: Record<string, string> = {}

    for (const part of ['name', 'service', 'place'] as const) {
      const value = row[part]
      const text = typeof value === 'string' ? value.trim() : ''

      if (text === '') {
        return {
          problem: `Beim ${index + 1}. Unterauftragsverarbeiter fehlt „${subprocessorWords[part]}“.`,
        }
      }

      if (text.length > measureLimits.subprocessorField) {
        return {
          problem: `Beim ${index + 1}. Unterauftragsverarbeiter: „${subprocessorWords[part]}“ höchstens ${measureLimits.subprocessorField} Zeichen.`,
        }
      }

      kept[part] = text
    }

    subprocessors.push(kept as unknown as Subprocessor)
  }

  return { measures: Object.fromEntries(measures), subprocessors }
}
