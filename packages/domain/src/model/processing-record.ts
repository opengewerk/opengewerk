import { type IsoDate, plainInMarkdown } from '@opengewerk/platform-domain'

import type { ErasureKind } from './erasure.js'
import type { PersonalSubject } from './personal-data.js'

/**
 * The record of the processing (#319, Art. 30 Abs. 1 DSGVO), as the
 * Haustechnik keeps it (opengewerk-haustechnik#358, decided on 19.10.2026):
 * what a business processes with this application, activity by activity.
 * Who is concerned, which data and how long they stay the application knows;
 * the purpose and the legal basis it proposes until the owner confirms or
 * changes them under "Einstellungen, Datenschutz", and the recipients the
 * owner writes there, with who is responsible, the data protection officer
 * and what is processed outside OpenGewerk.
 *
 * Decided by Moritz on 05.11.2026: the record is made fresh whenever it is
 * downloaded, and it names only the activities the business uses (#319). An
 * activity whose use depends on what the business set up says by what
 * (`ProcessingUse`); the server answers that from its data.
 */

/**
 * By what the application knows whether a business uses an activity.
 *
 * - `always`: every business does, as long as it works with the application.
 * - `prospects`: a lead was ever recorded.
 * - `grid`: an installation names its grid operator.
 * - `calendar`: somebody has a calendar subscription that runs.
 * - `time`: working time was ever recorded.
 * - `staff`: there is a file of somebody of the staff.
 * - `mail`: the business has its own mail server, over which its mails go.
 * - `push`: a device has push messages switched on.
 */
export const processingUses = [
  'always',
  'prospects',
  'grid',
  'calendar',
  'time',
  'staff',
  'mail',
  'push',
] as const

export type ProcessingUse = (typeof processingUses)[number]

/** Why an activity is not in the record, by its use. */
export const unusedBecause: Readonly<Record<Exclude<ProcessingUse, 'always'>, string>> = {
  prospects: 'noch kein Lead erfasst',
  grid: 'keine Anlage nennt einen Netzbetreiber',
  calendar: 'niemand im Betrieb hat ein Kalender-Abo',
  time: 'noch keine Arbeitszeit erfasst',
  staff: 'noch keine Mitarbeiterakte',
  mail: 'kein eigener Mailserver eingerichtet',
  push: 'kein Gerät hat Push eingeschaltet',
}

export interface ProcessingActivity {
  readonly key: string
  readonly title: string
  /** Who is concerned. */
  readonly subjects: string
  /** Which data, in a few words. */
  readonly data: string
  /** How long the data stay, after the deletion concept. */
  readonly deletion: string
  /** The purpose the application proposes. */
  readonly purpose: string
  /** The legal basis the application proposes. */
  readonly legalBasis: string
  readonly uses: ProcessingUse
  /** The kinds of person whose answer to a request for access names the recipients of the activity (#318). */
  readonly answers: readonly PersonalSubject[]
}

export const processingActivities = [
  {
    key: 'accounts',
    title: 'Konten, Anmeldung und Zugänge',
    subjects: 'Beschäftigte mit Zugang',
    data: 'Name, E-Mail-Adresse, Passwort als Hash, Passkeys, zweiter Faktor, Sitzungen mit Gerät und Netzadresse, Rollen und letzter Tag',
    deletion:
      'mit der Akte, drei Jahre nach dem Ende des Austrittsjahres; eine Sitzung nach zwölf Stunden, ein Gerät für die Arbeit ohne Netz nach dreißig Tagen',
    purpose:
      'Anmeldung an der Anwendung, Festlegen, wer was sehen und tun darf, und Schutz der Konten vor fremdem Zugriff',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO; Art. 6 Abs. 1 Buchst. c mit Art. 32 DSGVO',
    uses: 'always',
    answers: ['person'],
  },
  {
    key: 'customers',
    title: 'Kunden, Ansprechpartner und Verlauf',
    subjects: 'Kunden, Ansprechpartner von Kunden',
    data: 'Name, Anschrift, E-Mail-Adresse, Telefon, Umsatzsteuer-Identifikationsnummer, Notizen und Tags, Notizen und Anrufe im Verlauf',
    deletion:
      'wenn mit dem Kunden nichts mehr läuft, eine einstellbare Zahl von Monaten nach dem letzten Kontakt oder auf seine Anfrage; Ansprechpartner mit ihm',
    purpose: 'Kunden betreuen, Aufträge anbahnen und festhalten, was mit ihnen besprochen wurde',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO; für Ansprechpartner Art. 6 Abs. 1 Buchst. f DSGVO',
    uses: 'always',
    answers: ['customer', 'contact'],
  },
  {
    key: 'prospects',
    title: 'Leads und Vertrieb',
    subjects: 'Interessenten, die noch nicht Kunde sind',
    data: 'Name, Anliegen, Anschrift, E-Mail-Adresse, Telefon, Quelle und Stand',
    deletion:
      'eine einstellbare Zahl von Monaten nach dem letzten Kontakt, wenn kein Kunde daraus wird',
    purpose: 'Anfragen beantworten und Angebote vorbereiten, bevor jemand Kunde ist',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
    uses: 'prospects',
    answers: ['prospect'],
  },
  {
    key: 'documents',
    title: 'Angebote, Aufträge, Belege und Zahlungen',
    subjects: 'Kunden; Beschäftigte, die einen Beleg festschreiben oder unterschreiben lassen',
    data: 'Belege mit Positionen, Unterschriften, E-Rechnungen, Zahlungen, Aufträge und ihre Notizen',
    deletion:
      'Rechnungen, Gutschriften und Stornos acht Jahre, andere festgeschriebene Belege sechs Jahre nach dem Ende des Jahres, danach mit dem Kunden',
    purpose: 'Aufträge ausführen und abrechnen und die Belege aufbewahren',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b und c DSGVO mit § 147 AO, § 14 UStG und § 257 HGB',
    uses: 'always',
    answers: ['customer'],
  },
  {
    key: 'sites',
    title: 'Objekte, Anlagen, Prüfungen und Mängel',
    subjects: 'Kunden; Beschäftigte, die prüfen und unterschreiben',
    data: 'Anschrift des Objekts, Anlagen mit Struktur, Prüfprotokolle mit Messwerten und Unterschrift, Mängel, Fotos, Zugänge zum Objekt (versiegelt)',
    deletion:
      'ohne Kundendaten bis zehn Jahre nach dem letzten unterschriebenen Protokoll, ohne Protokoll nach dem letzten Auftrag dort',
    purpose: 'Anlagen errichten, prüfen und warten, Prüfungen nachweisen und Mängel beheben',
    legalBasis:
      'Art. 6 Abs. 1 Buchst. b und c DSGVO; für den Nachweis Art. 6 Abs. 1 Buchst. f DSGVO',
    uses: 'always',
    answers: ['customer'],
  },
  {
    key: 'grid',
    title: 'Netzbetreiber und Förderprogramme',
    subjects: 'Kunden als Betreiber einer Anlage',
    data: 'Name und Anschrift des Betreibers, Anlage, Zähler, Leistung und Inbetriebnahme',
    deletion: 'mit dem Objekt und seinen Anlagen',
    purpose: 'Anlagen beim Netzbetreiber anmelden und Förderanträge vorbereiten',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b und c DSGVO',
    uses: 'grid',
    answers: ['customer'],
  },
  {
    key: 'planning',
    title: 'Einsatzplanung, Termine, Aufgaben und Rufbereitschaft',
    subjects: 'Beschäftigte, Kunden',
    data: 'Termine mit Auftrag und Objekt, wer eingeteilt ist, Aufgaben, Fristen, Rufbereitschaft',
    deletion: 'mit dem Auftrag oder dem Kunden; Rufbereitschaft mit den Arbeitszeiten ihres Jahres',
    purpose: 'Einsätze planen, verteilen und vor Ort erledigen',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
    uses: 'always',
    answers: ['person', 'customer'],
  },
  {
    key: 'calendar',
    title: 'Kalender-Abo',
    subjects: 'Beschäftigte mit Abo, Kunden in ihren Terminen',
    data: 'Termine der Person mit Auftrag, Kunde, Anschrift und Notiz, die letzten 90 Tage und alle späteren',
    deletion: 'ein beendetes Abo liefert einen leeren Kalender',
    purpose: 'Termine in den Kalender einer beschäftigten Person liefern, den sie selbst wählt',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
    uses: 'calendar',
    answers: ['person'],
  },
  {
    key: 'time',
    title: 'Arbeitszeiten',
    subjects: 'Beschäftigte',
    data: 'Beginn, Ende, Pausen und Fahrten, Notiz und Auftrag; der Standort beim Beginn und Ende nur mit Einwilligung der Person',
    deletion: 'mit Urlaub und Rufbereitschaft des Jahres sechs Jahre nach dessen Ende',
    purpose: 'Arbeitszeit erfassen, den Lohn abrechnen und die Aufzeichnungen aufbewahren',
    legalBasis:
      'Art. 6 Abs. 1 Buchst. b und c DSGVO mit § 17 MiLoG, § 16 ArbZG und § 147 AO; für den Standort Art. 6 Abs. 1 Buchst. a DSGVO',
    uses: 'time',
    answers: ['person'],
  },
  {
    key: 'staff',
    title: 'Mitarbeiterakte, Urlaub und Krankheit',
    subjects: 'Beschäftigte',
    data: 'Akte mit Eintritt und Austritt, vereinbarter Arbeitszeit und Qualifikationen mit Zertifikat, Urlaub, Urlaubsanspruch, Krankheit nur in ihrer Dauer',
    deletion:
      'Krankheit zwölf Monate nach ihrem letzten Tag, Urlaub mit den Arbeitszeiten seines Jahres, die Akte drei Jahre nach dem Ende des Austrittsjahres',
    purpose:
      'Das Beschäftigungsverhältnis führen, Qualifikationen nachhalten, Urlaub und Krankheit erfassen',
    legalBasis:
      'Art. 6 Abs. 1 Buchst. b und c DSGVO; für Krankheiten Art. 9 Abs. 2 Buchst. b DSGVO',
    uses: 'staff',
    answers: ['person'],
  },
  {
    key: 'mail',
    title: 'E-Mails an Kunden und Beschäftigte',
    subjects: 'Kunden, Ansprechpartner, Leads und Beschäftigte',
    data: 'E-Mail-Adresse und Name des Empfängers, Betreff, Text und Anhang, wann sie hinausging',
    deletion: 'mit dem Beleg, dem Auftrag oder dem Kunden, an dem sie hängt',
    purpose: 'Belege, Bestätigungen und Erinnerungen verschicken',
    legalBasis:
      'Art. 6 Abs. 1 Buchst. b DSGVO; Erinnerungen ohne Vertrag Art. 6 Abs. 1 Buchst. a oder f DSGVO mit § 7 Abs. 3 UWG',
    uses: 'mail',
    answers: ['customer', 'contact', 'prospect', 'person'],
  },
  {
    key: 'push',
    title: 'Benachrichtigungen auf Geräten',
    subjects: 'Beschäftigte, die Push eingeschaltet haben',
    data: 'Abonnement des Browsers, Anlass und Tag einer Nachricht',
    deletion: 'mit dem Abmelden des Geräts oder dem Ausschalten',
    purpose: 'Beschäftigten sagen, was für sie ansteht',
    legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
    uses: 'push',
    answers: ['person'],
  },
  {
    key: 'requests',
    title: 'Anfragen nach der DSGVO',
    subjects: 'Kunden, Ansprechpartner, Leads und Beschäftigte, die eine Anfrage stellen',
    data: 'wer gefragt hat, Eingang, Weg, Antwort und Löschung ohne Namen',
    deletion:
      'eine Anfrage bleibt als Nachweis der Antwort, ohne Namen, sobald die Person gelöscht ist',
    purpose: 'Auskunft geben, löschen und sperren, wie Betroffene es verlangen',
    legalBasis: 'Art. 6 Abs. 1 Buchst. c DSGVO mit Art. 12 bis 18 DSGVO',
    uses: 'always',
    answers: [],
  },
  {
    key: 'audit',
    title: 'Änderungsprotokoll',
    subjects: 'alle, deren Daten die Anwendung führt, und wer sie geändert hat',
    data: 'jede Änderung mit Feld, Wert davor und danach, wer, wann und von welchem Gerät',
    deletion: 'die Werte eines gelöschten Datensatzes werden geschwärzt, die Kette bleibt',
    purpose:
      'Nachvollziehbar halten, wer was geändert hat, damit Belege und Nachweise unverfälscht bleiben',
    legalBasis: 'Art. 6 Abs. 1 Buchst. c mit Art. 5 Abs. 2 und Art. 32 DSGVO',
    uses: 'always',
    answers: [],
  },
  {
    key: 'backups',
    title: 'Sicherung der Instanz',
    subjects: 'alle, deren Daten die Anwendung führt',
    data: 'die Datenbank und die gespeicherten Dateien, verschlüsselt',
    deletion: 'nach der Zahl der Generationen, die der Betreiber der Instanz aufbewahrt',
    purpose: 'Daten gegen Verlust schützen und wiederherstellen können',
    legalBasis: 'Art. 6 Abs. 1 Buchst. c mit Art. 32 DSGVO',
    uses: 'always',
    answers: [],
  },
] as const satisfies readonly ProcessingActivity[]

export type ProcessingActivityKey = (typeof processingActivities)[number]['key']

export function isProcessingActivity(value: string): value is ProcessingActivityKey {
  return processingActivities.some((activity) => activity.key === value)
}

/** What the owner wrote for one activity; null where nothing was written. */
export interface ProcessingActivityEntry {
  readonly purpose: string | null
  readonly legalBasis: string | null
  readonly recipients: string | null
}

/** What the owner wrote for the whole record. */
export interface ProcessingRecordInputs {
  readonly controller: string | null
  readonly officer: string | null
  /** What the business processes outside OpenGewerk, one line each. */
  readonly outside: string | null
  readonly activities: Readonly<Partial<Record<ProcessingActivityKey, ProcessingActivityEntry>>>
}

/** One activity as the page of the record shows it, with the proposals and what was written. */
export interface ProcessingActivityView {
  readonly key: ProcessingActivityKey
  readonly title: string
  readonly subjects: string
  readonly data: string
  readonly deletion: string
  readonly proposedPurpose: string
  readonly proposedLegalBasis: string
  readonly purpose: string | null
  readonly legalBasis: string | null
  readonly recipients: string | null
  /** Null while the business uses it, else why not. */
  readonly unused: string | null
}

export interface ProcessingRecordView {
  readonly controller: string | null
  /** What the letterhead says of the business, proposed while no controller is written. */
  readonly proposedController: string
  readonly officer: string | null
  readonly outside: string | null
  readonly activities: readonly ProcessingActivityView[]
  /**
   * When who is responsible, the officer or what is processed outside was
   * last changed, and by whom where the change log names it; null while never.
   */
  readonly changed: { readonly on: IsoDate; readonly by: string | null } | null
  /** Whether the person asking leads the business, and so may change it. */
  readonly leads: boolean
}

/** How long a text of the record may be. */
export const recordLimits = { text: 2_000 } as const

/** A text of the owner as it is kept: without spaces around it, an empty one as none, or why not. */
export function recordText(
  value: unknown,
  label: string,
): string | null | { readonly problem: string } {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return { problem: `„${label}“ ist ein Text.` }
  }

  const text = value.replace(/\r\n?/g, '\n').trim()

  if (text.length > recordLimits.text) {
    return {
      problem: `„${label}“: höchstens ${recordLimits.text.toLocaleString('de-DE')} Zeichen.`,
    }
  }

  return text === '' ? null : text
}

/** For whom and when a record is made, with what the owner wrote and which activities the business uses. */
export interface ProcessingRecordMade {
  readonly business: string
  /** "am 05.11.2026 um 10:40" */
  readonly at: string
  readonly inputs: ProcessingRecordInputs
  /** The controller the letterhead proposes, while none is written. */
  readonly proposedController: string
  readonly used: ReadonlySet<ProcessingActivityKey>
}

const unconfirmed = ' (Vorschlag der Anwendung, nicht bestätigt)'

function written(value: string): string {
  return plainInMarkdown(value)
}

function lines(value: string): string {
  // The lines the owner typed stand one after the other, with a comma between.
  return value
    .split('\n')
    .map((line) => plainInMarkdown(line))
    .filter((line) => line.trim() !== '')
    .join(', ')
}

/** The record as Markdown, as the PDF prints it. */
export function describeRecord(made: ProcessingRecordMade): string {
  const { inputs } = made
  const used = processingActivities.filter((activity) => made.used.has(activity.key))
  const head = [
    `# Verzeichnis der Verarbeitungstätigkeiten für ${plainInMarkdown(made.business)}`,
    '',
    `- **Erzeugt:** ${made.at}`,
    '',
    '---',
    '',
    '## 1. Was dieses Verzeichnis ist',
    '',
    'Das Verzeichnis der Verarbeitungstätigkeiten nach Art. 30 Abs. 1 DSGVO für die Verarbeitungen mit OpenGewerk. Es nennt die Tätigkeiten, die der Betrieb nutzt. Betroffene Personen, Daten und Löschung kennt die Anwendung selbst; Zweck, Rechtsgrundlage und Empfänger kommen aus den Angaben des Inhabers unter „Einstellungen, Datenschutz“. Wo er einen Vorschlag der Anwendung nicht bestätigt hat, sagt es das Verzeichnis.',
    '',
    '## 2. Für alle Tätigkeiten',
    '',
    `- **Verantwortlicher:** ${inputs.controller === null ? `${lines(made.proposedController)} (aus dem Briefkopf, nicht bestätigt)` : lines(inputs.controller)}`,
    `- **Datenschutzbeauftragter:** ${inputs.officer === null ? 'keiner angegeben' : lines(inputs.officer)}`,
    '- **Übermittlung in ein Drittland:** Die Anwendung übermittelt nichts in ein Drittland. Wo die Instanz läuft und wer für sie arbeitet, steht in den technischen und organisatorischen Maßnahmen, Teil B und Anlage 2.',
    '- **Löschung:** nach dem Löschkonzept; jede Tätigkeit nennt ihre Fristen.',
    '- **Sicherheit der Verarbeitung:** nach den technischen und organisatorischen Maßnahmen.',
    '',
    '## 3. Die Tätigkeiten',
  ]
  const activities = used.flatMap((activity, index) => {
    const entry = inputs.activities[activity.key]
    const purpose = entry?.purpose ?? null
    const legalBasis = entry?.legalBasis ?? null

    return [
      '',
      `### 3.${String(index + 1)} ${activity.title}`,
      '',
      `- **Zweck:** ${purpose === null ? `${activity.purpose}${unconfirmed}` : written(purpose)}`,
      `- **Rechtsgrundlage:** ${legalBasis === null ? `${activity.legalBasis}${unconfirmed}` : written(legalBasis)}`,
      `- **Betroffene Personen:** ${activity.subjects}`,
      `- **Daten:** ${activity.data}`,
      `- **Empfänger:** ${entry?.recipients ? lines(entry.recipients) : 'keine außerhalb des Betriebs angegeben'}`,
      `- **Löschung:** ${activity.deletion}`,
    ]
  })
  const outside =
    inputs.outside === null
      ? []
      : [
          '',
          '## 4. Verarbeitungen außerhalb von OpenGewerk',
          '',
          'Was der Betrieb nach seinen Angaben mit anderen Programmen oder Dienstleistern verarbeitet. Diese Tätigkeiten beschreibt er selbst; die Anwendung kennt sie nicht.',
          '',
          ...inputs.outside
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line) => `- ${plainInMarkdown(line)}`),
        ]

  return [...head, ...activities, ...outside, ''].join('\n')
}

/**
 * The recipients the owner wrote for the activities that concern a kind of
 * person, for the answer to a request for access (#318): each line once.
 */
export function recipientsFor(
  subject: PersonalSubject,
  inputs: Pick<ProcessingRecordInputs, 'activities'>,
  used: ReadonlySet<ProcessingActivityKey>,
): string[] {
  const found = new Set<string>()

  for (const activity of processingActivities) {
    const answers: readonly PersonalSubject[] = activity.answers

    if (!used.has(activity.key) || !answers.includes(subject)) {
      continue
    }

    for (const line of (inputs.activities[activity.key]?.recipients ?? '').split('\n')) {
      if (line.trim() !== '') {
        found.add(line.trim())
      }
    }
  }

  return [...found]
}

/** The three documents on data protection, each made fresh whenever it is downloaded (#319). */
export const privacyDocumentKinds = ['record', 'measures', 'deletion'] as const

export type PrivacyDocumentKind = (typeof privacyDocumentKinds)[number]

export function isPrivacyDocumentKind(value: string): value is PrivacyDocumentKind {
  return (privacyDocumentKinds as readonly string[]).includes(value)
}

/** The title of each document, as its PDF, its file and its card name it. */
export const privacyDocumentTitles: Readonly<Record<PrivacyDocumentKind, string>> = {
  record: 'Verzeichnis der Verarbeitungstätigkeiten',
  measures: 'Technische und organisatorische Maßnahmen',
  deletion: 'Löschkonzept',
}

/** What the three cards on "Datenschutz" say of the documents, before one is downloaded. */
export interface PrivacyDocumentsSummary {
  readonly record: {
    /** Who is responsible in a line; the letterhead, with that said, while nobody wrote it. */
    readonly controller: string
    readonly officer: string | null
    readonly used: number
    readonly confirmed: number
    readonly unused: number
  }
  readonly measures: {
    /** The day whoever runs the instance last changed part B or annex 2, or null while never. */
    readonly changedOn: IsoDate | null
    readonly subprocessors: number
  }
  readonly deletion: {
    readonly kinds: number
    /** The kinds that go by themselves. */
    readonly automatic: readonly ErasureKind[]
    readonly prospectMonths: number
    readonly customerMonths: number
  }
}
