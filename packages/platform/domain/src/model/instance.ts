import type { AuditChange, AuditTitle } from './audit.js'

/**
 * The instance, as opposed to a tenant on it: who runs it, what holds for
 * every tenant on it, and the tenants themselves.
 *
 * An instance can carry several tenants, and none of them decides for the
 * others. What belongs to all of them is set by whoever runs the instance, in
 * an area of its own that is not the workplace of any tenant.
 */

/** What the person asking may do with the instance. */
export interface InstanceAccess {
  readonly operator: boolean
  /**
   * Whether this session carries the second factor the area needs, as a role
   * that leads a tenant does: the app, or a sign in with a passkey.
   */
  readonly secondFactor: boolean
}

/** The settings of the instance as its screen reads them. */
export interface InstanceSettingsView {
  /** Mail servers in the instance's own network a tenant may send through. */
  readonly mailInternalHosts: readonly string[]
  /** When the nightly backup runs, "HH:MM", in the time zone of the server. */
  readonly backupTime: string
  /** When `MAIL_INTERNAL_HOSTS` was taken over from the `.env`, ISO 8601, or null. */
  readonly takenOverAt: string | null
}

/** One of the accounts that run the instance. */
export interface OperatorView {
  readonly userId: string
  readonly name: string
  readonly email: string
  /** Since when, ISO 8601. */
  readonly since: string
  /** Whether the account has a second factor to sign in with, the app or a passkey. */
  readonly secondFactor: boolean
}

/** A tenant on the instance as whoever runs it sees it: nothing of what is in it. */
export interface InstanceTenantView {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  /** Who leads it and can still get in: the people holding a role that leads. */
  readonly leads: readonly { readonly name: string; readonly email: string }[]
  /** How many people have a membership, blocked ones included. */
  readonly members: number
  /** Addresses invited to lead it that have not taken the invitation up yet. */
  readonly invitedLeads: readonly string[]
}

/** A page of the log of the instance, in the shape of the log of a tenant. */
export interface InstanceLogPage {
  readonly changes: readonly AuditChange[]
  /** Hand this back as `before` for the page after, null at the first change. */
  readonly next: string | null
  /** By record id: every record on the page. */
  readonly titles: Readonly<Record<string, AuditTitle>>
  /** By user id: the people on the page. */
  readonly people: Readonly<Record<string, string>>
  /** Nothing of an instance is written from a device; here so that one screen draws both logs. */
  readonly devices: Readonly<Record<string, string | null>>
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
