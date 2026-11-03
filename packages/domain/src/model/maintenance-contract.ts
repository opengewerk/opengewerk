import { addDays, addMonths, type IsoDate, type RuleSet } from '@opengewerk/platform-domain'

import type { MaintenanceContractId } from './identifier.js'

/**
 * A maintenance contract (#294, section 3.5): a customer has the business look
 * after installations at a site every so many months, for a first term that
 * may renew, at a flat price per maintenance or at the effort the report
 * writes down.
 *
 * It comes out of an issued quote with the maintenance services, which carried
 * the instructions about the right of withdrawal like every quote (#111); the
 * quote is where the customer agreed to it, so the contract keeps it. One
 * contract per quote.
 *
 * Kept on the server only: the office reads and writes it at a desk, and what
 * reaches a device is the service job each maintenance makes.
 */

/**
 * What happens at the end of the first term when nobody gave notice:
 *
 * - `none`: the contract ends with the term.
 * - `fixed`: it renews for the same number of months each time,
 *   `renewalMonths`, until somebody gives notice before the end of a term.
 * - `indefinite`: it runs on without an end, and a notice ends it after the
 *   notice period from the day it came in.
 */
export const renewalKinds = ['none', 'fixed', 'indefinite'] as const

export type RenewalKind = (typeof renewalKinds)[number]

/** A flat price per maintenance, or the effort the report of the maintenance writes down. */
export const contractPriceKinds = ['flat', 'effort'] as const

export type ContractPriceKind = (typeof contractPriceKinds)[number]

/**
 * When the customer pays. `visit` is an invoice after each maintenance; the
 * others are a recurring invoice per period (#295), which only a flat price
 * can be.
 */
export const paymentRhythms = ['visit', 'monthly', 'quarterly', 'yearly'] as const

export type PaymentRhythm = (typeof paymentRhythms)[number]

export interface MaintenanceContract {
  readonly id: MaintenanceContractId
  readonly tenantId: string
  /** From the number range `contract`, given when the contract is made. */
  readonly number: string
  readonly designation: string
  readonly customerId: string
  readonly siteId: string | null
  /** The issued quote it came out of, one contract per quote. */
  readonly quoteId: string
  /** The installations it covers, all at its site. */
  readonly installationIds: readonly string[]
  /** The services included, one per line, as the quote listed them. */
  readonly services: string | null
  readonly startsOn: IsoDate
  readonly firstVisitOn: IsoDate
  readonly intervalMonths: number
  readonly termMonths: number
  readonly renewal: RenewalKind
  readonly renewalMonths: number | null
  readonly noticeMonths: number
  readonly priceKind: ContractPriceKind
  /** Net, per maintenance; null for a contract at effort. */
  readonly flatCents: number | null
  readonly paymentRhythm: PaymentRhythm
  /**
   * Whether the recurring invoices of a contract paid per period are issued
   * and sent by mail without anybody (#295), from the second on: the first of
   * a contract always waits as a draft.
   */
  readonly issueByItself: boolean
  /** The day a notice came in, and the day the contract ends because of it. */
  readonly cancelledOn: IsoDate | null
  readonly endsOn: IsoDate | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** What the term and the notice of a contract are counted from. */
export type ContractTerms = Pick<
  MaintenanceContract,
  'startsOn' | 'termMonths' | 'renewal' | 'renewalMonths' | 'noticeMonths'
>

export const maintenanceContractLimits = {
  designation: 200,
  services: 5000,
  intervalMonths: 120,
  termMonths: 120,
  renewalMonths: 60,
  noticeMonths: 24,
  installations: 50,
  /** A hundred thousand euros a maintenance, in cents. */
  flatCents: 10_000_000,
} as const

/** The last day of the term with this number, counted from 0 for the first; each counted from the start, so no day drifts. */
function endOfTerm(terms: ContractTerms, index: number): IsoDate {
  const months = terms.termMonths + index * (terms.renewalMonths ?? 0)

  return addDays(addMonths(terms.startsOn, months), -1)
}

/** The last day on which a notice still ends the contract at the end of this term. */
export function lastNoticeDay(termEndsOn: IsoDate, noticeMonths: number): IsoDate {
  return addDays(addMonths(addDays(termEndsOn, 1), -noticeMonths), -1)
}

/**
 * How many terms the loops below look through: enough for a contract of one
 * month renewing for a month to run a hundred years, and a stop for a
 * contract whose numbers came in wrong.
 */
const termsLooked = 1200

/**
 * The last day of the term that runs on a day: the first term, a renewed one,
 * or null when the contract runs on without end after its first term
 * (`indefinite`). For `none` it is the end of the first term, also after it.
 */
export function termEndOn(terms: ContractTerms, on: IsoDate): IsoDate | null {
  const first = endOfTerm(terms, 0)

  if (on <= first || terms.renewal === 'none') {
    return first
  }

  if (terms.renewal === 'indefinite' || (terms.renewalMonths ?? 0) < 1) {
    return null
  }

  for (let index = 1; index < termsLooked; index += 1) {
    const end = endOfTerm(terms, index)

    if (on <= end) {
      return end
    }
  }

  return null
}

/**
 * The day a contract ends after a notice that came in on a day:
 *
 * - `none`: with its first term, whenever the notice came.
 * - `fixed`: with the first term whose last day for a notice the notice
 *   still met.
 * - `indefinite`: with the first term if the notice met its last day,
 *   otherwise after the notice period from the day it came in.
 */
export function endAfterNotice(terms: ContractTerms, receivedOn: IsoDate): IsoDate {
  const first = endOfTerm(terms, 0)

  if (terms.renewal === 'none') {
    return first
  }

  if (receivedOn <= lastNoticeDay(first, terms.noticeMonths)) {
    return first
  }

  if (terms.renewal === 'indefinite' || (terms.renewalMonths ?? 0) < 1) {
    return addMonths(receivedOn, terms.noticeMonths)
  }

  for (let index = 1; index < termsLooked; index += 1) {
    const end = endOfTerm(terms, index)

    if (receivedOn <= lastNoticeDay(end, terms.noticeMonths)) {
      return end
    }
  }

  return endOfTerm(terms, termsLooked)
}

/**
 * The last day a maintenance may be due on: the day a notice ends the
 * contract, the end of the first term of one that does not renew, or null
 * while it runs on.
 */
export function lastServiceDay(
  contract: ContractTerms & Pick<MaintenanceContract, 'endsOn'>,
): IsoDate | null {
  if (contract.endsOn !== null) {
    return contract.endsOn
  }

  return contract.renewal === 'none' ? endOfTerm(contract, 0) : null
}

/**
 * The next day a maintenance is due that has not made its service job yet:
 * the first visit and every so many months after it, each counted from the
 * first, after the last one made and not before the day the contract was
 * entered, and not after its last day. Null when there is none left.
 *
 * Not before the day it was entered: a contract taken over from paper has
 * its maintenances of the past done already, and a service job for each
 * of them would only have to be deleted again.
 */
export function nextVisitOn(
  contract: Pick<MaintenanceContract, 'firstVisitOn' | 'intervalMonths'>,
  window: {
    readonly lastMadeOn: IsoDate | null
    readonly notBefore: IsoDate
    readonly lastDay: IsoDate | null
  },
): IsoDate | null {
  if (contract.intervalMonths < 1) {
    return null
  }

  for (let index = 0; index < termsLooked; index += 1) {
    const day = addMonths(contract.firstVisitOn, index * contract.intervalMonths)

    if (window.lastDay !== null && day > window.lastDay) {
      return null
    }

    if ((window.lastMadeOn === null || day > window.lastMadeOn) && day >= window.notBefore) {
      return day
    }
  }

  return null
}

/** How many months a period of each rhythm has; null for an invoice per maintenance. */
export const periodMonths: Readonly<Record<PaymentRhythm, number | null>> = {
  visit: null,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
}

/** How a contract is paid, in the words of the contract screen. */
export const rhythmLabel: Readonly<Record<PaymentRhythm, string>> = {
  visit: 'je Wartung, nach der Ausführung',
  monthly: 'monatlich, zu Beginn des Monats',
  quarterly: 'vierteljährlich, zu Beginn des Quartals',
  yearly: 'jährlich, zu Beginn des Jahres',
}

/** What the flat price is for: "je Wartung", "je Monat". */
export const priceUnitLabel: Readonly<Record<PaymentRhythm, string>> = {
  visit: 'je Wartung',
  monthly: 'je Monat',
  quarterly: 'je Quartal',
  yearly: 'je Jahr',
}

/** One period a recurring invoice bills (#295). */
export interface BilledPeriod {
  readonly from: IsoDate
  readonly until: IsoDate
  /** Cut short by the last day of the contract: billed as a draft, never by itself. */
  readonly cut: boolean
}

/**
 * The next period of a contract paid per period that has no invoice yet: from
 * its start, each so many months, each counted from the start; after the last
 * one billed, not starting before the day the contract was entered, and not
 * starting after its last day. A period that runs past the last day ends with
 * it. Null for a contract paid per maintenance, and once there is none left.
 *
 * Not before the day it was entered: a contract taken over from paper had its
 * periods before that billed already, like its maintenances were done.
 */
export function nextPeriod(
  contract: Pick<MaintenanceContract, 'startsOn' | 'paymentRhythm'>,
  window: {
    readonly lastBilledFrom: IsoDate | null
    readonly notBefore: IsoDate
    readonly lastDay: IsoDate | null
  },
): BilledPeriod | null {
  const months = periodMonths[contract.paymentRhythm]

  if (months === null) {
    return null
  }

  for (let index = 0; index < termsLooked; index += 1) {
    const from = addMonths(contract.startsOn, index * months)

    if (window.lastDay !== null && from > window.lastDay) {
      return null
    }

    if (
      (window.lastBilledFrom === null || from > window.lastBilledFrom) &&
      from >= window.notBefore
    ) {
      const until = addDays(addMonths(contract.startsOn, (index + 1) * months), -1)
      const cut = window.lastDay !== null && until > window.lastDay

      return { from, until: cut && window.lastDay !== null ? window.lastDay : until, cut }
    }
  }

  return null
}

/** "01.12.2026 bis 31.12.2026". */
export function periodText(period: Pick<BilledPeriod, 'from' | 'until'>): string {
  return `${germanDay(period.from)} bis ${germanDay(period.until)}`
}

/** "alle 6 Monate", or "jeden Monat". */
export function intervalLabel(months: number): string {
  return months === 1 ? 'jeden Monat' : `alle ${String(months)} Monate`
}

/** What happens after the first term, in the words of the contract screen. */
export function renewalLabel(terms: Pick<ContractTerms, 'renewal' | 'renewalMonths'>): string {
  switch (terms.renewal) {
    case 'none':
      return 'endet mit der Laufzeit'
    case 'fixed':
      return terms.renewalMonths === 1
        ? 'verlängert sich um einen Monat'
        : `verlängert sich um ${String(terms.renewalMonths ?? 0)} Monate`
    case 'indefinite':
      return 'verlängert sich auf unbestimmte Zeit'
  }
}

/** "1 Monat", "3 Monate". */
export function monthsLabel(months: number): string {
  return months === 1 ? '1 Monat' : `${String(months)} Monate`
}

/**
 * Where a contract stands on a day, for the list and the head of the
 * contract: running until the end of its term, running without end, given
 * notice to a day, or over.
 */
export function contractStanding(
  contract: ContractTerms & Pick<MaintenanceContract, 'endsOn'>,
  today: IsoDate,
): { readonly text: string; readonly tone: 'running' | 'ending' | 'over' } {
  if (contract.endsOn !== null) {
    return contract.endsOn < today
      ? { text: `Beendet am ${germanDay(contract.endsOn)}`, tone: 'over' }
      : { text: `Gekündigt zum ${germanDay(contract.endsOn)}`, tone: 'ending' }
  }

  const end = termEndOn(contract, today)

  if (end === null) {
    return { text: 'Unbefristet', tone: 'running' }
  }

  if (contract.renewal === 'none') {
    return end < today
      ? { text: `Beendet am ${germanDay(end)}`, tone: 'over' }
      : { text: `Endet am ${germanDay(end)}`, tone: 'ending' }
  }

  return { text: `Läuft bis ${germanDay(end)}`, tone: 'running' }
}

/** 2027-12-31 as 31.12.2027. */
function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/**
 * What the service job of a maintenance says about itself (#294), for
 * whoever goes there: the contract and the day, and the services the
 * contract includes, one per line as the contract lists them.
 */
export function visitDescription(
  contract: Pick<MaintenanceContract, 'number' | 'services'>,
  dueOn: IsoDate,
): string {
  const services = (contract.services ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const head = `Wartung nach dem Wartungsvertrag ${contract.number}, fällig am ${germanDay(dueOn)}.`

  return services.length === 0
    ? head
    : [head, '', 'Enthaltene Leistungen:', ...services.map((line) => `- ${line}`)].join('\n')
}

/**
 * What to say about the terms of a contract with a consumer that § 309 Nr. 9
 * BGB makes void in standard business terms (#294), or null when there is
 * nothing to say. Nothing is refused: negotiated one by one, such terms may
 * stand, and only the office knows whether they were.
 *
 * The limits come from the rule package `contract` at the day the contract
 * begins, so that the law before the 1st of March 2022 holds for a contract
 * of that time and a change in the law is a record and not a release.
 */
export function consumerTermsNotice(rules: RuleSet, terms: ContractTerms): string | null {
  const on = terms.startsOn
  const limit = (key: string): number | null =>
    rules.at(key, on) === null ? null : rules.valueAt(key, 'months', on)
  const maximumTerm = limit('contract.consumer_maximum_term_months')
  const maximumRenewal = limit('contract.consumer_maximum_renewal_months')
  const maximumNotice = limit('contract.consumer_maximum_notice_months')
  const found: string[] = []

  if (maximumTerm !== null && terms.termMonths > maximumTerm) {
    found.push(`eine Laufzeit über ${monthsLabel(maximumTerm)} (Buchst. a)`)
  }

  if (terms.renewal === 'fixed' && maximumRenewal !== null) {
    if (maximumRenewal === 0) {
      found.push(
        'eine stillschweigende Verlängerung um eine feste Zeit; zulässig ist nur eine auf ' +
          'unbestimmte Zeit, danach jederzeit kündbar (Buchst. b)',
      )
    } else if ((terms.renewalMonths ?? 0) > maximumRenewal) {
      found.push(
        `eine stillschweigende Verlängerung um mehr als ${monthsLabel(maximumRenewal)} (Buchst. b)`,
      )
    }
  }

  if (terms.renewal !== 'none' && maximumNotice !== null && terms.noticeMonths > maximumNotice) {
    found.push(`eine Kündigungsfrist über ${monthsLabel(maximumNotice)} (Buchst. b und c)`)
  }

  if (found.length === 0) {
    return null
  }

  return (
    'Gegenüber einem Verbraucher in Allgemeinen Geschäftsbedingungen unwirksam ' +
    `(§ 309 Nr. 9 BGB): ${found.join('; ')}. Einzeln ausgehandelt darf es so stehen.`
  )
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/

function isDay(value: unknown): value is IsoDate {
  return (
    typeof value === 'string' &&
    isoDay.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  )
}

function wholeBetween(value: unknown, low: number, high: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high
}

/**
 * What is wrong with the values of a contract, by field, in the words the
 * form shows under each field. Checked as a whole, so a change that sends
 * only the renewal is held against the months already there.
 */
export function maintenanceContractProblems(
  contract: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const limits = maintenanceContractLimits
  const designation = contract['designation']

  if (typeof designation !== 'string' || designation.trim() === '') {
    problems['designation'] = 'Ein Wartungsvertrag braucht eine Bezeichnung.'
  } else if (designation.trim().length > limits.designation) {
    problems['designation'] =
      `Eine Bezeichnung hat höchstens ${String(limits.designation)} Zeichen.`
  }

  const services = contract['services']

  if (services !== null && services !== undefined && typeof services !== 'string') {
    problems['services'] = 'Hier steht Text.'
  } else if (typeof services === 'string' && services.length > limits.services) {
    problems['services'] = `Hier stehen höchstens ${String(limits.services)} Zeichen.`
  }

  const startsOn = contract['startsOn']
  const firstVisitOn = contract['firstVisitOn']

  if (!isDay(startsOn)) {
    problems['startsOn'] = 'Der Beginn ist ein Tag.'
  }

  if (!isDay(firstVisitOn)) {
    problems['firstVisitOn'] = 'Die erste Wartung ist ein Tag.'
  } else if (isDay(startsOn) && firstVisitOn < startsOn) {
    problems['firstVisitOn'] = 'Die erste Wartung liegt nicht vor dem Beginn.'
  }

  if (!wholeBetween(contract['intervalMonths'], 1, limits.intervalMonths)) {
    problems['intervalMonths'] =
      `Das Intervall sind ganze Monate, 1 bis ${String(limits.intervalMonths)}.`
  }

  if (!wholeBetween(contract['termMonths'], 1, limits.termMonths)) {
    problems['termMonths'] = `Die Laufzeit sind ganze Monate, 1 bis ${String(limits.termMonths)}.`
  }

  const renewal = contract['renewal']

  if (!renewalKinds.includes(renewal as RenewalKind)) {
    problems['renewal'] = 'Was nach der Laufzeit geschieht, fehlt.'
  } else if (renewal === 'fixed') {
    if (!wholeBetween(contract['renewalMonths'], 1, limits.renewalMonths)) {
      problems['renewalMonths'] =
        `Die Verlängerung sind ganze Monate, 1 bis ${String(limits.renewalMonths)}.`
    }
  } else if (contract['renewalMonths'] !== null && contract['renewalMonths'] !== undefined) {
    problems['renewalMonths'] = 'Nur eine Verlängerung um eine feste Zeit hat Monate.'
  }

  if (!wholeBetween(contract['noticeMonths'], 0, limits.noticeMonths)) {
    problems['noticeMonths'] =
      `Die Kündigungsfrist sind ganze Monate, 0 bis ${String(limits.noticeMonths)}.`
  }

  const priceKind = contract['priceKind']
  const flatCents = contract['flatCents']

  if (!contractPriceKinds.includes(priceKind as ContractPriceKind)) {
    problems['priceKind'] = 'Wie abgerechnet wird, fehlt.'
  } else if (priceKind === 'flat') {
    if (!wholeBetween(flatCents, 0, limits.flatCents)) {
      problems['flatCents'] = 'Die Pauschale ist ein Betrag in Euro, höchstens 100.000,00 €.'
    }
  } else if (flatCents !== null && flatCents !== undefined) {
    problems['flatCents'] = 'Nach Aufwand hat keine Pauschale.'
  }

  const rhythm = contract['paymentRhythm']

  if (!paymentRhythms.includes(rhythm as PaymentRhythm)) {
    problems['paymentRhythm'] = 'Wann gezahlt wird, fehlt.'
  } else if (rhythm !== 'visit' && priceKind !== 'flat') {
    problems['paymentRhythm'] = 'Eine Rechnung je Zeitraum braucht eine Pauschale.'
  }

  if (
    contract['issueByItself'] !== undefined &&
    contract['issueByItself'] !== null &&
    typeof contract['issueByItself'] !== 'boolean'
  ) {
    problems['issueByItself'] = 'Hier steht ja oder nein.'
  } else if (contract['issueByItself'] === true && rhythm === 'visit') {
    problems['issueByItself'] = 'Ohne Zutun gehen nur Rechnungen je Zeitraum hinaus.'
  }

  const installationIds = contract['installationIds']

  if (
    !Array.isArray(installationIds) ||
    installationIds.length > limits.installations ||
    installationIds.some((id) => typeof id !== 'string') ||
    new Set(installationIds).size !== installationIds.length
  ) {
    problems['installationIds'] = `Höchstens ${String(limits.installations)} Anlagen, jede einmal.`
  }

  return problems
}
