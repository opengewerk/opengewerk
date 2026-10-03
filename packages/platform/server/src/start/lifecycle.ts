import { ConfigurationError } from '../configuration.js'

/** One step of stopping, run after the one before it has finished. */
export type StopStep = () => Promise<unknown> | unknown

/** What a process offers to be told about a signal. */
export interface SignalTarget {
  once(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown
}

/**
 * Stops an instance when the container runtime asks it to, in the order the
 * steps are given.
 *
 * A container gets SIGTERM and then, a moment later, SIGKILL. Closing in
 * between lets running transactions commit instead of being cut off, which
 * matters most during an update: that is when a restart is most likely to
 * land in the middle of somebody writing something down. The order is the
 * point. The jobs of the application finish their pass first, so that a
 * message is not sent and then forgotten; then the server stops taking
 * requests, and the pool closes last, because the requests still in flight
 * would otherwise lose their connection.
 *
 * Returns what a signal starts, for a test to call.
 */
export function stopOnSignals(
  name: string,
  steps: readonly StopStep[],
  target: SignalTarget = process,
  say: (line: string) => void = console.info,
  complain: (line: string, error: unknown) => void = console.error,
): (signal: NodeJS.Signals) => Promise<void> {
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    say(`${signal} empfangen, ${name} fährt herunter.`)

    try {
      for (const step of steps) {
        await step()
      }
    } catch (error) {
      complain('Beim Herunterfahren ist etwas schiefgegangen.', error)
      process.exitCode = 1
    }
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    target.once(signal, (received) => {
      void stop(received)
    })
  }

  return stop
}

/** What the line at the start of an instance says, and where it comes from. */
export interface StartupFacts {
  /** What the application is called. */
  readonly name: string
  readonly host: string
  readonly port: number
  /** Whether a built interface is served beside the API. */
  readonly interfaceServed: boolean
  /** Whether the instance is closed through `CLOSED`. */
  readonly closed: boolean
  /** Whether nobody has set the instance up yet. */
  readonly empty: boolean
  /** Whether the instance has a setup code to ask the first run for. */
  readonly setupCode: boolean
  /**
   * What the application says about an instance nobody has set up yet: a
   * sentence that names what its first run creates, in its own words.
   */
  readonly emptyInstance: string
}

/**
 * The one line an instance writes when it listens.
 *
 * Where the setup code is, and never the code itself: the log of a container is
 * read by more people and kept longer than the `.env`. A fresh installation
 * that says nothing about its first run looks in the log exactly like one
 * that is set up, and the sentence saves whoever put it there from wondering
 * where the sign in went.
 */
export function startupLine(facts: StartupFacts): string {
  return (
    `${facts.name} lauscht auf ${facts.host}:${String(facts.port)}.` +
    (facts.interfaceServed ? '' : ' Es ist keine gebaute Oberfläche dabei, nur die API.') +
    (facts.closed
      ? ' Die Instanz ist über CLOSED geschlossen, jede Anfrage an die Daten wird ' +
        'abgelehnt, die Anmeldung und die Ersteinrichtung eingeschlossen.'
      : '') +
    (facts.empty
      ? ` ${facts.emptyInstance}` +
        (facts.setupCode
          ? ' Sie verlangt den Einrichtungscode aus SETUP_CODE, in einer Installation ' +
            'mit Docker steht er in docker/.env.'
          : ' SETUP_CODE ist nicht gesetzt, deshalb nimmt sie keine Einrichtung an; ' +
            '"sh docker/start.sh" trägt den Einrichtungscode in docker/.env ein.')
      : '')
  )
}

/**
 * Runs the start of an instance and ends the process with an error code when
 * it fails.
 *
 * A configuration mistake gets its sentence and nothing else. A stack trace
 * above "DATABASE_URL fehlt" buries the one line that says what to do.
 */
export async function runInstance(
  name: string,
  start: () => Promise<void>,
  complain: (...parts: unknown[]) => void = console.error,
): Promise<void> {
  try {
    await start()
  } catch (error) {
    if (error instanceof ConfigurationError) {
      complain(error.message)
    } else {
      complain(`${name} konnte nicht starten.`, error)
    }

    process.exitCode = 1
  }
}
