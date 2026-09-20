import { accessSync, constants, statSync } from 'node:fs'

/**
 * What an instance needs to know, read from the environment once and checked
 * before anything connects.
 *
 * Checked, rather than defaulted. A missing database url that turns into
 * `localhost` starts a server that looks fine and serves nothing; a missing
 * port that turns into 3000 hides a typo until somebody wonders why the proxy
 * gets nothing. Both are found in minutes here and in hours later.
 *
 * Nothing in here has a credential baked in. The values arrive from the
 * environment of the running container, which is what keeps them out of the
 * image.
 */
export interface Configuration {
  /** Where the application connects, as the role row level security applies to. */
  readonly databaseUrl: string
  readonly port: number
  /** The address to bind. Inside a container that has to be every interface. */
  readonly host: string
  /**
   * Where the content addressed file store lives. Photos, receipts, the PDF
   * and XML of an issued document; per ADR 0007 a directory whose file names
   * are the SHA-256 of their contents.
   *
   * It belongs to the same backup run as the database, because a document row
   * points at a file by hash. A backup holding only one of the two restores
   * invoices that refer to files nobody has.
   */
  readonly storagePath: string
  /**
   * Signs the session cookies and encrypts the TOTP secrets.
   *
   * Changing it signs everybody out and makes every second factor that was
   * already set up unreadable, so it belongs in the backup of an installation
   * as much as the database does.
   */
  readonly sessionSecret: string
  /**
   * The addresses a browser may send an authenticated request from, and the
   * CSRF defence in one line: better-auth compares the Origin header against
   * this list, so a form on a stranger's page cannot post here with somebody's
   * cookie attached.
   *
   * There is no default and there must not be one. A list that quietly falls
   * back to "anything" turns the protection off in exactly the installation
   * whose operator did not think about it.
   */
  readonly trustedOrigins: readonly string[]
  /**
   * Whether the instance recognises nobody at all.
   *
   * Off in normal operation. An operator switches it on to keep an instance
   * up and reachable while a restore or a migration window is running: it
   * starts, answers its health check and refuses every request for data,
   * including the sign in. See `ClosedIdentitySource`.
   */
  readonly closed: boolean
}

/** What went wrong, phrased for whoever is looking at the container log. */
export class ConfigurationError extends Error {}

export type Environment = Record<string, string | undefined>

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim()

  if (!value) {
    throw new ConfigurationError(
      `Die Umgebungsvariable ${name} fehlt. Ohne sie startet OpenGewerk nicht.`,
    )
  }

  return value
}

function port(environment: Environment, name: string, fallback: number): number {
  const raw = environment[name]?.trim()

  if (!raw) {
    return fallback
  }

  const value = Number(raw)

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigurationError(
      `${name} muss eine Portnummer zwischen 1 und 65535 sein, gelesen wurde: ${raw}`,
    )
  }

  return value
}

/**
 * Reads a connection string and refuses the ways it can be wrong without
 * looking wrong.
 *
 * The missing user name is the one worth explaining. A password containing a
 * slash splits the address at the wrong place: everything before the slash
 * becomes the host, and the failure that reaches the log is a name lookup for
 * a host called `opengewerk_owner`. Nobody reading that thinks of the
 * password, and `openssl rand -base64` produces a slash about half the time.
 */
export function parseConnectionString(raw: string, name: string): URL {
  let parsed: URL

  try {
    parsed = new URL(raw)
  } catch {
    throw new ConfigurationError(
      `${name} ist keine gültige Verbindungsadresse. Erwartet wird etwa ` +
        'postgres://benutzer:passwort@host:5432/opengewerk',
    )
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new ConfigurationError(
      `${name} muss auf PostgreSQL zeigen, gelesen wurde das Schema: ${parsed.protocol}`,
    )
  }

  if (!parsed.username) {
    throw new ConfigurationError(
      `${name} enthält keinen Benutzernamen. Meistens liegt das an einem Passwort mit ` +
        '"/", "@", ":" oder "?" darin, das die Adresse an der falschen Stelle teilt. ' +
        'Entweder ein Passwort ohne diese Zeichen verwenden, etwa aus ' +
        '"openssl rand -hex 32", oder es in der Adresse prozentkodieren.',
    )
  }

  return parsed
}

/**
 * The connection string of the application, checked for the one mistake that
 * costs an evening: connecting as the owner of the tables. Row level security
 * does not apply to a superuser at all, and applies to the owner only through
 * FORCE, so an instance that runs as either has an isolation that looks like
 * one and is not. Refusing here is the difference between a start that fails
 * and a tenant seeing another tenant's customers.
 */
function databaseUrl(environment: Environment): string {
  const raw = required(environment, 'DATABASE_URL')
  const parsed = parseConnectionString(raw, 'DATABASE_URL')

  if (parsed.username === 'postgres' || parsed.username === migrationRole) {
    throw new ConfigurationError(
      `Die Anwendung darf sich nicht als "${parsed.username}" verbinden. Diese Rolle ` +
        'besitzt die Tabellen oder ist Superuser, und in beiden Fällen greift die ' +
        `Mandantentrennung nicht. Erwartet wird "${applicationRole}".`,
    )
  }

  return raw
}

/** The role that owns the tables and runs the migrations. */
export const migrationRole = 'opengewerk_owner'
/** The role the application connects as, the one the policies are written for. */
export const applicationRole = 'opengewerk_app'

/**
 * The file store, checked for reachable and writable at startup rather than
 * at the first upload.
 *
 * A wrong mount and missing permissions look identical from the outside: the
 * instance starts, serves every page, and loses the first photo somebody takes
 * on a roof. Finding that at startup costs a restart; finding it later costs
 * the photo.
 */
function storagePath(environment: Environment, checkAccess: AccessCheck): string {
  const path = required(environment, 'STORAGE_PATH')
  const problem = checkAccess(path)

  if (problem) {
    throw new ConfigurationError(
      `Auf den Dateispeicher unter "${path}" kann nicht geschrieben werden: ${problem}. ` +
        'Existiert das Verzeichnis, und gehört es dem Benutzer, unter dem OpenGewerk läuft?',
    )
  }

  return path
}

/**
 * Whether a directory can be written to. Returns the reason when it cannot.
 *
 * Handed in rather than imported so that the check can be run against a
 * temporary directory in a test, and so that this module stays testable
 * without a file system underneath it.
 */
export type AccessCheck = (path: string) => string | null

/**
 * The real check, the one an instance uses.
 *
 * "Is it a directory" comes before "may I write to it", and not only for the
 * nicer message. Linux answers `access(file, X_OK)` on a plain file with
 * EACCES while Windows lets it pass, so asking about the permissions first
 * makes the same wrong configuration report two different things depending on
 * where the tests happen to run.
 */
export function directoryIsWritable(path: string): string | null {
  try {
    if (!statSync(path).isDirectory()) {
      return 'es ist kein Verzeichnis'
    }

    accessSync(path, constants.W_OK | constants.X_OK)

    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * The cookie secret, with a floor on how short it may be.
 *
 * 32 characters is what `openssl rand -hex 32` produces and what the
 * documentation of an installation asks for. Refusing anything shorter is the
 * cheap half of the protection; the other half nothing here can check, namely
 * that it was not typed by a person.
 */
function sessionSecret(environment: Environment): string {
  const value = required(environment, 'SESSION_SECRET')

  if (value.length < 32) {
    throw new ConfigurationError(
      'SESSION_SECRET ist zu kurz. Erwartet werden mindestens 32 Zeichen, etwa aus ' +
        '"openssl rand -hex 32".',
    )
  }

  return value
}

/**
 * The addresses a browser may send an authenticated request from.
 *
 * Every entry has to be an origin and nothing more: scheme, host, optional
 * port. A path or a trailing slash never matches what a browser puts in the
 * Origin header, so an entry with one would look configured and protect
 * nothing.
 */
function trustedOrigins(environment: Environment): readonly string[] {
  const raw = required(environment, 'TRUSTED_ORIGINS')
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (entries.length === 0) {
    throw new ConfigurationError(
      'TRUSTED_ORIGINS ist leer. Erwartet wird mindestens die Adresse, unter der ' +
        'OpenGewerk erreichbar ist, etwa https://opengewerk.example.de',
    )
  }

  for (const entry of entries) {
    let parsed: URL

    try {
      parsed = new URL(entry)
    } catch {
      throw new ConfigurationError(
        `TRUSTED_ORIGINS enthält keine gültige Adresse: "${entry}". Erwartet wird etwa ` +
          'https://opengewerk.example.de',
      )
    }

    if (parsed.origin !== entry) {
      throw new ConfigurationError(
        `TRUSTED_ORIGINS darf nur Herkunft enthalten, ohne Pfad und ohne Schrägstrich am ` +
          `Ende. Gelesen wurde "${entry}", gemeint ist vermutlich "${parsed.origin}".`,
      )
    }
  }

  return entries
}

/** A flag that is on only for the exact word, so a typo does not open an instance. */
function flag(environment: Environment, name: string): boolean {
  const raw = environment[name]?.trim().toLowerCase()

  if (raw === undefined || raw === '' || raw === 'false' || raw === '0') {
    return false
  }

  if (raw === 'true' || raw === '1') {
    return true
  }

  throw new ConfigurationError(
    `${name} muss "true" oder "false" sein, gelesen wurde: ${environment[name]?.trim()}`,
  )
}

export function readConfiguration(
  environment: Environment = process.env,
  checkAccess: AccessCheck = directoryIsWritable,
): Configuration {
  return {
    databaseUrl: databaseUrl(environment),
    storagePath: storagePath(environment, checkAccess),
    sessionSecret: sessionSecret(environment),
    trustedOrigins: trustedOrigins(environment),
    closed: flag(environment, 'CLOSED'),
    port: port(environment, 'PORT', 3000),
    // Every interface, because inside a container the loopback address means
    // "reachable by nobody". What limits access is the published port and the
    // proxy in front, not a binding the container cannot see past.
    host: environment['HOST']?.trim() || '0.0.0.0',
  }
}
