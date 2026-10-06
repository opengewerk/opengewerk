import 'fake-indexeddb/auto'

import type {
  Operation,
  OperationReceipt,
  RecordState,
  SyncConflict,
} from '@opengewerk/platform-domain'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InterfaceApplication } from '../application.js'
import { Shell } from '../components/surface.js'
import { clockTime, moment } from '../format.js'
import { SyncScreen } from '../office/sync-screen.js'
import { InProbe, probeApplication, probeRecords, probeRules } from '../probe-application.js'
import { ConflictScreen } from '../site/conflicts.js'
import { SyncClient } from './client.js'
import { DecisionFrame } from './decisions.js'
import type { DirectWriter } from './client.js'
import { SyncProvider } from './provider.js'
import { openLocalStore } from './store.js'
import type { PullResult, SyncTransport } from './transport.js'
import { RequestRefused } from './transport.js'

/**
 * What somebody decides about the exchange, in an application that belongs to
 * nobody: the words of its records, its values, the conflict no version
 * settles and its other way out all come from its value, and the decisions
 * themselves are the foundation's.
 */

/** A server that says yes and remembers what it was asked. */
class Quiet implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  readonly resolved: string[] = []
  /** What was written at the route that owns a record, past the outbox. */
  readonly patched: string[] = []
  open: SyncConflict[] = []
  pulls: PullResult[] = []
  offline = false
  refuseResolve = false
  pulled = 0

  push(_deviceId: string, operations: readonly Operation[]) {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.sent.push([...operations])

    return Promise.resolve(
      operations.map((operation): OperationReceipt => ({
        operationId: operation.id,
        outcome: 'applied',
        reason: null,
        fields: [],
      })),
    )
  }

  pull(_since: number) {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.pulled += 1

    return Promise.resolve(this.pulls.shift() ?? { changes: [], cursor: 0, hasMore: false })
  }

  conflicts() {
    return this.offline
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve(this.open)
  }

  resolve(id: string) {
    if (this.offline || this.refuseResolve) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.resolved.push(id)
    this.open = this.open.filter((entry) => entry.id !== id)

    return Promise.resolve()
  }

  patch(entity: string, id: string) {
    this.patched.push(`${entity} ${id}`)

    return Promise.resolve(undefined)
  }

  remove() {
    return Promise.resolve(undefined)
  }

  /** What went out, as entity, kind and the fields with their new values. */
  operations() {
    return this.sent.flat().map((operation) => ({
      entity: operation.entity,
      kind: operation.kind,
      values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
  }
}

let counter = 0
let server: Quiet

/**
 * The moment of every conflict here, and the clock of the device. What a
 * screen makes of them depends on the zone of the machine, and the CI runs in
 * UTC: the expected times are written by the formatters the screens use.
 */
const recordedAt = new Date('2026-09-20T07:30:00Z')
const now = new Date('2026-10-03T08:00:00.000Z')

async function client(rows: Record<string, RecordState[]> = {}) {
  server.pulls.push({
    changes: Object.entries(rows).map(([entity, entries]) => ({ entity, rows: entries })),
    cursor: 1,
    hasMore: false,
  })

  const started = await SyncClient.start({
    store: await openLocalStore(`decisions${String((counter += 1))}`),
    transport: server,
    writer: server,
    rules: probeRules,
    deviceId: 'device',
    entities: ['notes', 'letters', 'letter_lines', 'letter_seals'],
    onSignedOut: () => {},
  })

  await started.synchronise()

  return started
}

/** What a test changes about a conflict: its id as text, the rest as it is typed. */
type ConflictPart = Partial<Omit<SyncConflict, 'id'>> & { readonly id?: string }

function conflict(part: ConflictPart = {}): SyncConflict {
  return {
    id: 'k-1',
    tenantId: 'mandant',
    operationId: 'op-1',
    entity: 'notes',
    recordId: 'n-1',
    reason: 'changed_elsewhere',
    fields: ['text'],
    wanted: { text: 'Regal drei leeren' },
    seen: { text: 'Regal drei prüfen' },
    found: { text: 'Regal drei umräumen' },
    deviceId: 'device',
    recordedAt,
    resolvedAt: null,
    createdAt: new Date('2026-09-20T07:30:00Z'),
    updatedAt: new Date('2026-09-20T07:30:00Z'),
    ...part,
  } as SyncConflict
}

const note = { id: 'n-1', text: 'Regal drei umräumen', version: 2, deletedAt: null }
const sentLetter = { id: 'b-1', subject: 'Mahnung', status: 'sent', version: 3, deletedAt: null }

/** A conflict about a letter that went out, the one the other way of the probe is for. */
function aboutTheLetter(part: ConflictPart = {}): SyncConflict {
  return conflict({
    id: 'k-5',
    entity: 'letters',
    recordId: 'b-1',
    reason: 'record_is_fixed',
    fields: ['status'],
    wanted: { text: 'Mit freundlichem Gruß', status: 'sent', place: 'Lager' },
    seen: {},
    found: {},
    ...part,
  })
}

function inOffice(started: SyncClient, application?: InterfaceApplication) {
  return render(
    <InProbe application={application}>
      <Shell entry="office">
        <SyncProvider client={started}>
          <SyncScreen />
        </SyncProvider>
      </Shell>
    </InProbe>,
  )
}

function onSite(started: SyncClient, application?: InterfaceApplication) {
  return render(
    <InProbe application={application}>
      <Shell entry="site">
        <SyncProvider client={started}>
          <ConflictScreen />
        </SyncProvider>
      </Shell>
    </InProbe>,
  )
}

/** The values of a row of a table, without its head. */
function row(name: RegExp | string) {
  return within(screen.getByRole('row', { name }))
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

function refusing(status: number, message: string) {
  server.push = (_deviceId, operations) =>
    Promise.reject(
      new RequestRefused(status, message, {
        statusCode: status,
        message,
        operationId: operations[0]?.id,
      }),
    )
}

beforeEach(() => {
  server = new Quiet()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a conflict in the office', () => {
  it('puts both versions beside what the device had seen, in the words of the application', async () => {
    server.open = [conflict()]
    inOffice(await client({ notes: [note] }))

    const card = screen.getByRole('region', { name: 'Regal drei umräumen' })

    expect(within(card).getByText('Notiz')).toBeTruthy()
    expect(
      within(card).getByText('Jemand anderes hat das inzwischen geändert. Bitte neu ansehen.'),
    ).toBeTruthy()
    expect(
      within(card).getByRole('table', { name: 'Die beiden Stände von Regal drei umräumen' }),
    ).toBeTruthy()
    expect(
      within(card)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Feld', 'Auf dem Gerät', 'Im System', 'Das Gerät sah'])
    expect(within(card).getByRole('rowheader').textContent).toBe('Text')
    expect(row(/Text/)).toEqual(['Regal drei leeren', 'Regal drei umräumen', 'Regal drei prüfen'])
    expect(within(card).getByText(`Erfasst ${moment(recordedAt)} auf diesem Gerät.`)).toBeTruthy()
  })

  it('says a change came from another device without naming its key', async () => {
    server.open = [conflict({ deviceId: '0193a2b4-0000-7000-8000-000000000001' })]
    inOffice(await client({ notes: [note] }))

    expect(screen.getByText(`Erfasst ${moment(recordedAt)} auf einem anderen Gerät.`)).toBeTruthy()
  })

  it('writes a value as the application does, and what neither knows as it is', async () => {
    server.open = [
      conflict({
        fields: ['weightGrams', 'fragile', 'text', 'quatsch'],
        wanted: { weightGrams: 2500, fragile: true, text: null, quatsch: 7 },
        seen: { weightGrams: 2000, fragile: false },
        found: { weightGrams: 3000, fragile: false, text: 'Alt', quatsch: 'acht' },
      }),
    ]
    inOffice(await client({ notes: [note] }))

    expect(row(/Gewicht/)).toEqual(['2,5 kg', '3 kg', '2 kg'])
    expect(row(/fragile/)).toEqual(['ja', 'nein', 'nein'])
    expect(row(/Text/)).toEqual(['leer', 'Alt', 'leer'])
    // A field neither knows keeps its raw name and its raw value.
    expect(row(/quatsch/)).toEqual(['7', 'acht', 'leer'])
  })

  it('names a record neither side has by what the device wanted, and one without a name by its kind', async () => {
    server.open = [
      conflict({ id: 'k-1', recordId: 'n-9', reason: 'record_missing' }),
      conflict({ id: 'k-2', recordId: 'n-8', fields: ['weightGrams'], wanted: { weightGrams: 1 } }),
    ]
    inOffice(await client())

    expect(screen.getByRole('region', { name: 'Regal drei leeren' })).toBeTruthy()
    expect(screen.getByText('Den Datensatz gibt es nicht mehr.')).toBeTruthy()
    // Both versions all the same: only the other way shows what the device
    // wanted alone.
    expect(
      screen.getByRole('table', { name: 'Die beiden Stände von Regal drei leeren' }),
    ).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Notiz ohne Aufschrift' })).toBeTruthy()
  })

  it('shows every field the device wanted where the server names none', async () => {
    server.open = [conflict({ fields: [], wanted: { text: 'Neu', weightGrams: 1000 } })]
    inOffice(await client({ notes: [note] }))

    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Text',
      'Gewicht',
    ])
  })

  it('shows the fields the server names where the device wanted nothing, and no deletion', async () => {
    server.open = [conflict({ wanted: {} })]
    inOffice(await client({ notes: [note] }))

    expect(row(/Text/)).toEqual(['leer', 'Regal drei umräumen', 'Regal drei prüfen'])
    expect(screen.queryByText('Das Gerät wollte den Eintrag löschen.')).toBeNull()
  })

  it('takes the version of the device as an ordinary change, and closes the conflict', async () => {
    server.open = [conflict()]

    const started = await client({ notes: [note] })

    inOffice(started)
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Fassung vom Gerät übernehmen' }))
    await screen.findByText('Keine Konflikte')
    await started.synchronise()

    expect(server.operations()).toEqual([
      { entity: 'notes', kind: 'update', values: { text: 'Regal drei leeren' } },
    ])
    expect(server.resolved).toEqual(['k-1'])
  })

  it('keeps the version in the system, and sends nothing for it', async () => {
    server.open = [conflict()]

    const started = await client({ notes: [note] })

    inOffice(started)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stand im System behalten' }))
    await screen.findByText('Keine Konflikte')
    await started.synchronise()

    expect(server.operations()).toEqual([])
    expect(server.resolved).toEqual(['k-1'])
  })

  it('says when the version of the device is refused once more, and leaves the conflict open', async () => {
    server.open = [
      conflict({
        entity: 'letter_lines',
        recordId: 'z-1',
        wanted: { text: 'Neu' },
        seen: { text: 'Alt' },
        found: { text: 'Anders' },
      }),
    ]
    inOffice(
      await client({
        letters: [sentLetter],
        letter_lines: [{ id: 'z-1', letterId: 'b-1', text: 'Anders', version: 1, deletedAt: null }],
      }),
    )
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Fassung vom Gerät übernehmen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Das ist festgeschrieben und lässt sich nicht mehr ändern.',
    )
    expect(server.resolved).toEqual([])
    expect(screen.getByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeTruthy()
  })

  it('says when a decision cannot be sent', async () => {
    server.open = [conflict()]

    const started = await client({ notes: [note] })

    server.refuseResolve = true
    inOffice(started)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stand im System behalten' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Entscheidung ließ sich nicht übertragen. Ohne Verbindung geht das nicht.',
    )
  })

  it('offers only to close a conflict the application says no version settles, in its sentence', async () => {
    server.open = [
      conflict({
        entity: 'letter_seals',
        recordId: 's-1',
        fields: ['print'],
        wanted: { letterId: 'b-1', label: 'Siegel A', print: 'abc' },
        seen: {},
        found: {},
      }),
    ]

    const started = await client()

    inOffice(started)

    expect(
      screen.getByText(
        'Das Siegel gilt nicht, der Brief hat sich beim Siegeln geändert. Bitte neu siegeln.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stand im System behalten' })).toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Verstanden' }))
    await screen.findByText('Keine Konflikte')
    await started.synchronise()

    // Nothing of the version of the device, neither through the outbox nor at
    // the route of the record.
    expect(server.operations()).toEqual([])
    expect(server.patched).toEqual([])
    expect(server.resolved).toEqual(['k-1'])
  })
})

describe('the other way out of a conflict', () => {
  it('shows the fields the application chooses, says what the way does and offers it in place of the version of the device', async () => {
    server.open = [aboutTheLetter()]
    inOffice(await client({ letters: [sentLetter] }))

    const card = screen.getByRole('region', { name: 'Brief ohne Aufschrift' })

    expect(
      within(card)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['place', 'Text'])
    expect(
      within(card).getByText(
        'Der Brief ist schon verschickt. Was hier dazukam, lässt sich als Abschrift anlegen.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Als Abschrift anlegen' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Stand im System behalten' })).toBeTruthy()
  })

  it('takes every conflict of its group at once, closes them and says what it made', async () => {
    server.open = [
      aboutTheLetter(),
      aboutTheLetter({ id: 'k-6', wanted: { place: 'Keller' } }),
      aboutTheLetter({ id: 'k-7', recordId: 'b-2' }),
    ]

    const started = await client({
      letters: [sentLetter, { ...sentLetter, id: 'b-2', subject: 'Rechnungsliste' }],
    })

    inOffice(started)
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'Als Abschrift anlegen' })[1] as HTMLElement)

    const made = await screen.findByRole('status')

    expect(made.textContent).toBe('Angelegt: Abschrift von Mahnung.')
    expect(screen.getByRole('region', { name: 'Als Abschrift angelegt' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Als Abschrift anlegen' })).toHaveLength(1)
    })

    await started.synchronise()

    // Once everything is through: the two conflicts of the letter, and not the
    // one of the other letter.
    expect([...server.resolved].sort()).toEqual(['k-5', 'k-6'])

    expect(server.operations()).toEqual([
      {
        entity: 'letters',
        kind: 'create',
        values: {
          subject: 'Abschrift von Mahnung',
          text: 'Mit freundlichem Gruß',
          place: 'Keller',
        },
      },
    ])
  })

  it('says why the way could not be taken, and leaves the conflict open', async () => {
    server.open = [aboutTheLetter()]
    inOffice(await client())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Als Abschrift anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Den Brief gibt es auf diesem Gerät nicht.',
    )
    expect(server.resolved).toEqual([])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says so when what it made stands and its conflicts cannot be closed yet', async () => {
    server.open = [aboutTheLetter()]

    const started = await client({ letters: [sentLetter] })

    server.refuseResolve = true
    inOffice(started)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Als Abschrift anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Abschrift steht. Die Konflikte schließen sich erst mit Verbindung.',
    )
    expect(screen.getByRole('status').textContent).toBe('Angelegt: Abschrift von Mahnung.')
  })

  it('shows only what the device wanted for a record that is nowhere else, and names it by that', async () => {
    server.open = [aboutTheLetter()]
    inOffice(await client())

    expect(
      screen.getByRole('table', {
        name: 'Was das Gerät an Mit freundlichem Gruß schreiben wollte',
      }),
    ).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      'Feld',
      'Auf dem Gerät',
    ])
    expect(row(/Text/)).toEqual(['Mit freundlichem Gruß'])
  })

  it('says that the device wanted to delete where it wanted nothing written', async () => {
    server.open = [aboutTheLetter({ wanted: {} })]
    inOffice(await client({ letters: [sentLetter] }))

    expect(screen.getByText('Das Gerät wollte den Eintrag löschen.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('is not offered where the application has none', async () => {
    server.open = [aboutTheLetter()]

    const { otherWay: _none, ...without } = probeRecords

    inOffice(await client({ letters: [sentLetter] }), probeApplication({ records: without }))

    expect(screen.queryByRole('button', { name: 'Als Abschrift anlegen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeTruthy()
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Stand'])
  })
})

describe('a conflict the application decides itself', () => {
  /** An application that decides the first note itself, and the second with it. */
  function deciding() {
    return probeApplication({
      records: {
        ...probeRecords,
        ownDecision: (asked) =>
          asked.recordId === 'n-1' ? (
            <DecisionFrame kind="Notiz" title="Zweimal notiert" reason="Diese Notiz gibt es schon.">
              <button type="button">Ist dieselbe</button>
            </DecisionFrame>
          ) : asked.recordId === 'n-2' ? null : undefined,
      },
    })
  }

  const notes = [
    note,
    { ...note, id: 'n-2', text: 'Regal vier' },
    { ...note, id: 'n-3', text: 'Regal fünf' },
  ]

  it('shows the card of the application in place of its own, in the frame of the office', async () => {
    server.open = [conflict()]
    inOffice(await client({ notes }), deciding())

    const card = screen.getByRole('region', { name: 'Zweimal notiert' })

    expect(within(card).getByText('Diese Notiz gibt es schon.')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Ist dieselbe' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows no card for a conflict that is decided with another one, and its own for every other', async () => {
    server.open = [
      conflict(),
      conflict({ id: 'k-2', recordId: 'n-2' }),
      conflict({ id: 'k-3', recordId: 'n-3' }),
    ]
    onSite(await client({ notes }), deciding())

    expect(screen.getAllByRole('heading', { level: 2 }).map((head) => head.textContent)).toEqual([
      'Zweimal notiert',
      'Regal fünf',
    ])
    expect(screen.getAllByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toHaveLength(1)
    // Nothing is closed by leaving a card out: the three are still to decide.
    expect(screen.getByText('3 Konflikte warten auf eine Entscheidung.')).toBeTruthy()
    expect(server.resolved).toEqual([])
  })

  it('leaves every conflict to the foundation where the application decides none itself', async () => {
    server.open = [conflict()]
    onSite(await client({ notes }))

    expect(screen.getByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeTruthy()
  })
})

describe('an entry the server refused', () => {
  it('shows what the device wanted to make, and lets it go with everything after it', async () => {
    const started = await client()

    refusing(400, 'Unbekanntes Feld: quatsch')
    await started.create('notes', { text: 'Regal vier' })
    await started.synchronise()
    inOffice(started)

    const card = screen.getByRole('region', { name: 'Regal vier' })

    expect(within(card).getByText('Notiz')).toBeTruthy()
    expect(within(card).getByText('Unbekanntes Feld: quatsch')).toBeTruthy()
    expect(within(card).getByText(/Verwerfen nimmt ihn samt den späteren Änderungen/)).toBeTruthy()
    expect(row(/Text/)).toEqual(['Regal vier'])
    expect(screen.queryByText(/Nichts zu entscheiden/)).toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Eintrag verwerfen' }))

    expect(await screen.findByText(/Nichts zu entscheiden/)).toBeTruthy()
    expect(started.list('notes')).toEqual([])
    expect(started.status().pending).toBe(0)
  })

  it('names a refused change and a refused deletion, and sends them again on demand', async () => {
    const started = await client({ notes: [note] })

    refusing(403, 'Dafür fehlt das Recht.')
    await started.update('notes', 'n-1', { text: 'Regal fünf' })
    await started.synchronise()
    inOffice(started)

    expect(screen.getByText(/Verwerfen nimmt sie von diesem Gerät/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Änderung verwerfen' })).toBeTruthy()

    const pulls = server.pulled

    await userEvent.setup().click(screen.getByRole('button', { name: 'Erneut senden' }))
    await waitFor(() => {
      expect(server.pulled).toBeGreaterThan(pulls)
    })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Änderung verwerfen' }))
    await started.remove('notes', 'n-1')
    await started.synchronise()

    expect(await screen.findByText('Das Gerät wollte den Eintrag löschen.')).toBeTruthy()
    expect(
      screen.getByText(/Erneut senden hilft nur, wenn der Grund inzwischen behoben ist/),
    ).toBeTruthy()
  })
})

describe('"Abgleich" in the office', () => {
  it('says that nothing is to decide, and when this device last exchanged', async () => {
    inOffice(await client())

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Abgleich' })).toBeTruthy()
    expect(state.getByText('Zuletzt abgeglichen')).toBeTruthy()
    expect(state.getByText(clockTime(now))).toBeTruthy()
    expect(state.getByText('Nichts wartet, nichts zu entscheiden')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Keine Konflikte' }).textContent).toContain(
      'Nichts zu entscheiden.',
    )
  })

  it('counts what waits and what is to decide, and says when there is no connection', async () => {
    const started = await client({ notes: [note] })

    server.offline = true
    await started.create('notes', { text: 'Eins' })
    await started.synchronise()
    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(
      state.getByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeTruthy()
    expect(state.getByText('1 Vorgang wartet')).toBeTruthy()
    expect(state.queryByText('Nichts wartet, nichts zu entscheiden')).toBeNull()

    await started.create('notes', { text: 'Zwei' })

    expect(await state.findByText('2 Vorgänge warten')).toBeTruthy()
  })

  it('counts one conflict and several, and the refused entry', async () => {
    server.open = [conflict(), conflict({ id: 'k-2' })]

    const started = await client({ notes: [note] })

    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('2 Konflikte, bitte entscheiden')).toBeTruthy()
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'Stand im System behalten' })[0] as HTMLElement)
    expect(await state.findByText('1 Konflikt, bitte entscheiden')).toBeTruthy()

    refusing(400, 'Nein.')
    await started.create('notes', { text: 'Drei' })
    await started.synchronise()

    expect(await state.findByText('Eine Änderung abgelehnt, bitte entscheiden')).toBeTruthy()
  })

  it('does not claim there is no connection while a change is still on its way', async () => {
    const started = await client()

    server.push = () => new Promise<OperationReceipt[]>(() => {})
    await started.create('notes', { text: 'Unterwegs' })
    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(await state.findByText('1 Vorgang wartet')).toBeTruthy()
    expect(
      state.queryByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeNull()
  })

  it('says when there is no connection, even when nothing waits', async () => {
    const started = await client()

    server.offline = true
    await started.synchronise()
    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(
      state.getByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeTruthy()
    expect(state.queryByText('Nichts wartet, nichts zu entscheiden')).toBeNull()
  })

  /**
   * The state of the client names what needs somebody first, a refused change
   * before a conflict before a missing connection, and the line was asked of
   * that state: with a conflict open and no network it was missing, and
   * whoever decided learned only at the card that the decision did not get
   * out (#494).
   */
  it('says when there is no connection while a conflict is open as well', async () => {
    server.open = [conflict()]

    const started = await client({ notes: [note] })

    server.offline = true
    await started.create('notes', { text: 'Eins' })
    await started.synchronise()
    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('1 Konflikt, bitte entscheiden')).toBeTruthy()
    expect(state.getByText('1 Vorgang wartet')).toBeTruthy()
    expect(
      state.getByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeTruthy()
  })

  it('says when there is no connection while a refused change waits as well', async () => {
    const started = await client()

    refusing(400, 'Nein.')
    await started.create('notes', { text: 'Drei' })
    await started.synchronise()
    server.offline = true
    server.push = () => Promise.reject(new TypeError('Failed to fetch'))
    await started.synchronise()
    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('Eine Änderung abgelehnt, bitte entscheiden')).toBeTruthy()
    expect(
      state.getByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeTruthy()
  })

  it('says nothing of the connection over a conflict while the device has one', async () => {
    server.open = [conflict()]
    inOffice(await client({ notes: [note] }))

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('1 Konflikt, bitte entscheiden')).toBeTruthy()
    expect(
      state.queryByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeNull()
  })

  /**
   * A server that answered and refused the exchange leaves a reason behind as
   * well, and the line said "Keine Verbindung" over it, on a device that has
   * one, with "sobald wieder Netz da ist" for something no network cures
   * (#545). The strip over the page had the sentence of the server all along.
   */
  it('says the sentence of the server that answered and refused, not that the connection is missing', async () => {
    const started = await client()

    server.pull = () =>
      Promise.reject(new RequestRefused(403, 'Abgleichen darf dieser Zugang nicht.'))
    await started.create('notes', { text: 'Eins' })
    await started.synchronise()
    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('Abgleichen darf dieser Zugang nicht.')).toBeTruthy()
    expect(
      state.queryByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeNull()
    // Nor that all is well.
    expect(state.queryByText('Nichts wartet, nichts zu entscheiden')).toBeNull()
  })

  it('does not say that all is well over a refused exchange with nothing waiting', async () => {
    const started = await client()

    server.pull = () =>
      Promise.reject(new RequestRefused(403, 'Abgleichen darf dieser Zugang nicht.'))
    await started.synchronise()
    inOffice(started)

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('Abgleichen darf dieser Zugang nicht.')).toBeTruthy()
    expect(state.queryByText('Nichts wartet, nichts zu entscheiden')).toBeNull()
  })

  it('offers no second exchange while one runs', async () => {
    const started = await client()
    let answer: (result: PullResult) => void = () => {}

    inOffice(started)
    server.pull = () =>
      new Promise<PullResult>((resolve) => {
        answer = resolve
      })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Jetzt abgleichen' }))

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Jetzt abgleichen' }).disabled,
      ).toBe(true)
    })
    answer({ changes: [], cursor: 2, hasMore: false })
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Jetzt abgleichen' }).disabled,
      ).toBe(false)
    })
  })

  it('says so before this device ever exchanged', async () => {
    server.offline = true

    const started = await SyncClient.start({
      store: await openLocalStore(`decisions${String((counter += 1))}`),
      transport: server,
      writer: server,
      rules: probeRules,
      deviceId: 'device',
      entities: ['notes'],
      onSignedOut: () => {},
    })

    inOffice(started)

    expect(screen.getByText('Noch nicht abgeglichen')).toBeTruthy()
  })

  it('exchanges at once on demand', async () => {
    const started = await client()

    inOffice(started)
    server.open = [conflict()]
    server.pulls.push({ changes: [{ entity: 'notes', rows: [note] }], cursor: 2, hasMore: false })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Jetzt abgleichen' }))

    expect(await screen.findByRole('region', { name: 'Regal drei umräumen' })).toBeTruthy()
  })

  it('shows both versions as cards on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    server.open = [conflict()]
    inOffice(await client({ notes: [note] }))

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Auf dem Gerät: Regal drei leeren')).toBeTruthy()
    expect(screen.getByText('Im System: Regal drei umräumen')).toBeTruthy()
    expect(screen.getByText('Das Gerät sah: Regal drei prüfen')).toBeTruthy()
  })
})

describe('"Konflikte" on site', () => {
  it('says that nothing is to decide, and when this device last exchanged', async () => {
    onSite(await client())

    const state = within(screen.getByRole('list', { name: 'Stand des Abgleichs' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Konflikte' })).toBeTruthy()
    expect(state.getByText(`Zuletzt abgeglichen um ${clockTime(now)}.`)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Keine Konflikte' })).toBeTruthy()
  })

  it('counts what waits, and says when there is no connection', async () => {
    const started = await client({ notes: [note] })

    server.offline = true
    await started.create('notes', { text: 'Eins' })
    await started.synchronise()
    onSite(started)

    const state = within(screen.getByRole('list', { name: 'Stand des Abgleichs' }))

    expect(
      state.getByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeTruthy()
    expect(state.getByText('1 Änderung wartet auf dem Gerät.')).toBeTruthy()

    await started.create('notes', { text: 'Zwei' })

    expect(await state.findByText('2 Änderungen warten auf dem Gerät.')).toBeTruthy()
  })

  it('counts several conflicts and one, and the refused entry', async () => {
    server.open = [conflict(), conflict({ id: 'k-2' })]

    const started = await client({ notes: [note] })

    onSite(started)

    const state = within(screen.getByRole('list', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('2 Konflikte warten auf eine Entscheidung.')).toBeTruthy()
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'Stand im System behalten' })[0] as HTMLElement)
    expect(await state.findByText('Ein Konflikt wartet auf eine Entscheidung.')).toBeTruthy()

    refusing(400, 'Nein.')
    await started.create('notes', { text: 'Drei' })
    await started.synchronise()

    expect(
      await state.findByText('Eine Änderung wurde abgelehnt und wartet auf eine Entscheidung.'),
    ).toBeTruthy()
  })

  it('says when there is no connection while a conflict is open as well', async () => {
    server.open = [conflict()]

    const started = await client({ notes: [note] })

    server.offline = true
    await started.create('notes', { text: 'Eins' })
    await started.synchronise()
    onSite(started)

    const state = within(screen.getByRole('list', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('Ein Konflikt wartet auf eine Entscheidung.')).toBeTruthy()
    expect(state.getByText('1 Änderung wartet auf dem Gerät.')).toBeTruthy()
    expect(
      state.getByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeTruthy()
  })

  it('says when there is no connection while a refused change waits as well', async () => {
    const started = await client()

    refusing(400, 'Nein.')
    await started.create('notes', { text: 'Drei' })
    await started.synchronise()
    server.offline = true
    server.push = () => Promise.reject(new TypeError('Failed to fetch'))
    await started.synchronise()
    onSite(started)

    const state = within(screen.getByRole('list', { name: 'Stand des Abgleichs' }))

    expect(
      state.getByText('Eine Änderung wurde abgelehnt und wartet auf eine Entscheidung.'),
    ).toBeTruthy()
    expect(
      state.getByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeTruthy()
  })

  /**
   * On site the line was asked of the state alone, and the state is the same
   * for a change on its way as for one that cannot get out: the screen said
   * "Keine Verbindung" over a send that worked, as the strip once did (#223).
   */
  it('does not claim there is no connection while a change is still on its way', async () => {
    const started = await client()

    server.push = () => new Promise<OperationReceipt[]>(() => {})
    await started.create('notes', { text: 'Unterwegs' })
    onSite(started)

    const state = within(screen.getByRole('list', { name: 'Stand des Abgleichs' }))

    expect(await state.findByText('1 Änderung wartet auf dem Gerät.')).toBeTruthy()
    expect(
      state.queryByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeNull()
  })

  it('says the sentence of the server that answered and refused, not that the connection is missing', async () => {
    const started = await client()

    server.pull = () =>
      Promise.reject(new RequestRefused(403, 'Abgleichen darf dieser Zugang nicht.'))
    await started.create('notes', { text: 'Eins' })
    await started.synchronise()
    onSite(started)

    const state = within(screen.getByRole('list', { name: 'Stand des Abgleichs' }))

    // The device has a connection, and no network cures a right that is missing (#545).
    expect(state.getByText('Abgleichen darf dieser Zugang nicht.')).toBeTruthy()
    expect(
      state.queryByText('Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.'),
    ).toBeNull()
  })

  it('says so before this device ever exchanged, and tries again on demand', async () => {
    server.offline = true

    const started = await SyncClient.start({
      store: await openLocalStore(`decisions${String((counter += 1))}`),
      transport: server,
      writer: server,
      rules: probeRules,
      deviceId: 'device',
      entities: ['notes'],
      onSignedOut: () => {},
    })

    onSite(started)

    expect(screen.getByText('Noch nicht abgeglichen.')).toBeTruthy()

    server.offline = false
    server.open = [conflict()]
    server.pulls.push({ changes: [{ entity: 'notes', rows: [note] }], cursor: 2, hasMore: false })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByRole('region', { name: 'Regal drei umräumen' })).toBeTruthy()
    expect(screen.getByText(`Zuletzt abgeglichen um ${clockTime(now)}.`)).toBeTruthy()
  })

  it('puts each field with the two versions one over the other', async () => {
    server.open = [conflict()]

    const started = await client({ notes: [note] })

    onSite(started)

    const card = within(screen.getByRole('region', { name: 'Regal drei umräumen' }))

    expect(card.getByText('Notiz')).toBeTruthy()
    expect(card.getByText('Feld: Text')).toBeTruthy()
    expect(card.getByText('Auf dem Gerät').parentElement?.textContent).toBe(
      'Auf dem GerätRegal drei leeren',
    )
    expect(card.getByText('Im System').parentElement?.textContent).toBe(
      'Im SystemRegal drei umräumen',
    )
    expect(card.getByText('Das Gerät sah: Regal drei prüfen')).toBeTruthy()
    expect(card.getByText(`Erfasst ${moment(recordedAt)} auf diesem Gerät.`)).toBeTruthy()

    await userEvent
      .setup()
      .click(card.getByRole('button', { name: 'Fassung vom Gerät übernehmen' }))
    await screen.findByRole('region', { name: 'Keine Konflikte' })
    await started.synchronise()

    expect(server.operations()).toEqual([
      { entity: 'notes', kind: 'update', values: { text: 'Regal drei leeren' } },
    ])
  })

  it('offers the other way and the sentence of a conflict no version settles, at its size', async () => {
    server.open = [
      aboutTheLetter(),
      conflict({
        id: 'k-9',
        entity: 'letter_seals',
        recordId: 's-1',
        wanted: { label: 'Siegel A' },
        seen: {},
        found: {},
      }),
    ]

    const started = await client()

    onSite(started)

    const letter = within(screen.getByRole('region', { name: 'Mit freundlichem Gruß' }))

    // Only what the device wanted, for a letter that is nowhere else.
    expect(letter.queryByText('Im System')).toBeNull()
    expect(letter.getByText('Feld: Text')).toBeTruthy()
    expect(
      letter.getByText(
        'Der Brief ist schon verschickt. Was hier dazukam, lässt sich als Abschrift anlegen.',
      ),
    ).toBeTruthy()
    expect(letter.getByRole('button', { name: 'Als Abschrift anlegen' })).toBeTruthy()

    const seal = within(screen.getByRole('region', { name: 'Siegel A' }))

    expect(
      seal.getByText(
        'Das Siegel gilt nicht, der Brief hat sich beim Siegeln geändert. Bitte neu siegeln.',
      ),
    ).toBeTruthy()
    await userEvent.setup().click(seal.getByRole('button', { name: 'Verstanden' }))

    await waitFor(() => {
      expect(server.resolved).toEqual(['k-9'])
    })
    await started.synchronise()
    expect(server.operations()).toEqual([])
    expect(server.patched).toEqual([])
  })

  it('offers no second try while one runs', async () => {
    const started = await client()
    let answer: (result: PullResult) => void = () => {}

    onSite(started)
    server.pull = () =>
      new Promise<PullResult>((resolve) => {
        answer = resolve
      })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Erneut versuchen' }).disabled,
    ).toBe(true)
    answer({ changes: [], cursor: 2, hasMore: false })
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Erneut versuchen' }).disabled,
      ).toBe(false)
    })
  })

  it('takes the other way at its size, and says what it made', async () => {
    server.open = [aboutTheLetter()]
    onSite(await client({ letters: [sentLetter] }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Als Abschrift anlegen' }))

    expect((await screen.findByRole('status')).textContent).toBe('Angelegt: Abschrift von Mahnung.')
    expect(screen.getByRole('region', { name: 'Als Abschrift angelegt' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Keine Konflikte' })).toBeTruthy()
  })

  it('shows an entry the server refused at its size, and lets it go', async () => {
    const started = await client()

    refusing(400, 'Unbekanntes Feld: quatsch')
    await started.create('notes', { text: 'Regal vier' })
    await started.synchronise()
    onSite(started)

    expect(screen.getByRole('heading', { level: 2, name: 'Regal vier' })).toBeTruthy()
    expect(screen.getByText('Feld: Text')).toBeTruthy()
    expect(screen.getByText('Unbekanntes Feld: quatsch')).toBeTruthy()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Eintrag verwerfen' }))

    expect(await screen.findByRole('region', { name: 'Keine Konflikte' })).toBeTruthy()
  })
})
