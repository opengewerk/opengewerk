import type { IsoDate, RuleSet } from '@opengewerk/platform-domain'

import { retentionOf } from './retention.js'

/**
 * When the site of a deleted customer goes under the deletion concept (#848,
 * decided on 04. and 05.11.2026). Deleting a customer (#845) leaves its sites
 * with their installations and protocols, without anything of the customer,
 * as the business's proof against a claim for damages. That proof is needed
 * for as long as such a claim can be made, ten years from when it arises
 * (section 199 (3) BGB, the period `site_records` in the rule package
 * `retention`).
 *
 * The ten years count from the youngest signed protocol at the site: of an
 * installation, of an appliance of the register (DGUV regulation 3) or the
 * acceptance of a job there, since each of them can be the proof. A site
 * without any counts from its last job closed, since claims come from the
 * work; one without either goes with its customer.
 */

/** What the ten years of a site count from. */
export interface SiteErasureAnchor {
  readonly kind: 'protocol' | 'job'
  readonly on: IsoDate
}

/** The anchor of a site: its youngest signed protocol, else its last job closed, else none. */
export function siteErasureAnchor(facts: {
  readonly lastProtocolOn: IsoDate | null
  readonly lastJobClosedOn: IsoDate | null
}): SiteErasureAnchor | null {
  if (facts.lastProtocolOn !== null) {
    return { kind: 'protocol', on: facts.lastProtocolOn }
  }

  return facts.lastJobClosedOn === null ? null : { kind: 'job', on: facts.lastJobClosedOn }
}

/**
 * The first day the site of a customer deleted on a day may go: ten years
 * after its anchor, and never before the customer went. A site without an
 * anchor goes on the day its customer went.
 */
export function siteErasureDueOn(
  anchor: SiteErasureAnchor | null,
  customerErasedOn: IsoDate,
  today: IsoDate,
  rules: RuleSet,
): IsoDate {
  if (anchor === null) {
    return customerErasedOn
  }

  const { mayGoOn } = retentionOf('site_records', anchor.on, today, rules)

  return mayGoOn > customerErasedOn ? mayGoOn : customerErasedOn
}

/**
 * What keeps a site although it is due: a maintenance contract at it that has
 * not ended. Open deadlines do not hold it, they go with it.
 */
export const siteHolds = ['running_contract'] as const

export type SiteHold = (typeof siteHolds)[number]

const siteHoldWords: Readonly<Record<SiteHold, string>> = {
  running_contract: 'Ein Wartungsvertrag am Objekt ist nicht beendet.',
}

/** What the office reads about a hold, as the reason a site is not deleted. */
export function siteHoldSentence(hold: SiteHold): string {
  return siteHoldWords[hold]
}
