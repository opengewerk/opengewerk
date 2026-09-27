import type { AuditPage } from './audit-log.js'

/**
 * The instance, as opposed to a business on it (#188): who runs it, what holds
 * for every business on it, and the businesses themselves (#142).
 *
 * An instance can carry several businesses, and none of them decides for the
 * others. What belongs to all of them is set by its operators, in an area of
 * its own that is not the office of any business.
 */

/** What the person asking may do with the instance. */
export interface InstanceAccess {
  readonly operator: boolean
  /** The area of the instance needs a second factor, as the role of an owner does. */
  readonly secondFactor: boolean
}

/** The settings of the instance as its screen reads them. */
export interface InstanceSettingsView {
  /** Mail servers in the instance's own network a business may send through. */
  readonly mailInternalHosts: readonly string[]
  /** When the nightly backup runs, "HH:MM", in the time zone of the server. */
  readonly backupTime: string
  /** When `MAIL_INTERNAL_HOSTS` was taken over from the `.env`, ISO 8601, or null. */
  readonly takenOverAt: string | null
}

/** One operator of the instance. */
export interface OperatorView {
  readonly userId: string
  readonly name: string
  readonly email: string
  /** Since when, ISO 8601. */
  readonly since: string
  readonly secondFactor: boolean
}

/** A business on the instance as its operators see it: nothing of what is in it. */
export interface InstanceTenantView {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly owners: readonly { readonly name: string; readonly email: string }[]
  /** How many people have a membership, blocked ones included. */
  readonly members: number
  /** Addresses invited as owner that have not taken the invitation up yet. */
  readonly invitedOwners: readonly string[]
}

/** A page of the log of the instance, in the shape of the log of a business. */
export interface InstanceLogPage extends Pick<
  AuditPage,
  'changes' | 'titles' | 'people' | 'devices'
> {
  /** Hand this back as `before` for the page after, null at the first change. */
  readonly next: string | null
}

/**
 * Why an entry is not a mail server in the own network, or null when it is:
 * a name or an address, without port and without scheme, as
 * `MAIL_INTERNAL_HOSTS` always took them.
 */
export function mailHostProblem(entry: string): string | null {
  const ok = /^[A-Za-z0-9.-]+$|^\[?[0-9A-Fa-f:.]+\]?$/.test(entry) && !entry.startsWith('-')

  return ok
    ? null
    : `„${entry}“ ist kein Servername und keine Adresse. Erwartet wird etwa mail.intern.example oder 192.168.1.20, ohne Port.`
}

/** Why a time for the nightly backup is not one, or null when it is: "HH:MM". */
export function backupTimeProblem(value: string): string | null {
  const found = /^(\d{2}):(\d{2})$/.exec(value)

  if (!found) {
    return 'Eine Uhrzeit wie 02:30, Stunden und Minuten.'
  }

  const hours = Number(found[1])
  const minutes = Number(found[2])

  return hours < 24 && minutes < 60 ? null : 'Eine Uhrzeit zwischen 00:00 und 23:59.'
}
