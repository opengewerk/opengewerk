import type { Id, Synced } from '@opengewerk/platform-domain'
import type { CustomerId, SiteId } from './identifier.js'
import type { JobStatus } from './job.js'

export type TagId = Id<'tag'>

/**
 * A word a business files its customers and sites under (#314): "Wallbox",
 * "Rahmenvertrag", "Bergstraße". The business makes its own, in the settings
 * or while it tags a customer, and one tag serves customers and sites alike.
 *
 * What can be read off the records is not a tag. The kind of a customer is a
 * field of it, and whether it is an existing customer follows from its jobs
 * (`customerStanding`); a mark that sets itself cannot go stale.
 */
export interface Tag extends Synced {
  readonly id: TagId
  readonly name: string
}

/** A tag on a customer, one row each, removed by marking it deleted. */
export interface CustomerTag extends Synced {
  readonly id: Id<'customer-tag'>
  readonly customerId: CustomerId
  readonly tagId: TagId
}

/** A tag on a site, the same as on a customer. */
export interface SiteTag extends Synced {
  readonly id: Id<'site-tag'>
  readonly siteId: SiteId
  readonly tagId: TagId
}

/** Long enough for "Rahmenvertrag Hausverwaltung", short enough for a chip. */
export const tagNameMaxLength = 40

/**
 * A name as a tag carries it: no space at either end and one between words,
 * so that "Smart  Home" typed in a hurry is the tag that is already there.
 */
export function tagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * What decides whether two names are the same tag. The case does not count:
 * "wallbox" is "Wallbox". The database holds the same rule in the index that
 * keeps a name once per business, with `lower()`.
 */
export function tagKey(name: string): string {
  return tagName(name).toLowerCase()
}

/** Why a name cannot be a tag, as a sentence, or null when it can. */
export function tagNameProblem(name: string): string | null {
  const shaped = tagName(name)

  if (shaped === '') {
    return 'Ein Tag braucht einen Namen.'
  }

  if ([...shaped].length > tagNameMaxLength) {
    return `Ein Tag hat höchstens ${String(tagNameMaxLength)} Zeichen.`
  }

  return null
}

/**
 * Whether a customer has been one before: a job of theirs was completed. The
 * concept names it next to the tags (3.1), and it is read off the jobs rather
 * than typed, so it changes the day the first job is done.
 */
export type CustomerStanding = 'existing' | 'new'

export function customerStanding(jobStatuses: Iterable<JobStatus>): CustomerStanding {
  for (const status of jobStatuses) {
    if (status === 'completed') {
      return 'existing'
    }
  }

  return 'new'
}

export const customerStandingLabel: Readonly<Record<CustomerStanding, string>> = {
  existing: 'Bestandskunde',
  new: 'Neukunde',
}
