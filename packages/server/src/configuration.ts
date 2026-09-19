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

export function readConfiguration(environment: Environment = process.env): Configuration {
  return {
    databaseUrl: databaseUrl(environment),
    port: port(environment, 'PORT', 3000),
    // Every interface, because inside a container the loopback address means
    // "reachable by nobody". What limits access is the published port and the
    // proxy in front, not a binding the container cannot see past.
    host: environment['HOST']?.trim() || '0.0.0.0',
  }
}
