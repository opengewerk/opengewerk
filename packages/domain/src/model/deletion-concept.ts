import { type IsoDate, plainInMarkdown, type RuleRecord } from '@opengewerk/platform-domain'

import { shippedRules } from '../rules/shipped.js'
import { type ErasureKind, erasureKinds, erasureKindWords } from './erasure.js'
import { retentionKinds, retentionKindWords } from './retention.js'

/**
 * The deletion concept of a business as a document (#319, as the Haustechnik
 * makes it with opengewerk-haustechnik#358): which personal data the
 * application deletes or proposes to delete, when, and how; and what it keeps,
 * for how long and why. Made from the kinds of the deletion concept (#317 to
 * #848), the package of retention periods with its sources and what the
 * business set: the months of the two kinds that count from the last contact
 * and which kinds go by themselves. Made fresh whenever it is downloaded.
 */

const yearWords: Readonly<Record<number, string>> = { 2: 'zwei', 6: 'sechs', 8: 'acht', 10: 'zehn' }

/** "8 Jahre, bis 2024 zehn": the period of a rule now, and the one before where the law changed it. */
export function retentionPeriodWords(key: string, on: IsoDate): string {
  const now = shippedRules.at(key, on)

  if (now === null) {
    return ''
  }

  const before = shippedRules
    .all()
    .filter((record: RuleRecord) => record.key === key && record.validUntil !== null)
    .filter((record) => (record.validUntil ?? '') < now.validFrom)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0]
  const years = now.value === 1 ? '1 Jahr' : `${String(now.value)} Jahre`

  return before && before.value !== now.value
    ? `${years}, bis ${(before.validUntil ?? '').slice(0, 4)} ${yearWords[before.value] ?? String(before.value)}`
    : years
}

/** What the business set that the concept names. */
export interface DeletionSettings {
  /** The months after the last contact a lead and a customer fall due after. */
  readonly prospectMonths: number
  readonly customerMonths: number
  /** The kinds that go by themselves. */
  readonly automatic: readonly ErasureKind[]
}

/** For whom and when the concept is made. */
export interface DeletionMade {
  readonly business: string
  /** "am 05.11.2026 um 10:40" */
  readonly at: string
  readonly on: IsoDate
  readonly settings: DeletionSettings
}

function months(count: number): string {
  return count === 1 ? '1 Monat' : `${String(count)} Monate`
}

/** When a kind falls due, in the words of the concept. */
export function erasureWhen(kind: ErasureKind, settings: DeletionSettings): string {
  switch (kind) {
    case 'prospect':
      return `${months(settings.prospectMonths)} nach dem letzten Kontakt, wenn kein Kunde aus dem Lead geworden ist`
    case 'customer':
      return `wenn mit dem Kunden nichts mehr läuft, ${months(settings.customerMonths)} nach dem letzten Kontakt oder auf seine Anfrage; vorher gesperrt, solange Belege oder eine Gewährleistung ihn halten`
    case 'sickness':
      return 'zwölf Monate nach ihrem letzten Tag'
    case 'staff_year':
      return 'die Arbeitszeiten, die Rufbereitschaft, der Urlaub und der Urlaubsanspruch eines Jahres sechs Jahre nach dessen Ende'
    case 'person':
      return 'die Akte einer ausgetretenen Person drei Jahre nach dem Ende ihres Austrittsjahres, sobald ihr Zugang geendet hat'
    case 'site':
      return 'das Objekt eines gelöschten Kunden zehn Jahre nach dem letzten unterschriebenen Protokoll daran, ohne Protokoll nach dem letzten abgeschlossenen Auftrag dort'
  }
}

function cell(value: string): string {
  return plainInMarkdown(value)
}

/** The concept as Markdown, as the PDF prints it. */
export function describeDeletion(made: DeletionMade): string {
  const { settings } = made
  const kinds = erasureKinds.map(
    (kind) =>
      `| ${erasureKindWords[kind].title} | ${cell(erasureWhen(kind, settings))} | ${
        settings.automatic.includes(kind)
          ? 'von selbst, im Namen dessen, der es eingeschaltet hat'
          : 'vorgeschlagen'
      } |`,
  )
  const kept = retentionKinds.map((kind) => {
    const words = retentionKindWords[kind]

    return `| ${words.label} | ${retentionPeriodWords(words.rule, made.on)} | ${words.begins} | ${cell(shippedRules.at(words.rule, made.on)?.source ?? '')} |`
  })

  return [
    `# Löschkonzept für ${plainInMarkdown(made.business)}`,
    '',
    `- **Erzeugt:** ${made.at}`,
    '',
    '---',
    '',
    '## 1. Was dieses Dokument ist',
    '',
    'Welche personenbezogenen Daten OpenGewerk wann löscht oder zum Löschen vorschlägt, und was es wie lange aufbewahrt. Die Arten und ihre Fristen kommen aus der Anwendung, die Aufbewahrungsfristen aus ihrem Regelpaket mit Fundstelle, die Zahl der Monate und was von selbst geht aus den Einstellungen dieses Betriebs.',
    '',
    '## 2. Was gelöscht wird',
    '',
    'Ist ein Datensatz fällig, schlägt ihn der Lauf der Fristen unter „Einstellungen, Datenschutz“ vor. Wer den Betrieb führt, bestätigt das Löschen oder stellt eine Art auf automatisch; dann löscht der Lauf in seinem Namen, solange er den Betrieb führt. Gelöscht wird wirklich: was auf die Geräte reist, wird geleert und als gelöscht markiert, jeder Wert des Datensatzes im Änderungsprotokoll wird geschwärzt, und eine Zeile im Protokoll des Löschkonzepts sagt, was wann und von wem gelöscht wurde, ohne Namen.',
    '',
    '| Daten | Wann | Wie |',
    '|---|---|---|',
    ...kinds,
    '| Sitzungen | nach zwölf Stunden, ein Gerät für die Arbeit ohne Netz nach dreißig Tagen | von selbst |',
    '',
    '## 3. Was aufbewahrt wird',
    '',
    'Solange eine Frist läuft, bleiben Belege und Nachweise auch dann, wenn die Person um das Löschen bittet (Art. 17 Abs. 3 Buchst. b und e DSGVO); ein Kunde wird bis dahin gesperrt (Art. 18 DSGVO). Eine Frist läuft nicht ab, solange die Unterlagen für Steuern von Bedeutung sind, deren Festsetzungsfrist noch läuft (§ 147 Abs. 3 Satz 5 AO).',
    '',
    '| Unterlagen | Frist | Beginnt | Fundstelle |',
    '|---|---|---|---|',
    ...kept,
    '',
    '## 4. Sicherungen',
    '',
    'Die Sicherungen der Instanz halten gelöschte Daten, bis ihre Generation ersetzt ist. Wie viele Generationen bleiben, steht in den technischen und organisatorischen Maßnahmen, Teil B. Wird eine Sicherung zurückgespielt, erscheinen Datensätze wieder, die danach gelöscht wurden; der Lauf der Fristen schlägt sie erneut vor oder löscht sie, wo ihre Art auf automatisch steht.',
    '',
  ].join('\n')
}
