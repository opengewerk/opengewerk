import type { IsoDate, RuleSet } from '@opengewerk/platform-domain'

import { retentionOf } from './retention.js'

/**
 * When what the business holds about the people who work for it falls due
 * under the deletion concept (#846, decided on 04.11.2026). Three kinds, each
 * from a period in the rule package `retention`:
 *
 * - a sickness, a year after its last day (`sickness_records`): a health
 *   datum (Art. 9 GDPR) goes once the integration management and the
 *   continued pay no longer need it;
 * - the time and leave of one year of one person, six years after the end of
 *   the year (`payroll_records`): the time is a paper of the payroll where the
 *   pay goes by the hour, and the leave of a year and what it was entitled to
 *   go with the time of the same year;
 * - the file of somebody who left, three years after the end of the year they
 *   left (`personnel_files`), when the claims from the employment are time
 *   barred. Their name stays as an empty file for as long as a year of theirs
 *   is still kept, so that the time belongs to somebody.
 */

/** The first day a sickness that ended on a day may go. */
export function sicknessErasureDueOn(lastDay: IsoDate, today: IsoDate, rules: RuleSet): IsoDate {
  return retentionOf('sickness_records', lastDay, today, rules).mayGoOn
}

/**
 * The first day the time and leave of a year may go. The two years of the
 * minimum wage and working time acts lie well inside the six of the payroll,
 * and the database keeps the shorter bound on every record of time as well
 * (migration 0036).
 */
export function staffYearErasureDueOn(year: number, today: IsoDate, rules: RuleSet): IsoDate {
  return retentionOf('payroll_records', `${String(year)}-12-31` as IsoDate, today, rules).mayGoOn
}

/** The first day the file of somebody who left on a day may go. */
export function personErasureDueOn(leftOn: IsoDate, today: IsoDate, rules: RuleSet): IsoDate {
  return retentionOf('personnel_files', leftOn, today, rules).mayGoOn
}

/**
 * What keeps the file of somebody who left although it is due: an access to
 * this business that has not ended. The data of an account go only after its
 * last day (`removeAccountData` in the foundation), and a person who can still
 * sign in has not left in the sense that matters here.
 */
export const personHolds = ['access_open'] as const

export type PersonHold = (typeof personHolds)[number]

const personHoldWords: Readonly<Record<PersonHold, string>> = {
  access_open: 'Ihr Zugang hat keinen letzten Tag, der vorbei ist.',
}

/** What the office reads about a hold, as the reason a file is not deleted. */
export function personHoldSentence(hold: PersonHold): string {
  return personHoldWords[hold]
}
