import type { AuditChange, AuditTitle } from './audit.js'
import type { SmtpSecurity } from './mail-server.js'

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

/**
 * The mail server of the instance as its settings show it
 * (opengewerk-haustechnik#81), and never with the password. Whether there is
 * one, and whether it still opens, is all a screen learns about it.
 */
export interface InstanceMailServerView {
  readonly host: string
  readonly port: number
  readonly security: SmtpSecurity
  readonly username: string | null
  /** The address the instance writes from. */
  readonly fromAddress: string
  /**
   * `unreadable` is a password this instance can no longer open, because its
   * secret has changed since it was sealed. It has to be entered again, and
   * until it is, nothing goes out to an account.
   */
  readonly password: 'none' | 'set' | 'unreadable'
  /** When the password was set, ISO 8601, or null. */
  readonly passwordSetAt: string | null
}

/** What the settings of the instance learn about its mail server. */
export interface InstanceMailServerState {
  /** False on an instance that sends no mail at all: closed, or started without sending. */
  readonly sends: boolean
  /** Null while the instance has none. */
  readonly server: InstanceMailServerView | null
}

/**
 * The certificate the instance signs PDFs with (opengewerk-haustechnik#457),
 * as its settings show it. It names the instance by its address and the
 * application by its name; nothing in it names a person.
 */
export interface InstanceCertificateView {
  readonly commonName: string
  readonly organisation: string
  /** SHA-256 over the certificate, as a PDF program shows it: pairs of hexadecimal digits with colons. */
  readonly fingerprint: string
  readonly validFrom: string
  readonly validTo: string
  /** Since when the instance signs with this key. */
  readonly since: string
  /**
   * False when the kept key no longer opens, because `SESSION_SECRET` was
   * changed since: the next PDF then comes with a new key.
   */
  readonly readable: boolean
  /** How many certificates of earlier keys the instance still knows its PDFs by. */
  readonly earlier: number
}

/** What the settings of the instance learn about the signature of its PDFs. */
export interface InstanceSigningState {
  /** False on an instance whose application signs no PDF. */
  readonly signs: boolean
  /** Null while there is no key yet; it comes with the first PDF signed. */
  readonly certificate: InstanceCertificateView | null
}

/**
 * The two legal texts of an instance (opengewerk-haustechnik#129): its legal
 * notice and its notice on data protection. Whoever runs the instance keeps
 * them on a screen; they are in no source code, and they are the same for
 * every tenant on it.
 */
export const legalTextKinds = ['imprint', 'privacy'] as const

export type LegalTextKind = (typeof legalTextKinds)[number]

/**
 * The legal texts as anybody reads them, signed in or not: the text, or null
 * where none is kept, and then no link leads to it.
 */
export type LegalTexts = Readonly<Record<LegalTextKind, string | null>>

/** One legal text as the screen in the area of the instance shows it. */
export interface LegalTextView {
  readonly text: string | null
  /** When it was last changed, ISO 8601, or null while it never was. */
  readonly changedAt: string | null
  /** Who changed it, by name, or null: nobody signed in, or an account that is gone. */
  readonly changedBy: string | null
}

export type InstanceLegalTextsView = Readonly<Record<LegalTextKind, LegalTextView>>

/**
 * How long a legal text may be, in characters: room for a notice on data
 * protection of many pages, and one text still under the limit of a request
 * of a form if every character in it took two bytes.
 */
export const longestLegalText = 40_000

/** Why a legal text cannot be kept as it is, or null when it can. */
export function legalTextProblem(text: string): string | null {
  return text.length > longestLegalText
    ? `Höchstens ${longestLegalText.toLocaleString('de-DE')} Zeichen.`
    : null
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
