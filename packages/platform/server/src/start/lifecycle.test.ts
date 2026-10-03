import { afterEach, describe, expect, it } from 'vitest'

import { ConfigurationError } from '../configuration.js'
import { runInstance, type SignalTarget, startupLine, stopOnSignals } from './lifecycle.js'

// The start and the end of an instance of an application that belongs to
// nobody: the order it stops in, the line it writes when it listens, and what
// a start that fails leaves behind.

afterEach(() => {
  process.exitCode = 0
})

/** A process that only writes down what it is asked to listen for. */
function signals(): SignalTarget & {
  readonly heard: Map<string, (signal: NodeJS.Signals) => void>
} {
  const heard = new Map<string, (signal: NodeJS.Signals) => void>()

  return {
    heard,
    once(signal, listener) {
      heard.set(signal, listener)
    },
  }
}

describe('stopping on a signal', () => {
  it('listens for both signals a container runtime sends', () => {
    const target = signals()

    stopOnSignals('Probewerk', [], target, () => undefined)

    expect([...target.heard.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])
  })

  it('says so, and runs every step after the one before it has finished', async () => {
    const target = signals()
    const said: string[] = []
    const done: string[] = []
    const step = (name: string, wait: number) => async () => {
      await new Promise((resolve) => setTimeout(resolve, wait))
      done.push(name)
    }

    const stop = stopOnSignals(
      'Probewerk',
      [step('jobs', 15), step('server', 5), () => done.push('pool')],
      target,
      (line) => said.push(line),
    )

    await stop('SIGTERM')

    expect(said).toEqual(['SIGTERM empfangen, Probewerk fährt herunter.'])
    expect(done).toEqual(['jobs', 'server', 'pool'])
  })

  it('starts the same stop from the signal it heard', async () => {
    const target = signals()
    const said: string[] = []

    stopOnSignals('Probewerk', [], target, (line) => said.push(line))
    target.heard.get('SIGINT')?.('SIGINT')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(said).toEqual(['SIGINT empfangen, Probewerk fährt herunter.'])
  })

  it('ends with an error code where a step fails, and runs none after it', async () => {
    const complaints: unknown[][] = []
    const done: string[] = []
    const stop = stopOnSignals(
      'Probewerk',
      [
        () => {
          throw new Error('Pool weg')
        },
        () => done.push('never'),
      ],
      signals(),
      () => undefined,
      (...parts) => complaints.push(parts),
    )

    await stop('SIGTERM')

    expect(complaints[0]?.[0]).toBe('Beim Herunterfahren ist etwas schiefgegangen.')
    expect(done).toEqual([])
    expect(process.exitCode).toBe(1)
  })
})

describe('the line at the start', () => {
  const facts = {
    name: 'Probewerk',
    host: '0.0.0.0',
    port: 23900,
    interfaceServed: true,
    closed: false,
    empty: false,
    setupCode: true,
    emptyInstance: 'Diese Instanz ist noch leer: im Browser steht die Ersteinrichtung.',
  }

  it('says where the instance listens, and nothing more when all is ordinary', () => {
    expect(startupLine(facts)).toBe('Probewerk lauscht auf 0.0.0.0:23900.')
  })

  it('says when there is no interface, only the API', () => {
    expect(startupLine({ ...facts, interfaceServed: false })).toBe(
      'Probewerk lauscht auf 0.0.0.0:23900. Es ist keine gebaute Oberfläche dabei, nur die API.',
    )
  })

  it('says when the instance is closed', () => {
    expect(startupLine({ ...facts, closed: true })).toContain(
      ' Die Instanz ist über CLOSED geschlossen, jede Anfrage an die Daten wird abgelehnt, ' +
        'die Anmeldung und die Ersteinrichtung eingeschlossen.',
    )
  })

  it('says an empty instance in the words of the application, and where the setup code is', () => {
    expect(startupLine({ ...facts, empty: true })).toBe(
      'Probewerk lauscht auf 0.0.0.0:23900. Diese Instanz ist noch leer: im Browser steht die ' +
        'Ersteinrichtung. Sie verlangt den Einrichtungscode aus SETUP_CODE, in einer ' +
        'Installation mit Docker steht er in docker/.env.',
    )
  })

  it('says what is missing when an empty instance has no setup code', () => {
    expect(startupLine({ ...facts, empty: true, setupCode: false })).toContain(
      ' SETUP_CODE ist nicht gesetzt, deshalb nimmt sie keine Einrichtung an; ' +
        '"sh docker/start.sh" trägt den Einrichtungscode in docker/.env ein.',
    )
  })
})

describe('a start', () => {
  it('that succeeds leaves the process as it was', async () => {
    const complaints: unknown[][] = []

    await runInstance(
      'Probewerk',
      () => Promise.resolve(),
      (...parts) => complaints.push(parts),
    )

    expect(complaints).toEqual([])
    expect(process.exitCode).toBe(0)
  })

  it('that fails at its configuration says the sentence and nothing else', async () => {
    const complaints: unknown[][] = []

    await runInstance(
      'Probewerk',
      () => Promise.reject(new ConfigurationError('DATABASE_URL fehlt.')),
      (...parts) => complaints.push(parts),
    )

    expect(complaints).toEqual([['DATABASE_URL fehlt.']])
    expect(process.exitCode).toBe(1)
  })

  it('that fails otherwise says which application could not start, with the error', async () => {
    const complaints: unknown[][] = []
    const failure = new Error('kaputt')

    await runInstance(
      'Probewerk',
      () => Promise.reject(failure),
      (...parts) => complaints.push(parts),
    )

    expect(complaints).toEqual([['Probewerk konnte nicht starten.', failure]])
    expect(process.exitCode).toBe(1)
  })
})
