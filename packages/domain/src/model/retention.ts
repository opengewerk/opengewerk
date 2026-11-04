import type { IsoDate, RuleSet } from '@opengewerk/platform-domain'

/**
 * The kinds of record a retention period applies to (#317, sections 1.7 and
 * 7): what the tax code and the commercial code ask a business to keep, and
 * what the minimum wage and working time acts ask of the records of time.
 *
 * The periods are in the rule package `retention`, with where each comes from
 * and since when; this file says which rule a kind reads, from when it counts
 * and how the office calls it. A kind is a kind of paper, not a table: which
 * record of this application is which kind is said by whoever deletes it
 * (#845 the customers, #846 the staff).
 */
export const retentionKinds = [
  'books',
  'booking_vouchers',
  'business_letters',
  'other_tax_documents',
  'minimum_wage_records',
  'working_time_records',
] as const

export type RetentionKind = (typeof retentionKinds)[number]

/**
 * From when a period counts.
 *
 * - `end_of_year`: from the end of the calendar year the paper came about in,
 *   section 147 (4) AO, section 257 (5) HGB and section 14b (1) sentence 3
 *   UStG.
 * - `record`: from the day the record is about, section 17 (1) MiLoG ("ab dem
 *   für die Aufzeichnung maßgeblichen Zeitpunkt"). The day itself counts
 *   (section 187 (2) BGB), so two years from the 1st of March end on the last
 *   day of February two years on (section 188 (2) BGB).
 */
export type RetentionStart = 'end_of_year' | 'record'

export interface RetentionKindWords {
  /** The key of its rule in the package `retention`. */
  readonly rule: string
  readonly starts: RetentionStart
  /** What the office calls the papers, in the table of the periods. */
  readonly label: string
}

export const retentionKindWords: Readonly<Record<RetentionKind, RetentionKindWords>> = {
  books: {
    rule: 'retention.books',
    starts: 'end_of_year',
    label: 'Bücher, Inventare, Jahresabschlüsse',
  },
  booking_vouchers: {
    rule: 'retention.booking_vouchers',
    starts: 'end_of_year',
    label: 'Buchungsbelege und Rechnungen',
  },
  business_letters: {
    rule: 'retention.business_letters',
    starts: 'end_of_year',
    label: 'Handels- und Geschäftsbriefe',
  },
  other_tax_documents: {
    rule: 'retention.other_tax_documents',
    starts: 'end_of_year',
    label: 'Sonstige Unterlagen für die Steuer',
  },
  minimum_wage_records: {
    rule: 'retention.minimum_wage_records',
    starts: 'record',
    label: 'Aufzeichnungen nach dem Mindestlohngesetz',
  },
  working_time_records: {
    rule: 'retention.working_time_records',
    starts: 'record',
    label: 'Nachweise nach dem Arbeitszeitgesetz',
  },
}

/** How long a paper is kept, as of the day that asks. */
export interface Retention {
  readonly years: number
  /** Where the period comes from, as the rule package says. */
  readonly source: string
  /** The last day the paper has to be kept. */
  readonly lastDay: IsoDate
  /** The first day it may go. */
  readonly mayGoOn: IsoDate
}

function isoOf(date: Date): IsoDate {
  return date.toISOString().slice(0, 10) as IsoDate
}

/**
 * How long a paper of a kind that came about on a day is kept, as of today.
 *
 * The period is the one in force today, not the one of the day the paper
 * came about: when the law shortened the period for booking vouchers from ten
 * to eight years, it did so for every paper whose old period had not run out
 * by the end of 2024 (Art. 97 section 19a (2) EGAO). A paper whose old period
 * had run out by then was free to go under both. A day before 2025 still gets
 * the ten years, which is what a pass on such a day would have had to keep.
 *
 * What the engine cannot know is whether the paper still matters for a tax
 * whose assessment period runs (section 147 (3) sentence 5 AO). That is why a
 * deletion is proposed and confirmed, and never decided by this alone.
 */
export function retentionOf(
  kind: RetentionKind,
  cameOn: IsoDate,
  today: IsoDate,
  rules: RuleSet,
): Retention {
  const words = retentionKindWords[kind]
  const rule = rules.at(words.rule, today)

  if (rule === null) {
    throw new Error(`No retention period ${words.rule} on ${today}`)
  }

  const years = rules.valueAt(words.rule, 'years', today)
  const year = Number(cameOn.slice(0, 4))
  const month = Number(cameOn.slice(5, 7))
  const day = Number(cameOn.slice(8, 10))

  if (words.starts === 'end_of_year') {
    return {
      years,
      source: rule.source,
      lastDay: `${String(year + years)}-12-31` as IsoDate,
      mayGoOn: `${String(year + years + 1)}-01-01` as IsoDate,
    }
  }

  // The day that matches the first one, the years later, and the period ends
  // the day before. The 29th of February of a year without one rolls over to
  // the 1st of March, so the period ends on the 28th.
  const matching = new Date(Date.UTC(year + years, month - 1, day))
  const lastDay = new Date(matching.getTime() - 86_400_000)

  return { years, source: rule.source, lastDay: isoOf(lastDay), mayGoOn: isoOf(matching) }
}
