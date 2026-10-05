import type { AuditChange, AuditTitle, ChainVerification } from './audit.js'

/**
 * The change log as a person reads it (ADR 0010).
 *
 * The log itself is one row per field and knows tables and columns. What a
 * screen needs is one change per write, with words around it: what a table
 * and a field are called, which tables are parts of a record, what a field
 * points at, where a record's name is. This file holds the shapes a server
 * hands over and the rules a server and a screen share, so that the server
 * takes in the parts of a record the screen promises and both name them alike.
 *
 * The words are split along the tables. The foundation names its own: the
 * tables of tenants, memberships, sign ins, roles, settings, number ranges and
 * the instance, except where a name needs a word only an application has,
 * what it calls a tenant and whoever runs an instance. An application names
 * its own tables in its vocabulary and hands that in, those few words with it.
 * A kit in the testing entry of the server holds the whole against the
 * database, so a column nobody named fails in a test instead of showing its
 * name to a person.
 */

/**
 * The right the foundation asks for on the routes of the log: reading it, the
 * check of the chain included. Nobody writes the log; the triggers do.
 *
 * A right of the foundation, because the routes are. An application that
 * registers them carries it in its catalogue and gives it to whoever may look.
 */
export const auditRights = {
  read: 'audit.read',
} as const

export type AuditRight = (typeof auditRights)[keyof typeof auditRights]

/**
 * A page of the log, newest first, with the names the page needs.
 *
 * The names come from the log as well and not from the records: a record that
 * was deleted still has a history, and its history still needs its name.
 */
export interface AuditPage {
  readonly changes: readonly AuditChange[]
  /** Hand this back as `before` for the page after, null at the first change. */
  readonly next: number | null
  /** By record id: every record on the page and every one a field points at. */
  readonly titles: Readonly<Record<string, AuditTitle>>
  /** By user id: the people on the page. */
  readonly people: Readonly<Record<string, string>>
  /** By device id: the browser it last signed in with, null when nothing is known. */
  readonly devices: Readonly<Record<string, string | null>>
}

/** The check of the chain as a person reads it. */
export interface AuditChainReport extends ChainVerification {
  /** When the entry the chain stops fitting at was written, ISO 8601, or null. */
  readonly brokenAtTime: string | null
  /** When the check ran. */
  readonly checkedAt: string
}

/** Somebody who has worked in the tenant, for the filter of the log. */
export interface AuditPerson {
  readonly userId: string
  readonly name: string
}

/**
 * The database role an application works as, and the one migrations run as.
 * Called the same in every application of the organisation, so a change that
 * came through neither can be told apart from one that did.
 */
export const applicationRoleName = 'opengewerk_app'
export const migrationRoleName = 'opengewerk_owner'

/** What a change says about its way into the log. */
export interface AuditWay {
  readonly text: string
  /**
   * The change went past the application, straight into the database. The
   * one way worth a second look, so the screen shows it differently.
   */
  readonly direct: boolean
}

/** A table whose rows belong to a record of another, and the column that says to which. */
export interface AuditPart {
  readonly table: string
  readonly column: string
}

/** A table: what one of its rows is called, and the fields it names its own way. */
export interface AuditTableWords {
  readonly label: string
  readonly fields?: Readonly<Record<string, string>>
}

/**
 * Where the name of a record is: the first of these fields that has a value,
 * or, for a record whose name is two fields, both of them joined.
 */
export type AuditTitleRule = readonly string[] | { readonly joined: readonly string[] }

/**
 * The reasons the foundation writes whose words name a tenant or whoever runs
 * an instance. Their words come from the application, the others' from here.
 */
export const applicationWordedReasons = [
  'session.switch',
  'operator.appoint',
  'operator.remove',
  'operator.cli',
  'instance.tenant',
  'tenant.cli',
] as const

export type ApplicationWordedReason = (typeof applicationWordedReasons)[number]

/**
 * The words the foundation needs to name its own tables and reasons, and may
 * not say itself: each a label as it stands on its own, never a word that is
 * set into a sentence.
 */
export interface FoundationAuditWords {
  /** A tenant: the label of its table and of every field that names one. */
  readonly tenant: string
  /** A setting of a tenant with a period of validity, as one row is called. */
  readonly tenantParameter: string
  /** The flag of a role that it leads its tenant. */
  readonly leads: string
  /** One of those who run the instance, as one row is called. */
  readonly operator: string
  readonly reasons: Readonly<Record<ApplicationWordedReason, string>>
}

/**
 * What an application says about its own tables in the log (ADR 0010). Data
 * and nothing else: the server and the screen make an `AuditLanguage` of it.
 */
export interface AuditVocabulary {
  /**
   * Every table of the application the audit trigger watches, with its words.
   * Not those of the foundation, which names its own; the kit in the testing
   * entry of the server holds both against the database.
   */
  readonly tables: Readonly<Record<string, AuditTableWords>>
  /** The fields many of its tables share, named once. */
  readonly commonFields: Readonly<Record<string, string>>
  /**
   * Columns of its own on tables of the foundation, named by table. The
   * outbox of the mail is the table made to carry some, for the records its
   * messages are about (#23), and so are the deadlines and the contacts, for
   * what each of them hangs on; the foundation names every other column.
   */
  readonly ownFields?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** What the foundation needs from it to name its own tables and reasons. */
  readonly foundation: FoundationAuditWords
  /**
   * What the log of one record takes in beside the record itself, by the
   * record's table: its parts, the rows a person sees and changes on the same
   * screen, walked down level by level.
   *
   * Not everything that points at a record is a part of it. A record of its
   * own that points at another keeps its own log; taking it in would bury the
   * few changes to the one under the many to the other.
   */
  readonly parts: Readonly<Record<string, readonly AuditPart[]>>
  /** The records the log is opened from, with the button "Änderungen". */
  readonly records: readonly string[]
  /**
   * Fields that point at another record, and the table they point into. The
   * page names what they point at, so that a record moved elsewhere reads as
   * two names and not as two keys.
   */
  readonly references: Readonly<Record<string, string>>
  /** Fields that hold the id of a person, beside the foundation's own. */
  readonly personFields: readonly string[]
  /**
   * Where a record's name is, by table. A table that is not named here is
   * named by the first of `defaultAuditTitleFields` it has.
   */
  readonly titles: Readonly<Record<string, AuditTitleRule>>
  /** Words for the reasons of its own that a change carries, by reason. */
  readonly reasons: Readonly<Record<string, string>>
  /**
   * The rights of its catalogue by their labels. A route writes the right it
   * asks for as the reason of what it changes.
   */
  readonly rights: Readonly<Record<string, string>>
  /** The roles a tenant begins with, by their labels: a membership names its roles by key. */
  readonly roles: Readonly<Record<string, string>>
  /** Fields that say nothing about a change, beside the foundation's own. */
  readonly quietFields?: readonly string[]
  /**
   * Fields of its own tables whose value the log keeps to itself, by table.
   * The server answers for such a field only that it was set, and so does the
   * page. Beside the foundation's own.
   */
  readonly secretFields?: Readonly<Record<string, readonly string[]>>
}

/** The fields a record is named by when its table names none. */
export const defaultAuditTitleFields: readonly string[] = [
  'name',
  'designation',
  'title',
  'subject',
  'number',
]

/**
 * The fields an entry carries that say nothing about the change: the key of
 * the row, its tenant and when it was made, all set once when the row is
 * written. The log keeps them, as it keeps everything; a list leaves them
 * out, so that a new record shows its name and not its key.
 */
export const quietAuditFields: readonly string[] = [
  'id',
  'tenant_id',
  'created_at',
  // The key of a passkey on the instance, which says as little as `id` does;
  // the passkey is named by its name.
  'passkey_id',
]

/**
 * The fields of the foundation whose value no reader of the log gets, by
 * table: the hash of a one time link, and what a browser handed over so that
 * a message can be pushed to it. The address of the push service is a way to
 * reach the device, the two keys are what a message to it is sealed with.
 *
 * The log holds them like every value. They were hidden on the page and went
 * out with the answer all the same, to everybody who may read the log, and an
 * application that did not name them on its page showed them
 * (opengewerk-haustechnik#31).
 */
const foundationSecretFields: Readonly<Record<string, readonly string[]>> = {
  invitations: ['token_hash'],
  push_subscriptions: ['endpoint', 'p256dh', 'auth'],
}

/**
 * What the log says of a value it keeps to itself: that there was one. The
 * server puts it where the value stood, and a page shows it as it is.
 */
export const withheldAuditValue = 'gesetzt'

/** The fields of the foundation that hold the id of a person. */
const foundationPersonFields: readonly string[] = [
  'user_id',
  'invited_by',
  'requested_by',
  'responsible_user_id',
  'natural_user_id',
  'closed_by',
]

/** Fields of the foundation that point at another record, and the table they point into. */
const foundationReferences: Readonly<Record<string, string>> = {
  invitation_id: 'invitations',
  subscription_id: 'push_subscriptions',
}

/** The fields the foundation puts on many tables, its sync columns among them. */
function foundationCommonFields(words: FoundationAuditWords): Readonly<Record<string, string>> {
  return {
    id: 'Kennung',
    tenant_id: words.tenant,
    created_at: 'Angelegt am',
    updated_at: 'Geändert am',
    version: 'Fassung',
    updated_by: 'Geändert von',
    device_id: 'Gerät',
    deleted_at: 'Gelöscht am',
    change_sequence: 'Abgleichsnummer',
    user_id: 'Person',
    name: 'Name',
    email: 'E-Mail',
  }
}

/** The tables of the foundation the log of a tenant holds, by name. */
export const foundationAuditTables = [
  'contacts',
  'deadline_settings',
  'deadlines',
  'files',
  'invitations',
  'mail_outbox',
  'mail_settings',
  'member_passkeys',
  'memberships',
  'number_ranges',
  'push_opt_outs',
  'push_outbox',
  'push_subscriptions',
  'tenant_parameters',
  'tenant_roles',
  'tenant_sessions',
  'tenants',
] as const

type FoundationAuditTable = (typeof foundationAuditTables)[number]

/** The words of those tables. */
function foundationTables(
  words: FoundationAuditWords,
): Readonly<Record<FoundationAuditTable, AuditTableWords>> {
  return {
    // A person to talk to. What a contact hangs on is a column of the
    // application, which names it (`ownFields`).
    contacts: {
      label: 'Ansprechpartner',
      fields: {
        given_name: 'Vorname',
        family_name: 'Nachname',
        role: 'Funktion',
        phone: 'Telefon',
      },
    },
    deadline_settings: {
      label: 'Einstellung einer Fristart',
      fields: {
        kind: 'Art',
        lead_days: 'Vorlauf',
        interval_days: 'Intervall',
        interval_months: 'Intervall in Monaten',
        responsible_user_id: 'Verantwortlich',
      },
    },
    deadlines: {
      label: 'Frist',
      fields: {
        kind: 'Art',
        source_id: 'Quelle',
        source_label: 'Name der Quelle',
        anchor_on: 'Anker',
        due_on: 'Fällig am',
        lead_days: 'Vorlauf',
        responsible_user_id: 'Verantwortlich',
        natural_user_id: 'Vorgabe der Art',
        status: 'Status',
        closed_at: 'Geschlossen am',
        closed_by: 'Geschlossen von',
        reminded_for: 'Erinnert für',
        reminded_at: 'Erinnert am',
      },
    },
    files: {
      label: 'Gespeicherte Datei',
      fields: { sha256: 'Prüfsumme', size_bytes: 'Größe', media_type: 'Dateityp' },
    },
    mail_outbox: {
      label: 'E-Mail',
      fields: {
        kind: 'Anlass',
        cause: 'Ursache',
        invitation_id: 'Einladung',
        requested_by: 'Verschickt von',
        sender_name: 'Absender',
        reply_to: 'Antwort an',
        recipient_address: 'Empfänger',
        recipient_name: 'Name des Empfängers',
        subject: 'Betreff',
        body: 'Text',
        status: 'Status',
        attempts: 'Versuche',
        next_attempt_at: 'Nächster Versuch',
        last_error: 'Letzter Fehler',
        sent_at: 'Verschickt am',
      },
    },
    mail_settings: {
      label: 'E-Mail-Einstellungen',
      fields: {
        host: 'Server',
        port: 'Port',
        security: 'Verschlüsselung',
        username: 'Anmeldung',
        from_address: 'Absenderadresse',
        signature: 'Signatur',
        password_set_at: 'Passwort gesetzt am',
      },
    },
    invitations: {
      label: 'Einladung',
      fields: {
        roles: 'Rollen',
        token_hash: 'Prüfsumme des Links',
        invited_by: 'Eingeladen von',
        expires_at: 'Gültig bis',
        redeemed_at: 'Eingelöst am',
        revoked_at: 'Zurückgezogen am',
      },
    },
    member_passkeys: {
      label: 'Passkey',
      fields: { passkey_id: 'Kennung des Passkeys', removed_at: 'Gelöscht am' },
    },
    memberships: { label: 'Zugang', fields: { roles: 'Rollen', blocked_at: 'Gesperrt am' } },
    number_ranges: {
      label: 'Nummernkreis',
      fields: { key: 'Kreis', pattern: 'Muster', next_value: 'Nächste Nummer' },
    },
    push_opt_outs: { label: 'Abgeschalteter Anlass für Push', fields: { occasion: 'Anlass' } },
    push_outbox: {
      label: 'Push-Nachricht',
      fields: {
        kind: 'Anlass',
        cause: 'Ursache',
        subscription_id: 'Gerät',
        title: 'Titel',
        body: 'Text',
        url: 'Ziel',
        status: 'Status',
        attempts: 'Versuche',
        next_attempt_at: 'Nächster Versuch',
        expires_at: 'Gültig bis',
        last_error: 'Letzter Fehler',
        sent_at: 'Verschickt am',
      },
    },
    push_subscriptions: {
      label: 'Gerät mit Push',
      fields: {
        session_id: 'Sitzung',
        entry: 'Einstieg',
        label: 'Gerät',
        endpoint: 'Adresse des Push-Dienstes',
        p256dh: 'Schlüssel des Browsers',
        auth: 'Geheimnis des Browsers',
      },
    },
    tenant_parameters: {
      label: words.tenantParameter,
      fields: {
        key: 'Schlüssel',
        valid_from: 'Gültig ab',
        valid_until: 'Gültig bis',
        unit: 'Einheit',
        value: 'Wert',
        note: 'Anmerkung',
      },
    },
    tenant_roles: {
      label: 'Rolle',
      fields: {
        key: 'Schlüssel',
        label: 'Bezeichnung',
        rights: 'Rechte',
        leads: words.leads,
        second_factor: 'Zweiter Faktor Pflicht',
      },
    },
    tenant_sessions: {
      label: 'Anmeldung',
      fields: {
        session_id: 'Sitzung',
        started_at: 'Begonnen am',
        ended_at: 'Beendet am',
        sign_in_method: 'Angemeldet mit',
      },
    },
    tenants: { label: words.tenant },
  }
}

/**
 * The tables of the log of the instance (#188), apart from those of a tenant:
 * they carry the instance's own trigger and not the audit trigger. `tenants`
 * stands in both logs and is named above.
 */
function foundationInstanceTables(
  words: FoundationAuditWords,
): Readonly<Record<string, AuditTableWords>> {
  return {
    instance_settings: {
      label: 'Einstellungen der Instanz',
      fields: {
        mail_internal_hosts: 'Freigegebene Mailserver',
        backup_time: 'Uhrzeit der Sicherung',
        imported_from_environment_at: 'Übernommen aus der .env am',
      },
    },
    instance_operators: { label: words.operator },
  }
}

/**
 * Where the records of the foundation are named: a membership and a sign in by
 * their person, a file by its type, a mail server by the address it sends from,
 * a message by its subject, a deadline by its source, a contact by both its
 * names.
 */
const foundationTitles: Readonly<Record<string, AuditTitleRule>> = {
  contacts: { joined: ['given_name', 'family_name'] },
  // A deadline by what its source is called, a setting by its kind.
  deadlines: ['source_label'],
  deadline_settings: ['kind'],
  files: ['media_type'],
  mail_outbox: ['subject'],
  mail_settings: ['from_address'],
  memberships: ['user_id'],
  tenant_sessions: ['user_id'],
  invitations: ['name', 'email'],
  // A role is called what a screen calls it, and by its key where that is gone.
  tenant_roles: ['label', 'key'],
  number_ranges: ['key'],
  tenant_parameters: ['key'],
  // An occasion switched off is told apart by whose it is, a device by what it is.
  push_opt_outs: ['user_id'],
  push_subscriptions: ['label'],
}

/** The words of the reasons the foundation writes and may name itself. */
const foundationReasonWords: Readonly<Record<string, string>> = {
  migration: 'Update der Anwendung',
  'roles.complete': 'Von selbst, Rollen beim Start ergänzt',
  'session.start': 'Anmeldung',
  'session.end': 'Abmeldung',
  'session.revoke': 'Gerät abgemeldet',
  'passkey.add': 'Passkey hinzugefügt',
  'passkey.rename': 'Passkey umbenannt',
  'passkey.remove': 'Passkey gelöscht',
  authentication: 'Anmeldung und Konten',
  'instance.setup': 'Ersteinrichtung',
  'invitation.redeem': 'Einladung eingelöst',
  'membership.create': 'Zugang über die Kommandozeile',
  'instance.settings': 'Einstellungen der Instanz ändern',
  environment: 'Übernommen aus der .env',
  deadline: 'Von selbst, Fristen',
  mail: 'Von selbst, E-Mail-Versand',
  notification: 'Von selbst, Benachrichtigungen',
  push: 'Von selbst, Push-Versand',
  // The sync reads and writes under two rights; either way it is the sync.
  'sync.read': 'Abgleich',
  'sync.write': 'Abgleich',
}

/**
 * Every reason the foundation writes itself, for the kit that keeps an
 * application from giving one of them words of its own. Not among them:
 * `tenant.create`, which the foundation writes only for an application that
 * offers a further tenant of one's own, under a right of that application.
 */
export const foundationAuditReasons: readonly string[] = [
  ...Object.keys(foundationReasonWords),
  ...applicationWordedReasons,
]

/** The latest values a record's naming fields carried in the log, by field. */
export type AuditLatest = Readonly<Record<string, string | null>>

/**
 * The vocabulary of an application with the foundation's words around it:
 * what the server and a screen ask, so that both name a change alike.
 */
export interface AuditLanguage {
  readonly vocabulary: AuditVocabulary
  /** Every table the log of a tenant holds, the foundation's and the application's. */
  readonly tables: Readonly<Record<string, AuditTableWords>>
  /** The tables of the log of the instance that the log of a tenant does not hold. */
  readonly instanceTables: Readonly<Record<string, AuditTableWords>>
  /** The records the log is opened from. */
  readonly records: readonly string[]
  /** What a row of this table is called, or the table's own name where nothing names it. */
  readonly tableLabel: (table: string) => string
  /** What a field is called on its own, or null where nothing names it. */
  readonly fieldName: (table: string, field: string) => string | null
  /** A field with its table, as a list of changes shows it. */
  readonly fieldLabel: (table: string, field: string) => string
  /** The fields a record of this table is named by, in the order they are tried. */
  readonly titleFields: (table: string) => readonly string[]
  /** The field the name came from, null when it is two fields joined or none had a value. */
  readonly titleFieldOf: (table: string, latest: AuditLatest) => string | null
  /** The name from the latest values of those fields, or null. */
  readonly titleFrom: (table: string, latest: AuditLatest) => string | null
  /** The parts of a record of this table, none for most. */
  readonly partsOf: (table: string) => readonly AuditPart[]
  /** The table a field points into, or null. */
  readonly referenceOf: (field: string) => string | null
  readonly isPersonField: (field: string) => boolean
  /** Whether a field says nothing about a change. */
  readonly isQuiet: (field: string) => boolean
  /** Whether the log keeps the value of this field to itself. */
  readonly isSecret: (table: string, field: string) => boolean
  /** The way a change took, in the application's words. */
  readonly way: (reason: string | null, databaseRole: string) => AuditWay
}

function hasValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** The vocabulary of an application made into the rules both sides ask. */
export function auditLanguage(vocabulary: AuditVocabulary): AuditLanguage {
  const tables: Readonly<Record<string, AuditTableWords>> = {
    ...vocabulary.tables,
    ...foundationTables(vocabulary.foundation),
  }
  const instanceTables = foundationInstanceTables(vocabulary.foundation)
  const ownCommon = foundationCommonFields(vocabulary.foundation)
  const titles = { ...vocabulary.titles, ...foundationTitles }
  const personFields = new Set([...foundationPersonFields, ...vocabulary.personFields])
  const quiet = new Set([...quietAuditFields, ...(vocabulary.quietFields ?? [])])
  const secret = (table: string): readonly string[] => [
    ...(Object.hasOwn(foundationSecretFields, table) ? (foundationSecretFields[table] ?? []) : []),
    ...(vocabulary.secretFields && Object.hasOwn(vocabulary.secretFields, table)
      ? (vocabulary.secretFields[table] ?? [])
      : []),
  ]

  const rule = (table: string): AuditTitleRule => titles[table] ?? defaultAuditTitleFields
  const fieldsOf = (found: AuditTitleRule): readonly string[] =>
    'joined' in found ? found.joined : found

  const tableLabel = (table: string): string =>
    tables[table]?.label ?? instanceTables[table]?.label ?? table

  const fieldName = (table: string, field: string): string | null =>
    tables[table]?.fields?.[field] ??
    vocabulary.ownFields?.[table]?.[field] ??
    instanceTables[table]?.fields?.[field] ??
    vocabulary.commonFields[field] ??
    ownCommon[field] ??
    null

  const titleFieldOf = (table: string, latest: AuditLatest): string | null => {
    const found = rule(table)

    return 'joined' in found ? null : (found.find((field) => hasValue(latest[field])) ?? null)
  }

  const titleFrom = (table: string, latest: AuditLatest): string | null => {
    const found = rule(table)

    if ('joined' in found) {
      const joined = found.joined
        .map((field) => latest[field])
        .filter(hasValue)
        .join(' ')

      return joined === '' ? null : joined
    }

    const field = titleFieldOf(table, latest)

    return field === null ? null : (latest[field] ?? null)
  }

  return {
    vocabulary,
    tables,
    instanceTables,
    records: vocabulary.records,
    tableLabel,
    fieldName,
    fieldLabel: (table, field) => `${tableLabel(table)}, ${fieldName(table, field) ?? field}`,
    titleFields: (table) => fieldsOf(rule(table)),
    titleFieldOf,
    titleFrom,
    partsOf: (table) => vocabulary.parts[table] ?? [],
    referenceOf: (field) => foundationReferences[field] ?? vocabulary.references[field] ?? null,
    isPersonField: (field) => personFields.has(field),
    isQuiet: (field) => quiet.has(field),
    isSecret: (table, field) => secret(table).includes(field),
    way: (reason, databaseRole) => auditWay(vocabulary, reason, databaseRole),
  }
}

/**
 * The way a change took, in the words of the application.
 *
 * The role decides first. Anybody at a database prompt can set `app.reason`
 * to whatever they like, so a reason from a connection that is neither the
 * application nor a migration says nothing, and the change is marked as what
 * it is: made directly in the database.
 */
export function auditWay(
  vocabulary: AuditVocabulary,
  reason: string | null,
  databaseRole: string,
): AuditWay {
  if (databaseRole !== applicationRoleName && databaseRole !== migrationRoleName) {
    return { text: 'Direkt in der Datenbank', direct: true }
  }

  if (reason === null || reason === '') {
    return {
      text: databaseRole === migrationRoleName ? 'Update der Anwendung' : 'Anwendung',
      direct: false,
    }
  }

  const words =
    foundationReasonWords[reason] ??
    (vocabulary.foundation.reasons as Readonly<Record<string, string>>)[reason] ??
    vocabulary.reasons[reason] ??
    vocabulary.rights[reason] ??
    reason

  return { text: words, direct: false }
}

/** Why a day in a filter is not one, or null when it is. */
export function auditDayProblem(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? null
    : 'Ein Tag in der Form JJJJ-MM-TT.'
}
