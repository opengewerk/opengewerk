import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, RecordState, SyncConflict } from '@opengewerk/domain'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConflictScreen } from './conflicts.js'
import { EntrySuggestion } from './suggestion.js'
import { SyncStatusBar } from './sync-bar.js'
import { entryChoiceKey } from '../entry/entry.js'
import { SyncScreen } from '../office/screens/sync.js'
import type { DirectWriter } from '../sync/client.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import type { PullResult, SyncTransport } from '../sync/transport.js'
import { RequestRefused } from '../sync/transport.js'

/** A server that says yes and remembers what it was asked. */
class Quiet implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  readonly patched: { entity: string; id: string; values: unknown }[] = []
  readonly resolved: string[] = []
  open: SyncConflict[] = []
  pulls: PullResult[] = []

  push(_deviceId: string, operations: readonly Operation[]) {
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
    return Promise.resolve(this.pulls.shift() ?? { changes: [], cursor: 0, hasMore: false })
  }

  conflicts() {
    return Promise.resolve(this.open)
  }

  resolve(id: string) {
    this.resolved.push(id)
    this.open = this.open.filter((entry) => entry.id !== id)

    return Promise.resolve()
  }

  patch(entity: string, id: string, values: Readonly<Record<string, unknown>>) {
    this.patched.push({ entity, id, values })

    return Promise.resolve(undefined)
  }

  remove() {
    return Promise.resolve(undefined)
  }
}

let counter = 0

async function withClient(server: Quiet, rows: Record<string, RecordState[]> = {}) {
  const store = await openLocalStore(`screen${String((counter += 1))}`)

  server.pulls = [
    {
      changes: Object.entries(rows).map(([entity, entries]) => ({ entity, rows: entries })),
      cursor: 1,
      hasMore: false,
    },
  ]

  const client = await SyncClient.start({
    store,
    transport: server,
    writer: server,
    deviceId: 'device',
    entities: ['customers', 'jobs', 'documents', 'document_lines'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  return client
}

function conflict(part: Partial<SyncConflict> = {}): SyncConflict {
  return {
    id: 'k-1',
    tenantId: 'mandant',
    operationId: 'op-1',
    entity: 'jobs',
    recordId: 'j-1',
    reason: 'changed_elsewhere',
    fields: ['designation'],
    wanted: { designation: 'Zählerwechsel' },
    seen: { designation: 'Zählertausch' },
    found: { designation: 'Zähler prüfen' },
    deviceId: 'device',
    recordedAt: new Date('2026-09-20T07:30:00Z'),
    resolvedAt: null,
    createdAt: new Date('2026-09-20T07:30:00Z'),
    updatedAt: new Date('2026-09-20T07:30:00Z'),
    ...part,
  } as SyncConflict
}

describe('the conflict screen', () => {
  let server: Quiet

  beforeEach(() => {
    server = new Quiet()
  })

  it('puts both versions beside each other, and what the device had seen', async () => {
    server.open = [conflict()]

    const client = await withClient(server, {
      jobs: [{ id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null }],
    })

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    // Three columns and not two. The third is what explains the other two:
    // without it a person sees two values and no reason why anyone would have
    // typed either. Asked of the row rather than of the page, because the
    // heading says what the record is called now and that is one of the three.
    const row = within(screen.getByRole('row', { name: /Bezeichnung/ }))

    expect(row.getByText('Zählerwechsel')).toBeDefined()
    expect(row.getByText('Zähler prüfen')).toBeDefined()
    expect(row.getByText('Zählertausch')).toBeDefined()
  })

  it('says on which device a change was made in words, not by its key (#271)', async () => {
    server.open = [
      conflict(),
      conflict({
        id: 'k-2' as SyncConflict['id'],
        recordId: 'j-2',
        deviceId: '0192a7c4-1f3e-7b21-9c55-2f0d4e8a6b10',
      }),
    ]

    const client = await withClient(server, {
      jobs: [
        { id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null },
        { id: 'j-2', designation: 'Zähler prüfen', version: 2, deletedAt: null },
      ],
    })

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    expect(await screen.findByText(/^Erfasst .* auf diesem Gerät\.$/)).toBeDefined()
    expect(screen.getByText(/^Erfasst .* auf einem anderen Gerät\.$/)).toBeDefined()
    expect(screen.queryByText(/0192a7c4/)).toBeNull()
  })

  it('lets the device win, and sends that as an ordinary change', async () => {
    server.open = [conflict()]

    const client = await withClient(server, {
      jobs: [{ id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null }],
    })

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Fassung vom Gerät übernehmen' }))

    // Deciding a conflict is not a back door. The decision leaves through the
    // outbox like any other change, so it passes the same rules and lands in
    // the same audit log.
    expect(server.sent.at(-1)?.[0]?.patches).toEqual([
      { field: 'designation', from: 'Zähler prüfen', to: 'Zählerwechsel' },
    ])
    expect(server.resolved).toEqual(['k-1'])
  })

  it('keeps the server version when that is what somebody decides', async () => {
    server.open = [conflict()]

    const client = await withClient(server, {
      jobs: [{ id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null }],
    })

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Stand im System behalten' }))

    expect(server.sent).toEqual([])
    expect(server.resolved).toEqual(['k-1'])
  })

  /**
   * A signature refused because the report changed under it. Taken anyway it
   * would stand under a page the customer never saw, so there is nothing to
   * choose between, and a table of two fingerprints would explain nothing.
   */
  it('explains a refused signature instead of offering to push it through', async () => {
    server.open = [
      conflict({
        entity: 'document_signatures',
        recordId: 's-1',
        fields: ['contentFingerprint'],
        wanted: {
          documentId: 'd-1',
          signerName: 'Erika Berg',
          path: 'M100,300L240,120',
          contentFingerprint: 'fnv1a32:0badf00d:61',
        },
        seen: {},
        found: {},
      }),
    ]

    const client = await withClient(server)

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Erika Berg' })).toBeDefined()
    expect(screen.getByText(/Die Unterschrift gilt nicht/)).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Verstanden' }))

    expect(server.sent).toEqual([])
    expect(server.patched).toEqual([])
    expect(server.resolved).toEqual(['k-1'])
  })

  /**
   * Not a conflict, but decided on the same screen: the server refused the
   * entry outright and named it, and until somebody lets it go nothing behind
   * it leaves the device (#120).
   */
  it('shows an entry the server refused with what it wanted, and lets it go', async () => {
    const client = await withClient(server)

    server.push = (_deviceId, operations) =>
      Promise.reject(
        new RequestRefused(400, 'Unbekanntes Feld: quatsch', {
          statusCode: 400,
          message: 'Unbekanntes Feld: quatsch',
          operationId: operations[0]?.id,
        }),
      )

    await client.create('customers', { name: 'Meyer', kind: 'private' })
    await client.synchronise()

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Meyer' })).toBeDefined()
    expect(screen.getByText('Unbekanntes Feld: quatsch')).toBeDefined()
    expect(within(screen.getByRole('row', { name: /Name/ })).getByText('Meyer')).toBeDefined()
    expect(screen.queryByText(/Nichts zu entscheiden/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Eintrag verwerfen' }))

    expect(client.status().pending).toBe(0)
    expect(client.list('customers')).toEqual([])
    expect(await screen.findByText(/Nichts zu entscheiden/)).toBeDefined()
  })

  /** A report the office issued while a device was still writing on it. */
  const issuedReport: Record<string, RecordState[]> = {
    documents: [
      {
        id: 'd-1',
        kind: 'time_and_material_report',
        status: 'issued',
        number: 'RB-2026-0001',
        customerId: 'c-1',
        jobId: 'j-1',
        subject: 'Zählerschrank',
        documentDate: '2026-09-21',
        version: 3,
        deletedAt: null,
      },
    ],
    document_lines: [
      {
        id: 'l-1',
        documentId: 'd-1',
        kind: 'item',
        position: 1,
        designation: 'Arbeitszeit',
        quantityMilli: 2000,
        unit: 'hour',
        unitPriceCents: 6500,
        vatRate: 'standard',
        netCents: 13000,
        version: 1,
        deletedAt: null,
      },
      {
        id: 'l-2',
        documentId: 'd-1',
        kind: 'item',
        position: 2,
        designation: 'Anfahrt',
        quantityMilli: 1000,
        unit: 'flat_rate',
        unitPriceCents: 3500,
        vatRate: 'standard',
        netCents: 3500,
        version: 1,
        deletedAt: null,
      },
    ],
  }

  function fixed(part: Partial<Omit<SyncConflict, 'id'>> & { readonly id?: string }): SyncConflict {
    return conflict({
      reason: 'record_is_fixed',
      // What the server names at an issued document: the field of the document
      // that stops the change, not one the device wrote.
      fields: ['status'],
      seen: {},
      found: {},
      ...part,
    } as Partial<SyncConflict>)
  }

  function created(entity: string) {
    return server.sent
      .flat()
      .filter((operation) => operation.kind === 'create' && operation.entity === entity)
      .map((operation) => ({
        id: operation.recordId,
        values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
      }))
  }

  /**
   * The report written on in a cellar after the office issued it (#139).
   * "Fassung vom Gerät übernehmen" would be refused a second time, and "Stand
   * im System behalten" throws the work away. The new lines become a
   * supplement, and only they: copying the issued lines along would bill them
   * twice.
   */
  it('turns lines added to an issued report into a supplement', async () => {
    server.open = [
      fixed({
        entity: 'document_lines',
        recordId: 'l-9',
        // In the order PostgreSQL hands back the keys of a jsonb column:
        // shortest first, then by bytes.
        wanted: {
          kind: 'item',
          unit: 'hour',
          vatRate: 'standard',
          position: 3,
          documentId: 'd-1',
          designation: 'Kabel nachgezogen',
          quantityMilli: 1500,
          unitPriceCents: 6500,
        },
      }),
    ]

    const client = await withClient(server, issuedReport)

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toBeNull()
    expect(screen.getByText(/Der Beleg ist inzwischen festgeschrieben/)).toBeDefined()

    // What the device wrote, as the document screen would show it. Not the
    // status of the document, which is the field the server names as the
    // obstacle and no row anybody could decide on.
    expect(within(screen.getByRole('row', { name: /Menge/ })).getByText('1,5')).toBeDefined()
    expect(
      within(screen.getByRole('row', { name: /Einzelpreis/ })).getByText(/65,00/),
    ).toBeDefined()
    expect(within(screen.getByRole('row', { name: /Einheit/ })).getByText('Stunden')).toBeDefined()
    expect(screen.queryByRole('row', { name: /Status/ })).toBeNull()
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Bezeichnung',
      'Menge',
      'Einheit',
      'Einzelpreis',
      'Steuersatz',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Als neuen Entwurf anlegen' }))

    expect(
      await screen.findByText(
        /Entwurf angelegt: Nachtrag zu Regiebericht RB-2026-0001: Zählerschrank\./,
      ),
    ).toBeDefined()

    await client.synchronise()

    const [head, ...others] = created('documents')

    expect(others).toEqual([])
    expect(head?.values).toMatchObject({
      kind: 'time_and_material_report',
      customerId: 'c-1',
      jobId: 'j-1',
      subject: 'Nachtrag zu Regiebericht RB-2026-0001: Zählerschrank',
    })
    // A new draft, and one the server sets about by itself: the link to the
    // issued report is in the subject, not in the chain (#129).
    expect(head?.values).not.toHaveProperty('predecessorDocumentId')
    expect(head?.values).not.toHaveProperty('status')
    expect(created('document_lines').map((line) => line.values)).toEqual([
      {
        documentId: head?.id,
        kind: 'item',
        position: 1,
        designation: 'Kabel nachgezogen',
        quantityMilli: 1500,
        unit: 'hour',
        unitPriceCents: 6500,
        vatRate: 'standard',
      },
    ])
    expect(server.resolved).toEqual(['k-1'])
  })

  /**
   * A change to what the issued document says, the head or a line it has, is
   * a different document and not a supplement. The draft is the whole of it
   * as the device wanted it, the line the device deleted left out, and every
   * conflict about the document goes into that one draft.
   */
  it('makes one draft of the whole document when the device changed it', async () => {
    server.open = [
      fixed({
        id: 'k-1',
        entity: 'documents',
        recordId: 'd-1',
        wanted: { introText: 'Wie am Telefon besprochen.' },
        seen: { introText: null },
        found: { introText: null },
      }),
      fixed({
        id: 'k-2',
        entity: 'document_lines',
        recordId: 'l-1',
        wanted: { quantityMilli: 3000 },
        seen: { quantityMilli: 2000 },
        found: { quantityMilli: 2000 },
      }),
      fixed({ id: 'k-3', entity: 'document_lines', recordId: 'l-2', wanted: {} }),
    ]

    const client = await withClient(server, issuedReport)

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    const offered = screen.getAllByRole('button', { name: 'Als neuen Entwurf anlegen' })

    expect(offered).toHaveLength(3)

    await userEvent.click(offered[1] as HTMLElement)

    expect(await screen.findByText(/Nichts zu entscheiden/)).toBeDefined()
    expect(
      screen.getByText(/Entwurf angelegt: Geänderte Fassung von Regiebericht RB-2026-0001/),
    ).toBeDefined()

    await client.synchronise()

    const [head, ...others] = created('documents')

    expect(others).toEqual([])
    expect(head?.values).toMatchObject({
      introText: 'Wie am Telefon besprochen.',
      subject: 'Geänderte Fassung von Regiebericht RB-2026-0001: Zählerschrank',
    })
    expect(created('document_lines').map((line) => line.values)).toEqual([
      {
        documentId: head?.id,
        kind: 'item',
        position: 1,
        designation: 'Arbeitszeit',
        quantityMilli: 3000,
        unit: 'hour',
        unitPriceCents: 6500,
        vatRate: 'standard',
      },
    ])
    expect([...server.resolved].sort()).toEqual(['k-1', 'k-2', 'k-3'])
  })

  it('says so plainly when there is nothing to decide', async () => {
    const client = await withClient(server)

    render(
      <SyncProvider client={client}>
        <ConflictScreen />
      </SyncProvider>,
    )

    expect(screen.getByText(/Nichts zu entscheiden/)).toBeDefined()
  })

  it('shows the office where the exchange stands, beside what is to decide (#219)', async () => {
    server.open = [conflict()]

    const client = await withClient(server, {
      jobs: [{ id: 'j-1', designation: 'Zähler prüfen', version: 2, deletedAt: null }],
    })

    render(
      <SyncProvider client={client}>
        <SyncScreen />
      </SyncProvider>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Abgleich' })).toBeDefined()

    const state = within(screen.getByRole('region', { name: 'Stand des Abgleichs' }))

    expect(state.getByText('Zuletzt abgeglichen')).toBeDefined()
    expect(state.getByText('1 Konflikt, bitte entscheiden')).toBeDefined()
    expect(screen.getByRole('region', { name: 'Zähler prüfen' })).toBeDefined()

    const pulls = server.pulls.length

    server.pulls.push({ changes: [], cursor: 2, hasMore: false })
    await userEvent.click(screen.getByRole('button', { name: 'Jetzt abgleichen' }))

    expect(server.pulls.length).toBe(pulls)
  })
})

describe('the bar above every screen', () => {
  it('interrupts for a conflict and only for a conflict', async () => {
    const server = new Quiet()

    server.open = [conflict()]

    const client = await withClient(server)

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    // `alert` is announced at once. Using it for the quiet states as well
    // would train people to ignore it, which is the opposite of the point.
    expect(screen.getByRole('alert').textContent).toContain('Ein Konflikt wartet')
  })

  it('stops for an entry the server refused, ahead of any conflict', async () => {
    const server = new Quiet()

    server.open = [conflict()]

    const client = await withClient(server)

    server.push = (_deviceId, operations) =>
      Promise.reject(
        new RequestRefused(400, 'Unbekanntes Feld: quatsch', {
          statusCode: 400,
          message: 'Unbekanntes Feld: quatsch',
          operationId: operations[0]?.id,
        }),
      )

    await client.create('customers', { name: 'Meyer', kind: 'private' })
    await client.synchronise()

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    // Ahead of the conflict, because deciding the conflict would not get out
    // either: a decision leaves through the same outbox.
    const bar = screen.getByRole('alert')

    expect(bar.textContent).toContain('Der Server nimmt eine Änderung nicht an')
    expect(bar.textContent).not.toContain('Konflikt')
  })

  it('shows no strip when the outbox is empty', async () => {
    // Everything arrived is not a thing to do. The office says it quietly in
    // the navigation under "Abgleich"; a bar over every screen said nothing
    // most of the time (#217).
    const client = await withClient(new Quiet())

    const { container } = render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(screen.queryByRole('status')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('counts what is still on the device when the server cannot be reached', async () => {
    const server = new Quiet()
    const client = await withClient(server)

    server.push = () => Promise.reject(new TypeError('Failed to fetch'))

    await client.create('customers', { name: 'Meyer', kind: 'private' })
    await client.synchronise()

    render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(screen.getByRole('status').textContent).toContain('1 Änderung auf dem Gerät')
  })

  it('says nothing about the connection while a change is on its way (#223)', async () => {
    const server = new Quiet()
    const client = await withClient(server)

    // A send that has not answered yet: the change waits, nothing went wrong.
    server.push = () => new Promise(() => {})

    await client.create('customers', { name: 'Meyer', kind: 'private' })
    void client.synchronise()

    const { container } = render(
      <SyncProvider client={client}>
        <SyncStatusBar />
      </SyncProvider>,
    )

    expect(client.status().pending).toBe(1)
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.textContent).toBe('')
  })
})

describe('the suggestion to switch entry', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('offers the site entry to something with only a finger', () => {
    // happy-dom answers no to every media query, which is the "browser says
    // neither" case, so the traits are forced here instead.
    globalThis.matchMedia = ((query: string) =>
      ({ matches: query === '(pointer: coarse)' }) as MediaQueryList) as typeof matchMedia

    render(<EntrySuggestion here="office" />)

    expect(screen.getByRole('link', { name: 'Zur Baustellenansicht' })).toBeDefined()
  })

  it('never asks again once somebody has said they want to stay', async () => {
    globalThis.matchMedia = ((query: string) =>
      ({ matches: query === '(pointer: coarse)' }) as MediaQueryList) as typeof matchMedia

    const { unmount } = render(<EntrySuggestion here="office" />)

    await userEvent.click(screen.getByRole('button', { name: 'Hier bleiben' }))

    expect(globalThis.localStorage.getItem(entryChoiceKey)).toBe('office')

    unmount()
    render(<EntrySuggestion here="office" />)

    expect(screen.queryByRole('link', { name: 'Zur Baustellenansicht' })).toBeNull()
  })
})
