import type { Id, Synced } from '@opengewerk/platform-domain'
import type { SiteId } from './identifier.js'

export type SiteAccessId = Id<'site-access'>

/**
 * One way into a site (#286): the key safe in the yard, the code of the
 * alarm, the remote for the garage door. What it opens and a hint travel like
 * any record and stand in the audit log; the value itself does not. It is
 * sealed in `secrets`, bound to the business, the purpose and this row, and a
 * change of it shows here only as `valueSetAt`.
 *
 * The owner and the office see the value on request and with a connection; a
 * technician on an open job at the site holds it on the device, also without
 * a network, until the job is closed. Every showing is a `SiteAccessReveal`.
 */
export interface SiteAccess extends Synced {
  readonly id: SiteAccessId
  readonly siteId: SiteId
  /** What it opens: "Schlüsseltresor Hof", "Alarmanlage". */
  readonly designation: string
  /** Where and how, in words: "Tresor links neben dem Hoftor." */
  readonly hint: string | null
  /** When the value was last set, or null for an access that is only a hint. */
  readonly valueSetAt: Date | null
}

/**
 * That somebody saw the value of an access, and when. Written by the device
 * that showed it, through the outbox and so also without a network, before
 * the value appears, or by the route that hands the value to the owner or the
 * office. Who it was the database writes from the request. The server takes
 * one from a device only for a value that device was handed, named by when it
 * was set, and also when the access was deleted since: the showing happened.
 */
export interface SiteAccessReveal extends Synced {
  readonly id: Id<'site-access-reveal'>
  readonly siteAccessId: SiteAccessId
  readonly userId: string
  /** When the value was shown, on the clock of the device that showed it. */
  readonly revealedAt: Date
  /** Which value was shown, by when it was set. */
  readonly valueSetAt: Date | null
}

/**
 * What a device knows of the value of an access, beside the row itself.
 * `readable` with the value only on the device of a technician on an open job
 * there; the office learns the value by asking for it.
 */
export type AccessValueState = 'none' | 'readable' | 'unreadable'

export const accessDesignationMaxLength = 60
export const accessHintMaxLength = 300
export const accessValueMaxLength = 120

/** Why an access cannot be kept like this, as a sentence, or null when it can. */
export function accessProblem(access: {
  readonly designation: string
  readonly hint?: string | null
  readonly value?: string | null
}): string | null {
  const designation = access.designation.trim()

  if (designation === '') {
    return 'Ein Zugang braucht eine Bezeichnung, etwa „Schlüsseltresor Hof“.'
  }

  if ([...designation].length > accessDesignationMaxLength) {
    return `Die Bezeichnung eines Zugangs hat höchstens ${String(accessDesignationMaxLength)} Zeichen.`
  }

  if (access.hint && [...access.hint.trim()].length > accessHintMaxLength) {
    return `Der Hinweis zu einem Zugang hat höchstens ${String(accessHintMaxLength)} Zeichen.`
  }

  if (access.value && [...access.value].length > accessValueMaxLength) {
    return `Der Wert eines Zugangs hat höchstens ${String(accessValueMaxLength)} Zeichen.`
  }

  return null
}
