import type { IsoDate } from '@opengewerk/platform-domain'

import type { DocumentKind, DocumentStatus } from './document.js'
import type { DocumentId, OfferDeclineId } from './identifier.js'

/**
 * That the customer turned an offer down (#841, decided on 04.11.2026): the
 * office marks it, because no document says so. An offer is not cancelled,
 * only invoices are, so without the mark a declined quote stayed under
 * "Angebot" in the pipeline and its follow-up came back again and again.
 *
 * Kept beside the document and not on it: the document is fixed once issued,
 * and a mark that is taken back when the customer returns is no change to
 * what went out. Kept as a record, so that the evaluations of phase 6 (#407)
 * can count which offer was declined and when.
 */
export interface OfferDecline {
  readonly id: OfferDeclineId
  readonly documentId: DocumentId
  readonly declinedOn: IsoDate
  /** Why, in the words of the office; may be left out. */
  readonly reason: string | null
}

/** The kinds that offer work and can be turned down: the quote and the cost estimate. */
export const declinableKinds: readonly DocumentKind[] = ['quote', 'cost_estimate']

export const offerDeclineLimits = {
  reason: 500,
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

/**
 * Why an offer cannot be marked as declined, or null when it can: an issued
 * quote or cost estimate that nothing follows yet, no document, not even a
 * draft, and no maintenance contract. Once something follows, the customer
 * took it, and the documents say so.
 */
export function declineRefusal(offer: {
  readonly kind: DocumentKind
  readonly status: DocumentStatus
  readonly followed: boolean
  readonly contracted: boolean
}): string | null {
  if (!declinableKinds.includes(offer.kind)) {
    return 'Abgelehnt werden kann nur ein Angebot oder ein Kostenvoranschlag.'
  }

  if (offer.status !== 'issued') {
    return 'Abgelehnt werden kann nur ein festgeschriebenes Angebot.'
  }

  if (offer.contracted) {
    return 'Aus diesem Angebot ist ein Wartungsvertrag entstanden. Abgelehnt ist es damit nicht.'
  }

  if (offer.followed) {
    return 'Aus diesem Angebot ist schon ein Beleg entstanden. Abgelehnt ist es damit nicht.'
  }

  return null
}

/** The sentence that refuses a successor or a contract out of a declined offer. */
export const declinedOfferRefusal =
  'Das Angebot ist als abgelehnt markiert. Will der Kunde doch, erst die Ablehnung zurücknehmen.'

/**
 * What is wrong with the values of a decline, by field: the day it was
 * declined, not before the offer and not after today, and a reason of at
 * most 500 characters.
 */
export function offerDeclineProblems(
  values: Readonly<Record<string, unknown>>,
  bounds: { readonly today: IsoDate; readonly offeredOn: IsoDate },
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const declinedOn = values['declinedOn']

  if (!isDay(declinedOn)) {
    problems['declinedOn'] = 'Der Tag der Ablehnung ist ein Tag.'
  } else if (declinedOn > bounds.today) {
    problems['declinedOn'] = 'Der Tag der Ablehnung liegt nicht in der Zukunft.'
  } else if (declinedOn < bounds.offeredOn) {
    problems['declinedOn'] = 'Abgelehnt wird ein Angebot nicht vor seinem Datum.'
  }

  const reason = values['reason']

  if (reason !== null && reason !== undefined && typeof reason !== 'string') {
    problems['reason'] = 'Hier steht Text.'
  } else if (typeof reason === 'string' && reason.length > offerDeclineLimits.reason) {
    problems['reason'] = `Hier stehen höchstens ${String(offerDeclineLimits.reason)} Zeichen.`
  }

  return problems
}
