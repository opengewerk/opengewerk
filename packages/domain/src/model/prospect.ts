import { addDays, berlinClock, type IsoDate } from '@opengewerk/platform-domain'

import { type Address, countryProblem } from './address.js'
import { type CustomerKind, customerKinds } from './customer.js'
import { continuesChain, type DocumentKind, type DocumentStatus } from './document.js'
import type { JobStatus } from './job.js'
import type { CustomerId, DocumentId, JobId, ProspectId, SiteId } from './identifier.js'

/**
 * A lead in the words of the concept (3.1, #312): somebody who asked, before
 * there is a customer. A name, how to reach them, what they want, where the
 * lead came from and how far the office has qualified it. It becomes a
 * customer in one step, with a site at its address, and its source stays on
 * the customer.
 *
 * Called a prospect in the code, because "lead" already names the days a
 * deadline reminds ahead (`leadDays`) and the flag of a role that leads the
 * business. The office reads "Lead" everywhere.
 */
export const prospectSources = ['referral', 'website', 'phone', 'email', 'other'] as const

export type ProspectSource = (typeof prospectSources)[number]

export const prospectSourceLabel: Readonly<Record<ProspectSource, string>> = {
  referral: 'Empfehlung',
  website: 'Website',
  phone: 'Anruf',
  email: 'E-Mail',
  other: 'Sonstiges',
}

/**
 * How far the office has qualified a lead, the one stage of the pipeline set
 * by hand: everything after it is read off the documents (3.3). That it
 * became a customer is not a stage, it is the customer it names.
 */
export const prospectStages = ['new', 'contacted', 'qualified', 'dismissed'] as const

export type ProspectStage = (typeof prospectStages)[number]

export const prospectStageLabel: Readonly<Record<ProspectStage, string>> = {
  new: 'Neu',
  contacted: 'Im Gespräch',
  qualified: 'Qualifiziert',
  dismissed: 'Abgesagt',
}

export interface Prospect extends Address {
  readonly id: ProspectId
  readonly kind: CustomerKind
  /** Company name, or the family name of a private person, as a customer has it. */
  readonly name: string
  /** What they asked for, in their words or the office's. */
  readonly concern: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly source: ProspectSource
  readonly stage: ProspectStage
  /**
   * The last day somebody spoke or wrote to them. A lead that never becomes a
   * customer is proposed for deletion twelve months after it (decided on
   * 27.09.2026); the proposal is the deletion run's (#317).
   */
  readonly lastContactOn: IsoDate
  /** The customer and the site it became, with the moment; null until then. */
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly convertedAt: string | null
}

export const prospectLimits = {
  name: 200,
  concern: 5000,
} as const

const isoDay = /^\d{4}-\d{2}-\d{2}$/

function isDay(value: unknown): value is IsoDate {
  return (
    typeof value === 'string' &&
    isoDay.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  )
}

function optionalText(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string'
}

/**
 * What is wrong with the values of a lead, by field, in the words the form
 * shows under each field. Checked as a whole, with `today` in Berlin: a last
 * contact is a day that has been.
 */
export function prospectProblems(
  values: Readonly<Record<string, unknown>>,
  today: IsoDate,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const name = values['name']

  if (typeof name !== 'string' || name.trim() === '') {
    problems['name'] = 'Ein Lead braucht einen Namen.'
  } else if (name.trim().length > prospectLimits.name) {
    problems['name'] = `Ein Name hat höchstens ${String(prospectLimits.name)} Zeichen.`
  }

  if (!customerKinds.includes(values['kind'] as CustomerKind)) {
    problems['kind'] = 'Die Art fehlt.'
  }

  const concern = values['concern']

  if (!optionalText(concern)) {
    problems['concern'] = 'Hier steht Text.'
  } else if (typeof concern === 'string' && concern.length > prospectLimits.concern) {
    problems['concern'] = `Hier stehen höchstens ${String(prospectLimits.concern)} Zeichen.`
  }

  for (const field of ['email', 'phone', 'street', 'houseNumber', 'postalCode', 'city']) {
    if (!optionalText(values[field])) {
      problems[field] = 'Hier steht Text.'
    }
  }

  const country = countryProblem(values['country'])

  if (country !== null) {
    problems['country'] = country
  }

  if (!prospectSources.includes(values['source'] as ProspectSource)) {
    problems['source'] = 'Woher der Lead kommt, fehlt.'
  }

  if (!prospectStages.includes(values['stage'] as ProspectStage)) {
    problems['stage'] = 'Der Stand fehlt.'
  }

  const lastContactOn = values['lastContactOn']

  if (!isDay(lastContactOn)) {
    problems['lastContactOn'] = 'Der letzte Kontakt ist ein Tag.'
  } else if (lastContactOn > today) {
    problems['lastContactOn'] = 'Der letzte Kontakt liegt nicht in der Zukunft.'
  }

  return problems
}

/** Whether a lead became a customer. */
export function isConverted(prospect: Pick<Prospect, 'customerId'>): boolean {
  return prospect.customerId !== null
}

/**
 * Why a lead does not change, or null when it may. Once it is a customer,
 * the customer is what changes; the lead stays as it was, the record of how
 * the customer came.
 */
export function prospectChangeProblem(prospect: Pick<Prospect, 'customerId'>): string | null {
  return isConverted(prospect)
    ? 'Aus diesem Lead ist ein Kunde geworden. Geändert wird jetzt der Kunde, der Lead bleibt, wie er war.'
    : null
}

/**
 * Why a lead is not deleted on its own, or null when it may be. A lead that
 * became a customer is the record of how the customer came, which the
 * evaluations of phase 6 count; it goes with the customer under the deletion
 * concept (#317).
 */
export function prospectDeletionProblem(prospect: Pick<Prospect, 'customerId'>): string | null {
  return isConverted(prospect)
    ? 'Aus diesem Lead ist ein Kunde geworden. Er bleibt als Nachweis, wie der Kunde kam.'
    : null
}

/** Why a lead does not become a customer now, or null when it may. */
export function conversionProblem(prospect: Pick<Prospect, 'customerId' | 'stage'>): string | null {
  if (isConverted(prospect)) {
    return 'Aus diesem Lead ist schon ein Kunde geworden.'
  }

  if (prospect.stage === 'dismissed') {
    return 'Der Lead ist abgesagt. Wird er wieder aufgenommen, kann er Kunde werden.'
  }

  return null
}

/**
 * What the site of a converted lead is called unless the office says
 * otherwise: its street and number, as the canvas names a site, or the place,
 * or the lead's name where there is no address at all.
 */
export function siteDesignationOf(
  prospect: Pick<Prospect, 'name' | 'street' | 'houseNumber' | 'city'>,
): string {
  const street = [prospect.street, prospect.houseNumber]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(' ')

  if (street !== '') {
    return street
  }

  return prospect.city?.trim() || prospect.name.trim()
}

// --- The pipeline -----------------------------------------------------------------------------

/** The four columns of section 3.3. */
export const pipelineStages = ['lead', 'offer', 'order', 'done'] as const

export type PipelineStage = (typeof pipelineStages)[number]

export const pipelineStageLabel: Readonly<Record<PipelineStage, string>> = {
  lead: 'Lead',
  offer: 'Angebot',
  order: 'Auftrag',
  done: 'Abgeschlossen',
}

/** How long a closed deal stays in the last column. */
export const pipelineDoneDays = 90

/** The kinds that offer work: a chain of the pipeline starts with one of them. */
const offerKinds: readonly DocumentKind[] = ['quote', 'cost_estimate']

/** What the pipeline reads of a document. */
export interface PipelineDocument {
  readonly id: DocumentId
  readonly kind: DocumentKind
  readonly status: DocumentStatus
  readonly customerId: CustomerId
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
  readonly predecessorDocumentId: DocumentId | null
  /** The moment it was issued, as the record carries it; null for a draft. */
  readonly issuedAt: string | null
}

/** What the pipeline reads of a job. */
export interface PipelineJob {
  readonly id: JobId
  readonly status: JobStatus
  readonly closedAt: string | null
}

/**
 * A maintenance contract made out of an offer (#294): the sale is closed on
 * the day it was made, and the maintenances that follow are service jobs of
 * their own.
 */
export interface PipelineContract {
  readonly quoteId: DocumentId
  readonly since: IsoDate
}

/** What the pipeline reads of a lead. */
export type PipelineProspect = Pick<
  Prospect,
  'id' | 'stage' | 'lastContactOn' | 'customerId' | 'convertedAt'
>

export interface PipelineLead {
  readonly stage: 'lead'
  readonly prospectId: ProspectId
  readonly customerId: CustomerId | null
}

/**
 * A deal past the lead: a chain of documents from an offer, or from an order
 * confirmation that had none, with the customer, site and job it names.
 */
export interface PipelineDeal {
  readonly stage: 'offer' | 'order' | 'done'
  /** The document the chain starts with. */
  readonly headId: DocumentId
  /** The document the card shows: the offer, the order confirmation, the final invoice. */
  readonly shownId: DocumentId
  readonly customerId: CustomerId
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
  /** The day it reached its stage, in Berlin. */
  readonly since: IsoDate
}

export interface Pipeline {
  readonly lead: readonly PipelineLead[]
  readonly offer: readonly PipelineDeal[]
  readonly order: readonly PipelineDeal[]
  readonly done: readonly PipelineDeal[]
}

function dayOf(moment: string): IsoDate {
  return berlinClock(new Date(moment)).day
}

const stageOrder: Readonly<Record<ProspectStage, number>> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  dismissed: 3,
}

/**
 * The pipeline of section 3.3, read off the records wherever they say it
 * (#312): only the stage of a lead is set by hand.
 *
 * - **Lead**: a lead that is not dismissed and no customer, and one that
 *   became a customer who has no offer and no order yet.
 * - **Angebot**: an issued quote or cost estimate that no issued document
 *   follows in its chain, unless the office marked it as declined (#841).
 * - **Auftrag**: one that an issued document follows, an order confirmation,
 *   an invoice or a delivery note, and an issued order confirmation that had
 *   no offer before it.
 * - **Abgeschlossen**: one whose chain has an issued final invoice or whose
 *   job is completed, and an offer a maintenance contract was made out of,
 *   the last `doneDays` days.
 *
 * A chain whose job was cancelled, and a document cancelled, are not in it;
 * the caller passes no deleted record. A draft that follows does not count: an order confirmation is an
 * order once it is issued.
 */
export function pipelineOf(input: {
  readonly prospects: readonly PipelineProspect[]
  readonly documents: readonly PipelineDocument[]
  readonly jobs: readonly PipelineJob[]
  readonly contracts?: readonly PipelineContract[]
  /** The offers the office marked as declined (#841). */
  readonly declined?: readonly DocumentId[]
  readonly today: IsoDate
  readonly doneDays?: number
}): Pipeline {
  const doneFrom = addDays(input.today, -(input.doneDays ?? pipelineDoneDays))
  const jobs = new Map(input.jobs.map((job) => [job.id, job]))
  const contracts = new Map((input.contracts ?? []).map((contract) => [contract.quoteId, contract]))
  const declined = new Set(input.declined ?? [])
  const following = new Map<DocumentId, PipelineDocument[]>()

  for (const document of input.documents) {
    if (document.predecessorDocumentId !== null && continuesChain(document)) {
      const list = following.get(document.predecessorDocumentId) ?? []

      list.push(document)
      following.set(document.predecessorDocumentId, list)
    }
  }

  const issued = (
    document: PipelineDocument,
  ): document is PipelineDocument & { issuedAt: string } =>
    document.status === 'issued' && document.issuedAt !== null
  const heads = input.documents
    .filter(issued)
    .filter(
      (document) =>
        offerKinds.includes(document.kind) ||
        (document.kind === 'order_confirmation' && document.predecessorDocumentId === null),
    )

  const offer: PipelineDeal[] = []
  const order: PipelineDeal[] = []
  const done: PipelineDeal[] = []
  const customersWithDeals = new Set<CustomerId>()

  for (const head of heads) {
    customersWithDeals.add(head.customerId)

    // The chain does not branch (`continuesChain`): one document follows the last.
    const chain: PipelineDocument[] = [head]
    const seen = new Set<DocumentId>([head.id])
    let last: PipelineDocument = head

    for (;;) {
      const next = (following.get(last.id) ?? []).find((document) => !seen.has(document.id))

      if (next === undefined) {
        break
      }

      chain.push(next)
      seen.add(next.id)
      last = next
    }

    const jobIds = [
      ...new Set(chain.flatMap((document) => (document.jobId === null ? [] : [document.jobId]))),
    ]
    const chainJobs = jobIds.flatMap((id) => {
      const job = jobs.get(id)

      return job === undefined ? [] : [job]
    })

    if (chainJobs.some((job) => job.status === 'cancelled')) {
      continue
    }

    const after = chain.slice(1).filter(issued)
    const confirmation =
      head.kind === 'order_confirmation'
        ? head
        : after.find((document) => document.kind === 'order_confirmation')
    const finalInvoice = after.find((document) => document.kind === 'final_invoice')
    const closed = chainJobs.find((job) => job.status === 'completed' && job.closedAt !== null)
    const contract = contracts.get(head.id)
    const deal = {
      headId: head.id,
      customerId: head.customerId,
      siteId: head.siteId ?? chain.find((document) => document.siteId !== null)?.siteId ?? null,
      jobId: jobIds[0] ?? null,
    }

    if (finalInvoice !== undefined || closed !== undefined || contract !== undefined) {
      const days = [
        ...(finalInvoice === undefined ? [] : [dayOf(finalInvoice.issuedAt)]),
        ...(closed?.closedAt ? [dayOf(closed.closedAt)] : []),
        ...(contract === undefined ? [] : [contract.since]),
      ].sort()
      const since = days[0] ?? input.today

      if (since >= doneFrom) {
        done.push({
          ...deal,
          stage: 'done',
          shownId: (finalInvoice ?? confirmation ?? head).id,
          since,
        })
      }

      continue
    }

    const firstAfter = after[0]

    if (head.kind === 'order_confirmation' || firstAfter !== undefined) {
      const ordered = head.kind === 'order_confirmation' ? head : (firstAfter ?? head)

      order.push({
        ...deal,
        stage: 'order',
        shownId: (confirmation ?? head).id,
        since: dayOf(ordered.issuedAt),
      })

      continue
    }

    // Turned down by the customer, as the office marked it (#841): in no column.
    if (declined.has(head.id)) {
      continue
    }

    offer.push({ ...deal, stage: 'offer', shownId: head.id, since: dayOf(head.issuedAt) })
  }

  const lead = input.prospects
    .filter(
      (prospect) =>
        prospect.stage !== 'dismissed' &&
        (prospect.customerId === null || !customersWithDeals.has(prospect.customerId)),
    )
    .sort((one, other) => {
      const rank = (prospect: PipelineProspect) =>
        prospect.customerId === null ? stageOrder[prospect.stage] : 9

      return (
        rank(one) - rank(other) ||
        (one.lastContactOn < other.lastContactOn
          ? 1
          : one.lastContactOn > other.lastContactOn
            ? -1
            : 0)
      )
    })
    .map((prospect) => ({
      stage: 'lead' as const,
      prospectId: prospect.id,
      customerId: prospect.customerId,
    }))

  const oldestFirst = (one: PipelineDeal, other: PipelineDeal) =>
    one.since < other.since ? -1 : one.since > other.since ? 1 : 0

  return {
    lead,
    offer: offer.sort(oldestFirst),
    order: order.sort(oldestFirst),
    done: done.sort((one, other) => oldestFirst(other, one)),
  }
}
