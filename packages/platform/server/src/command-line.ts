import { type Environment } from './configuration.js'
import { ConfigurationError } from './configuration.js'
import { Database } from './database/database.js'
import type { Terminal } from './authentication/password.js'

// What every command of an application is started with and ends in: the
// arguments, the environment and the terminal it was given, the database it
// talks to, and the one way a failure reaches whoever reads the terminal. The
// commands themselves stand with what they are about.

/** What a command is started with. Left out, it is what the process was given. */
export interface CommandSurroundings {
  /** What stands after the name of the command. */
  readonly arguments?: readonly string[]
  readonly environment?: Environment
  /** Where a password is asked for, and where the answer is not shown. */
  readonly terminal?: Terminal
  /** Where a command says what it did. The console, unless a test listens. */
  readonly say?: (line: string) => void
}

/** The surroundings of a command, with what the process was given where nothing else is said. */
export function surroundingsOf(surroundings: CommandSurroundings): Required<CommandSurroundings> {
  return {
    arguments: surroundings.arguments ?? process.argv.slice(2),
    environment: surroundings.environment ?? process.env,
    terminal: surroundings.terminal ?? { input: process.stdin, output: process.stdout },
    say:
      surroundings.say ??
      ((line) => {
        console.info(line)
      }),
  }
}

/** The database of the instance, or the sentence saying why there is none to talk to. */
export async function reach(databaseUrl: string): Promise<Database> {
  const database = Database.connect(databaseUrl)

  if (!(await database.isReachable())) {
    await database.close()

    throw new ConfigurationError(
      'Keine Verbindung zur Datenbank. Läuft PostgreSQL, und stimmen Adresse und ' +
        'Zugangsdaten in DATABASE_URL?',
    )
  }

  return database
}

/**
 * Runs a command and says what went wrong where it stops. A sentence that was
 * written for whoever reads the terminal is printed as it is; anything else
 * with what the command was about in front of it. A failure sets the exit
 * code and leaves the process to end on its own, so that what was written
 * reaches the terminal.
 */
export async function runCommand(work: () => Promise<void>, failure: string): Promise<void> {
  try {
    await work()
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message)
    } else {
      console.error(failure, error)
    }

    process.exitCode = 1
  }
}
