import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, RecordState, RoleKey } from '@opengewerk/domain'
import { lineNetCents } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DirectWriter } from '../../sync/client.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import type { PullResult, SyncTransport } from '../../sync/transport.js'
import { DocumentScreen } from './documents.js'
import { JobScreen } from './jobs.js'
import { TextSnippetScreen } from './text-snippets.js'

/**
 * The office side of #72: a quote with titles and positions, the estimate as
 * a kind of its own, the refusal of an issued document that says why, the
 * order confirmation made out of a quote, and the texts it is written from.
 *
 * The stand in for the server takes what the outbox sends and hands it back
 * on the next pull, the way the real one does, so a line added on the screen
 * is on the screen afterwards and not only in a list of sent operations.
 */

type Row = Record<string, unknown>

class Server implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  private readonly tables = new Map<string, Map<string, Row>>()
  private changed = new Map<string, Set<string>>()
  private cursor = 1

  put(entity: string, row: Row): void {
    const table = this.tables.get(entity) ?? new Map<string, Row>()
    const id = String(row['id'])

    table.set(id, row)
    this.tables.set(entity, table)
    this.changed.set(entity, (this.changed.get(entity) ?? new Set()).add(id))
  }

  row(entity: string, id: string): Row | undefined {
    return this.tables.get(entity)?.get(id)
  }

  private apply(entity: string, id: string, values: Row, removed = false): void {
    const current = this.row(entity, id) ?? { id, deletedAt: null, version: 0 }
    const next: Row = {
      ...current,
      ...values,
      version: Number(current['version'] ?? 0) + 1,
      deletedAt: removed ? '2026-09-21T08:00:00.000Z' : (current['deletedAt'] ?? null),
    }

    if (entity === 'document_lines') {
      next['netCents'] = lineNetCents({
        quantityMilli: Number(next['quantityMilli'] ?? 0),
        unitPriceCents: Number(next['unitPriceCents'] ?? 0),
      })
    }

    this.put(entity, next)
  }

  push(_deviceId: string, operations: readonly Operation[]) {
    this.sent.push([...operations])

    for (const operation of operations) {
      this.apply(
        operation.entity,
        operation.recordId,
        Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
        operation.kind === 'delete',
      )
    }

    return Promise.resolve(
      operations.map((operation): OperationReceipt => ({
        operationId: operation.id,
        outcome: 'applied',
        reason: null,
        fields: [],
      })),
    )
  }

  pull(): Promise<PullResult> {
    const changes = [...this.changed].map(([entity, ids]) => ({
      entity,
      rows: [...ids].map((id) => this.row(entity, id) as RecordState),
    }))

    this.changed = new Map()
    this.cursor += 1

    return Promise.resolve({ changes, cursor: this.cursor, hasMore: false })
  }

  conflicts() {
    return Promise.resolve([])
  }

  resolve() {
    return Promise.resolve()
  }

  patch(entity: string, id: string, values: Readonly<Record<string, unknown>>) {
    this.apply(entity, id, { ...values })

    return Promise.resolve(undefined)
  }

  remove(entity: string, id: string) {
    this.apply(entity, id, {}, true)

    return Promise.resolve(undefined)
  }

  /** Everything the outbox sent for one kind of record, in order. */
  operationsOn(entity: string): Operation[] {
    return this.sent.flat().filter((operation) => operation.entity === entity)
  }
}

/** What an operation set, as one object. */
function valuesOf(operation: Operation | undefined): Row {
  return Object.fromEntries((operation?.patches ?? []).map((patch) => [patch.field, patch.to]))
}

type Answer = { status: number; body: unknown }

let server: Server
let calls: { method: string; path: string; body: unknown }[]
let answers: Map<string, (body: unknown) => Answer>
let counter = 0

function serverSays(method: string, path: string, answer: (body: unknown) => Answer): void {
  answers.set(`${method} ${path}`, answer)
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', () => ({
    status: 200,
    body: {
      user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Britta Büro' },
      session: { activeTenantId: 't-1' },
    },
  }))
  serverSays('GET', '/auth/tenants', () => ({
    status: 200,
    body: [{ id: 't-1', name: 'Elektro Nord GmbH', roles }],
  }))
}

const customer = { id: 'c-1', kind: 'private', name: 'Familie Berg', version: 1, deletedAt: null }

const job = {
  id: 'j-1',
  customerId: 'c-1',
  siteId: null,
  installationId: null,
  parentJobId: null,
  kind: 'project',
  status: 'active',
  designation: 'Zählerschrank Lindenweg',
  description: null,
  number: null,
  version: 1,
  deletedAt: null,
}

function document(over: Row = {}): Row {
  return {
    id: 'd-1',
    customerId: 'c-1',
    jobId: 'j-1',
    siteId: null,
    installationId: null,
    predecessorDocumentId: null,
    kind: 'quote',
    status: 'draft',
    number: null,
    documentDate: '2026-09-21',
    serviceFrom: null,
    serviceUntil: null,
    issuedAt: null,
    subject: 'Zählerschrank erneuern',
    introText: null,
    closingText: null,
    taxTreatment: 'standard',
    version: 1,
    deletedAt: null,
    ...over,
  }
}

function line(id: string, position: number, over: Row = {}): Row {
  const quantityMilli = Number(over['quantityMilli'] ?? 1000)
  const unitPriceCents = Number(over['unitPriceCents'] ?? 120000)

  return {
    id,
    documentId: 'd-1',
    kind: 'item',
    position,
    designation: 'Zählerschrank setzen',
    description: null,
    quantityMilli,
    unit: 'piece',
    unitPriceCents,
    vatRate: 'standard',
    netCents: lineNetCents({ quantityMilli, unitPriceCents }),
    version: 1,
    deletedAt: null,
    ...over,
  }
}

function title(id: string, position: number, designation: string): Row {
  return line(id, position, { kind: 'title', designation, quantityMilli: 0, unitPriceCents: 0 })
}

/** A quote under two titles, the example the issue itself uses. */
const outlined = [
  title('l-1', 1, 'Zählerschrank'),
  line('l-2', 2),
  line('l-3', 3, {
    designation: 'Überspannungsschutz',
    quantityMilli: 2000,
    unitPriceCents: 15000,
  }),
  title('l-4', 4, 'Außenbeleuchtung'),
  line('l-5', 5, {
    designation: 'Wandleuchte montieren',
    quantityMilli: 4000,
    unitPriceCents: 4500,
  }),
]

async function mount(
  path: string,
  rows: { documents?: Row[]; document_lines?: Row[]; document_signatures?: Row[] } = {},
  roles: RoleKey[] = ['office'],
) {
  signedInAs(...roles)
  server.put('customers', customer)
  server.put('jobs', job)

  for (const row of rows.documents ?? [document()]) {
    server.put('documents', row)
  }

  for (const row of rows.document_lines ?? []) {
    server.put('document_lines', row)
  }

  for (const row of rows.document_signatures ?? []) {
    server.put('document_signatures', row)
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`documents${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'device',
    entities: ['customers', 'jobs', 'documents', 'document_lines', 'document_signatures'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const tree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/belege/$documentId',
      component: DocumentScreen,
    }),
    createRoute({ getParentRoute: () => root, path: '/auftraege/$jobId', component: JobScreen }),
    createRoute({
      getParentRoute: () => root,
      path: '/textbausteine',
      component: TextSnippetScreen,
    }),
    createRoute({ getParentRoute: () => root, path: '/auftraege', component: () => null }),
    createRoute({ getParentRoute: () => root, path: '/kunden/$customerId', component: () => null }),
  ])
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return { client, router }
}

beforeEach(() => {
  server = new Server()
  calls = []
  answers = new Map()

  serverSays('GET', '/documents/text-snippets', () => ({
    status: 200,
    body: [
      { id: 's-1', purpose: 'intro', title: 'Anfrage', text: 'Vielen Dank für Ihre Anfrage.' },
      {
        id: 's-2',
        purpose: 'line',
        title: 'Zählerschrank setzen',
        text: 'Zählerschrank nach VDE-AR-N 4100 liefern und setzen.',
      },
    ],
  }))

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body

    calls.push({ method, path, body })

    const answer = answers.get(`${method} ${path}`)?.(body) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a quote with titles', () => {
  it('is laid out under its titles, numbered and summed, with the totals of its date', async () => {
    await mount('/belege/d-1', { document_lines: outlined })

    const table = within(await screen.findByRole('table', { name: 'Positionen des Belegs' }))

    for (const number of ['1', '1.1', '1.2', '2', '2.1']) {
      expect(table.getByRole('cell', { name: number })).toBeDefined()
    }

    expect(table.getByText('Summe Titel 1: Zählerschrank')).toBeDefined()
    expect(table.getByText('Summe Titel 2: Außenbeleuchtung')).toBeDefined()
    expect(screen.getByText(/Umsatzsteuer 19 % auf 1\.680,00\s€/)).toBeDefined()
    expect(screen.getByText(/1\.999,20\s€/)).toBeDefined()
  })

  it('gets a title through the outbox, without an amount, at the end of the list', async () => {
    await mount('/belege/d-1', { document_lines: [line('l-1', 1)] })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Titel hinzufügen' }))
    await person.type(screen.getByLabelText('Titel'), 'Außenbeleuchtung')
    await person.click(screen.getByRole('button', { name: 'Titel hinzufügen' }))

    await waitFor(() => {
      expect(server.operationsOn('document_lines')).toHaveLength(1)
    })

    expect(valuesOf(server.operationsOn('document_lines')[0])).toMatchObject({
      documentId: 'd-1',
      kind: 'title',
      designation: 'Außenbeleuchtung',
      position: 2,
      quantityMilli: 0,
      unitPriceCents: 0,
    })
    expect(await screen.findByRole('cell', { name: '1' })).toBeDefined()
  })

  it('reads a quantity and a price the way they are typed here', async () => {
    await mount('/belege/d-1', { document_lines: [] })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Position hinzufügen' }))
    await person.type(screen.getByLabelText('Bezeichnung'), 'Fehlersuche')
    await person.clear(screen.getByLabelText('Menge'))
    await person.type(screen.getByLabelText('Menge'), '2,5')
    await person.selectOptions(screen.getByLabelText('Einheit'), 'hour')
    await person.type(screen.getByLabelText('Einzelpreis in Euro'), '1.234,56')
    await person.click(screen.getByRole('button', { name: 'Position hinzufügen' }))

    await waitFor(() => {
      expect(server.operationsOn('document_lines')).toHaveLength(1)
    })

    expect(valuesOf(server.operationsOn('document_lines')[0])).toMatchObject({
      kind: 'item',
      quantityMilli: 2500,
      unit: 'hour',
      unitPriceCents: 123456,
    })
    expect(await screen.findAllByText(/3\.086,40\s€/)).not.toHaveLength(0)
  })

  it('refuses a price it cannot read, and says what it expects', async () => {
    await mount('/belege/d-1', { document_lines: [] })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Position hinzufügen' }))
    await person.type(screen.getByLabelText('Bezeichnung'), 'Fehlersuche')
    await person.type(screen.getByLabelText('Einzelpreis in Euro'), 'zwölf Euro')
    await person.click(screen.getByRole('button', { name: 'Position hinzufügen' }))

    expect(screen.getByText(/höchstens zwei Nachkommastellen/)).toBeDefined()
    expect(server.operationsOn('document_lines')).toHaveLength(0)
  })

  it('takes a position from a text snippet', async () => {
    await mount('/belege/d-1', { document_lines: [] })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Position hinzufügen' }))
    await person.selectOptions(await screen.findByLabelText('Position aus Textbaustein'), 's-2')

    expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
      'Zählerschrank setzen',
    )
    expect((screen.getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toContain(
      'VDE-AR-N 4100',
    )
  })

  it('moves a line by numbering the whole list afresh, gaps included', async () => {
    await mount('/belege/d-1', {
      document_lines: [
        line('l-1', 1, { designation: 'Erste' }),
        line('l-2', 2, { designation: 'Zweite' }),
        line('l-3', 5, { designation: 'Dritte' }),
      ],
    })

    await userEvent.setup().click(await screen.findByRole('button', { name: '3 nach oben' }))

    await waitFor(() => {
      expect(server.operationsOn('document_lines')).toHaveLength(2)
    })

    const moved = new Map(
      server
        .operationsOn('document_lines')
        .map((operation) => [operation.recordId, valuesOf(operation)['position']]),
    )

    expect(moved).toEqual(
      new Map([
        ['l-3', 2],
        ['l-2', 3],
      ]),
    )
  })

  it('takes the text above the lines from a snippet and sends it with the head', async () => {
    await mount('/belege/d-1')
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await person.selectOptions(await screen.findByLabelText('Textbaustein für oben'), 's-1')

    expect((screen.getByLabelText('Text über den Positionen') as HTMLTextAreaElement).value).toBe(
      'Vielen Dank für Ihre Anfrage.',
    )

    await person.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(valuesOf(server.operationsOn('documents')[0])).toMatchObject({
        introText: 'Vielen Dank für Ihre Anfrage.',
      })
    })
  })
})

describe('issuing', () => {
  it('is offered to the office and not to a technician', async () => {
    await mount('/belege/d-1', { document_lines: [line('l-1', 1)] }, ['technician'])

    await screen.findByRole('heading', { level: 1, name: 'Angebot' })

    expect(screen.queryByRole('button', { name: 'Festschreiben' })).toBeNull()
  })

  it('lists the mandatory details that are missing, each with its paragraph', async () => {
    serverSays('POST', '/documents/d-9/issue', () => ({
      status: 422,
      body: {
        message: 'Der Beleg kann noch nicht festgeschrieben werden, es fehlen Pflichtangaben.',
        missing: [
          {
            detail: 'issuer_address',
            message: 'Die Anschrift des Betriebs fehlt (§ 14 Abs. 4 Nr. 1 UStG).',
          },
          {
            detail: 'service_date',
            message: 'Der Leistungszeitraum fehlt (§ 14 Abs. 4 Nr. 6 UStG).',
          },
        ],
      },
    }))

    await mount('/belege/d-9', {
      documents: [document({ id: 'd-9', kind: 'final_invoice' })],
      document_lines: [line('l-1', 1, { documentId: 'd-9' })],
    })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Festschreiben' }))
    await person.click(screen.getByRole('button', { name: 'Jetzt festschreiben' }))

    expect(
      await screen.findByText('Die Anschrift des Betriebs fehlt (§ 14 Abs. 4 Nr. 1 UStG).'),
    ).toBeDefined()
    expect(screen.getByText('Der Leistungszeitraum fehlt (§ 14 Abs. 4 Nr. 6 UStG).')).toBeDefined()
  })

  it('fixes the document on the server and shows it fixed', async () => {
    serverSays('POST', '/documents/d-1/issue', () => {
      const issued = { ...server.row('documents', 'd-1'), status: 'issued', number: 'AN-2026-0001' }

      server.put('documents', issued)

      return { status: 201, body: issued }
    })

    await mount('/belege/d-1', { document_lines: [line('l-1', 1)] })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Festschreiben' }))
    await person.click(screen.getByRole('button', { name: 'Jetzt festschreiben' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Angebot AN-2026-0001' }),
    ).toBeDefined()
    expect(screen.getByText(/liegt er beim Kunden/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Position hinzufügen' })).toBeNull()
  })
})

describe('an issued quote', () => {
  const issued = document({ status: 'issued', number: 'AN-2026-0001' })

  it('says why it can no longer be changed, and offers nothing that would', async () => {
    await mount('/belege/d-1', { documents: [issued], document_lines: outlined })

    expect(
      await screen.findByText(/Soll sich etwas ändern, entsteht dafür ein neuer Beleg/),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Position hinzufügen' })).toBeNull()
    expect(screen.queryByRole('button', { name: '1.1 entfernen' })).toBeNull()
  })

  it('becomes an order confirmation that knows where it came from', async () => {
    serverSays('POST', '/documents/d-1/successors', (body) => {
      const made = document({
        id: 'd-2',
        kind: (body as { kind: string }).kind,
        predecessorDocumentId: 'd-1',
      })

      server.put('documents', made)

      return { status: 201, body: made }
    })

    await mount('/belege/d-1', { documents: [issued], document_lines: outlined })

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Auftragsbestätigung erstellen' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Auftragsbestätigung' }),
    ).toBeDefined()
    expect(calls.find((call) => call.path === '/documents/d-1/successors')?.body).toEqual({
      kind: 'order_confirmation',
    })

    const chain = within(screen.getByRole('region', { name: 'Belegkette' }))

    expect(chain.getByRole('link', { name: 'Angebot' })).toBeDefined()
  })
})

/**
 * The office's side of #73. The report arrives signed from site, and what is
 * left to do with it here is to read it and to issue it.
 */
describe('a report signed on site', () => {
  const report = document({
    kind: 'time_and_material_report',
    status: 'signed',
    subject: 'Sicherungen fliegen raus',
    introText: 'Zwei Leitungsschutzschalter getauscht.',
  })
  const hours = line('l-1', 1, {
    designation: 'Arbeitszeit',
    quantityMilli: 2500,
    unit: 'hour',
    unitPriceCents: 0,
  })
  const signature = {
    id: 's-1',
    documentId: 'd-1',
    signerName: 'Erika Berg',
    signedAt: '2026-09-21T12:32:00.000Z',
    deviceInfo: 'Tablet im Transporter',
    path: 'M100,300L240,120',
    contentFingerprint: 'fnv1a32:00000000:0',
    version: 1,
    deletedAt: null,
  }
  const signed = { documents: [report], document_lines: [hours], document_signatures: [signature] }

  it('shows the signature it carries and no prices, like its printed page', async () => {
    await mount('/belege/d-1', signed)

    expect(await screen.findByRole('img', { name: 'Unterschrift von Erika Berg' })).toBeDefined()
    expect(
      within(screen.getByRole('region', { name: 'Unterschrift' })).getByText(
        'Tablet im Transporter',
      ),
    ).toBeDefined()
    expect(screen.getByText(/unterschrieben und wird nicht mehr geändert/)).toBeDefined()

    const table = within(screen.getByRole('table', { name: 'Positionen des Belegs' }))

    expect(table.getByText(/2,5\s*Std\./)).toBeDefined()
    expect(table.queryByRole('columnheader', { name: 'Einzelpreis' })).toBeNull()
    expect(screen.queryByText('Gesamtbetrag')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Position hinzufügen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })

  it('is issued by the office, the one step left for it', async () => {
    serverSays('POST', '/documents/d-1/issue', () => {
      const issued = { ...server.row('documents', 'd-1'), status: 'issued', number: 'RB-2026-0001' }

      server.put('documents', issued)

      return { status: 201, body: issued }
    })

    await mount('/belege/d-1', signed)
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Festschreiben' }))
    await person.click(screen.getByRole('button', { name: 'Jetzt festschreiben' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Regiebericht RB-2026-0001' }),
    ).toBeDefined()
    expect(screen.getByRole('img', { name: 'Unterschrift von Erika Berg' })).toBeDefined()
  })
})

/**
 * The office's side of #74: the invoices the chain now leads to, what a
 * cumulative invoice takes off, and the time of the work an invoice has to
 * state.
 */
describe('invoices in the chain', () => {
  it('are offered on an issued order confirmation, the progress and the final one', async () => {
    serverSays('POST', '/documents/d-1/successors', (body) => {
      const made = document({
        id: 'd-2',
        kind: (body as { kind: string }).kind,
        predecessorDocumentId: 'd-1',
      })

      server.put('documents', made)

      return { status: 201, body: made }
    })

    await mount('/belege/d-1', {
      documents: [
        document({ kind: 'order_confirmation', status: 'issued', number: 'AB-2026-0001' }),
      ],
      document_lines: [line('l-1', 1)],
    })

    expect(await screen.findByRole('button', { name: 'Abschlagsrechnung erstellen' })).toBeDefined()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Schlussrechnung erstellen' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Schlussrechnung' })).toBeDefined()
    expect(calls.find((call) => call.path === '/documents/d-1/successors')?.body).toEqual({
      kind: 'final_invoice',
    })
  })

  it('offer only the final invoice on an issued report, which records work that is done', async () => {
    await mount('/belege/d-1', {
      documents: [
        document({ kind: 'time_and_material_report', status: 'issued', number: 'RB-2026-0001' }),
      ],
      document_lines: [line('l-1', 1, { unitPriceCents: 0 })],
    })

    expect(await screen.findByRole('button', { name: 'Schlussrechnung erstellen' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Abschlagsrechnung erstellen' })).toBeNull()
  })

  it('show what a final invoice takes off and what it asks for, as the paper does', async () => {
    serverSays('GET', '/documents/d-1/deductions', () => ({
      status: 200,
      body: [
        {
          number: 'RE-2026-0001',
          documentDate: '2026-09-01',
          taxTreatment: 'standard',
          billed: {
            netCents: 48_000,
            taxCents: 9_120,
            grossCents: 57_120,
            byRate: [
              {
                rate: 'standard',
                basisPoints: 1900,
                netCents: 48_000,
                taxCents: 9_120,
                grossCents: 57_120,
              },
            ],
          },
        },
      ],
    }))

    await mount('/belege/d-1', {
      documents: [document({ kind: 'final_invoice', predecessorDocumentId: 'd-0' })],
      document_lines: [line('l-1', 1, { quantityMilli: 1000, unitPriceCents: 120_000 })],
    })

    expect(await screen.findByText('Gesamtleistung')).toBeDefined()
    expect(
      screen.getByText(/abzüglich Abschlagsrechnung RE-2026-0001 vom 01\.09\.2026/),
    ).toBeDefined()
    expect(screen.getByText(/netto 480,00\s€, Umsatzsteuer 91,20\s€/)).toBeDefined()
    expect(screen.getByText('Rechnungsbetrag netto').nextElementSibling?.textContent).toMatch(
      /720,00\s€/,
    )
    expect(screen.getByText('Rechnungsbetrag').nextElementSibling?.textContent).toMatch(/856,80\s€/)
  })

  it('take the time of the work in the head, and show it', async () => {
    await mount('/belege/d-1', {
      documents: [document({ kind: 'final_invoice' })],
      document_lines: [line('l-1', 1)],
    })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await person.type(screen.getByLabelText('Leistung von'), '2026-09-01')
    await person.type(screen.getByLabelText('Leistung bis'), '2026-09-15')
    await person.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.operationsOn('documents')).toHaveLength(1)
    })

    expect(valuesOf(server.operationsOn('documents')[0])).toMatchObject({
      serviceFrom: '2026-09-01',
      serviceUntil: '2026-09-15',
    })
    expect(await screen.findByText('01.09.2026 bis 15.09.2026')).toBeDefined()
  })

  it('leave the time of the work off a quote, which states none', async () => {
    await mount('/belege/d-1', { document_lines: [line('l-1', 1)] })

    await screen.findByRole('heading', { level: 1, name: 'Angebot' })

    expect(screen.queryByText('Leistungszeitraum')).toBeNull()
  })
})

/**
 * The cancellation of #74, from the office. An issued invoice is taken back
 * by one of its own with every figure turned round, both stay, and the screen
 * shows each of them for what it is.
 */
describe('cancelling an invoice', () => {
  const invoice = document({
    kind: 'final_invoice',
    status: 'issued',
    number: 'RE-2026-0001',
    documentDate: '2026-09-18',
  })

  /** The cancellation the server writes for `d-1`, with its lines turned round. */
  function stornoOf(original: Row, over: Row = {}): { head: Row; lines: Row[] } {
    return {
      head: document({
        id: 'd-2',
        kind: 'cancellation_invoice',
        status: 'issued',
        number: 'RE-2026-0002',
        predecessorDocumentId: String(original['id']),
        ...over,
      }),
      lines: [line('l-9', 1, { documentId: 'd-2', quantityMilli: -1000 })],
    }
  }

  it('is offered to the office on an issued invoice, and not to a technician', async () => {
    await mount('/belege/d-1', { documents: [invoice], document_lines: [line('l-1', 1)] }, [
      'technician',
    ])

    await screen.findByRole('heading', { level: 1, name: 'Schlussrechnung RE-2026-0001' })

    expect(screen.queryByRole('button', { name: 'Stornieren' })).toBeNull()
  })

  it('writes the cancellation on the server and moves on to it', async () => {
    serverSays('POST', '/documents/d-1/cancellation', () => {
      const { head, lines } = stornoOf(invoice)

      server.put('documents', head)
      server.put('documents', { ...server.row('documents', 'd-1'), status: 'cancelled' })

      for (const row of lines) {
        server.put('document_lines', row)
      }

      return { status: 201, body: head }
    })

    await mount('/belege/d-1', { documents: [invoice], document_lines: [line('l-1', 1)] })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Stornieren' }))

    expect(
      screen.getByText(/wiederholt jeden ihrer Beträge mit umgekehrtem Vorzeichen/),
    ).toBeDefined()

    await person.click(screen.getByRole('button', { name: 'Jetzt stornieren' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Stornorechnung RE-2026-0002' }),
    ).toBeDefined()
    expect(calls.filter((call) => call.path === '/documents/d-1/cancellation')).toHaveLength(1)
    expect(screen.getByText(/Die Stornorechnung ist festgeschrieben/)).toBeDefined()
    // 1.200,00 € and 19 % on it, taken back.
    expect(screen.getByText('Gesamtbetrag').nextElementSibling?.textContent).toMatch(
      /-1\.428,00\s€/,
    )
    expect(screen.queryByRole('button', { name: 'Stornieren' })).toBeNull()

    const chain = within(screen.getByRole('region', { name: 'Belegkette' }))

    expect(chain.getByText('Storno zu')).toBeDefined()
    expect(chain.getByRole('link', { name: 'Schlussrechnung' })).toBeDefined()
  })

  it('says why it refuses, and stays on the invoice', async () => {
    serverSays('POST', '/documents/d-1/cancellation', () => ({
      status: 409,
      body: {
        message:
          'Auf diese Rechnung baut die Schlussrechnung RE-2026-0003 auf. Erst jene stornieren, ' +
          'dann diese.',
      },
    }))

    await mount('/belege/d-1', { documents: [invoice], document_lines: [line('l-1', 1)] })
    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Stornieren' }))
    await person.click(screen.getByRole('button', { name: 'Jetzt stornieren' }))

    expect(await screen.findByText(/Erst jene stornieren, dann diese/)).toBeDefined()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Schlussrechnung RE-2026-0001' }),
    ).toBeDefined()
  })

  it('leaves the invoice in the books as cancelled, with nothing more to do on it', async () => {
    const { head, lines } = stornoOf(invoice)

    await mount('/belege/d-1', {
      documents: [{ ...invoice, status: 'cancelled' }, head],
      document_lines: [line('l-1', 1), ...lines],
    })

    const card = within(await screen.findByRole('region', { name: 'Storniert' }))

    expect(card.getByText(/Der Beleg ist storniert/)).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Festgeschrieben' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stornieren' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()

    const chain = within(screen.getByRole('region', { name: 'Belegkette' }))

    expect(chain.getByRole('link', { name: 'Stornorechnung' })).toBeDefined()
  })

  it('gives back what a progress invoice took off, and names the work as the invoice did', async () => {
    const progress = { ...invoice, kind: 'progress_invoice', status: 'cancelled' }
    const { head, lines } = stornoOf(progress)
    const earlier = {
      netCents: -48_000,
      taxCents: -9_120,
      grossCents: -57_120,
      byRate: [
        {
          rate: 'standard',
          basisPoints: 1900,
          netCents: -48_000,
          taxCents: -9_120,
          grossCents: -57_120,
        },
      ],
    }

    serverSays('GET', '/documents/d-2/deductions', () => ({
      status: 200,
      body: [
        {
          number: 'RE-2026-0000',
          documentDate: '2026-09-01',
          taxTreatment: 'standard',
          billed: earlier,
        },
      ],
    }))

    await mount('/belege/d-2', { documents: [progress, head], document_lines: lines })

    expect(await screen.findByText('Leistungsstand gesamt')).toBeDefined()
    expect(
      screen.getByText(
        /zurückgenommener Abzug der Abschlagsrechnung RE-2026-0000 vom 01\.09\.2026/,
      ),
    ).toBeDefined()
    expect(screen.queryByText(/abzüglich Abschlagsrechnung/)).toBeNull()
    // -1.428,00 € for the work, 571,20 € given back: what the progress
    // invoice asked for, turned round.
    expect(screen.getByText('Rechnungsbetrag').nextElementSibling?.textContent).toMatch(
      /-856,80\s€/,
    )
  })

  it('counts the tax at the rates of the invoice it takes back, not of its own date', async () => {
    const old = { ...invoice, status: 'cancelled', documentDate: '2020-09-01' }
    const { head, lines } = stornoOf(old)

    await mount('/belege/d-2', { documents: [old, head], document_lines: lines })

    // Sixteen percent in the second half of 2020, as the invoice stated it.
    expect(await screen.findByText(/Umsatzsteuer 16\s%/)).toBeDefined()
    expect(screen.getByText('Gesamtbetrag').nextElementSibling?.textContent).toMatch(
      /-1\.392,00\s€/,
    )
  })
})

describe('the e-invoice', () => {
  const toBusiness = {
    format: 'e_invoice',
    reason:
      'Der Kunde ist ein Unternehmen im Inland, die Rechnung geht deshalb als E-Rechnung ' +
      '(§ 14 Abs. 2 Satz 2 Nr. 1 UStG).',
    duty: {
      required: false,
      reason:
        'Noch keine Pflicht: eine Rechnung, die bis zum 31.12.2026 übermittelt wird, darf für ' +
        'diese Leistung auch als PDF gehen, wenn der Kunde zustimmt (§ 27 Abs. 38 Satz 1 Nr. 1 UStG).',
    },
  }

  it('is announced on the draft, with what the XRechnung still lacks', async () => {
    serverSays('GET', '/documents/d-1/e-invoice', () => ({
      status: 200,
      body: {
        ...toBusiness,
        issued: false,
        xrechnung: {
          missing: [
            {
              detail: 'buyer_reference',
              message:
                'Für die XRechnung fehlt die Käuferreferenz des Kunden, bei einer Behörde ihre ' +
                'Leitweg-ID (XRechnung, BR-DE-15).',
            },
          ],
        },
        zugferd: { missing: [] },
      },
    }))

    await mount('/belege/d-1', {
      documents: [document({ kind: 'final_invoice' })],
      document_lines: [line('l-1', 1)],
    })

    const card = within(await screen.findByRole('region', { name: 'E-Rechnung' }))

    expect(card.getByText(/geht deshalb als E-Rechnung/)).toBeDefined()
    expect(card.getByText(/Noch keine Pflicht/)).toBeDefined()
    expect(card.getByText('Für die XRechnung fehlt noch:')).toBeDefined()
    expect(card.getByText(/Käuferreferenz des Kunden/)).toBeDefined()
    expect(card.getByText(/sobald die Rechnung festgeschrieben ist/)).toBeDefined()
    expect(card.queryByRole('link', { name: 'XRechnung herunterladen' })).toBeNull()
    expect(card.queryByRole('link', { name: 'ZUGFeRD-PDF herunterladen' })).toBeNull()
  })

  it('offers both forms once the invoice is issued and lacks nothing', async () => {
    serverSays('GET', '/documents/d-1/e-invoice', () => ({
      status: 200,
      body: { ...toBusiness, issued: true, xrechnung: { missing: [] }, zugferd: { missing: [] } },
    }))

    await mount('/belege/d-1', {
      documents: [document({ kind: 'final_invoice', status: 'issued', number: 'RE-2026-0001' })],
      document_lines: [line('l-1', 1)],
    })

    const zugferd = await screen.findByRole('link', { name: 'ZUGFeRD-PDF herunterladen' })
    const xrechnung = screen.getByRole('link', { name: 'XRechnung herunterladen' })

    expect(zugferd.getAttribute('href')).toBe('/documents/d-1/zugferd')
    expect(zugferd.hasAttribute('download')).toBe(true)
    expect(xrechnung.getAttribute('href')).toBe('/documents/d-1/xrechnung')
    expect(xrechnung.hasAttribute('download')).toBe(true)
  })

  it('offers the ZUGFeRD PDF when only the XRechnung lacks something', async () => {
    serverSays('GET', '/documents/d-1/e-invoice', () => ({
      status: 200,
      body: {
        ...toBusiness,
        issued: true,
        xrechnung: { missing: [{ detail: 'buyer_reference', message: 'Käuferreferenz fehlt.' }] },
        zugferd: { missing: [] },
      },
    }))

    await mount('/belege/d-1', {
      documents: [document({ kind: 'final_invoice', status: 'issued', number: 'RE-2026-0001' })],
      document_lines: [line('l-1', 1)],
    })

    const card = within(await screen.findByRole('region', { name: 'E-Rechnung' }))

    expect(await card.findByRole('link', { name: 'ZUGFeRD-PDF herunterladen' })).toBeDefined()
    expect(card.getByText('Für die XRechnung fehlt noch:')).toBeDefined()
    expect(card.queryByRole('link', { name: 'XRechnung herunterladen' })).toBeNull()
  })

  it('offers neither form when the standard itself lacks something', async () => {
    const identifier = {
      detail: 'issuer_identifier',
      message: 'Für die E-Rechnung fehlt die Umsatzsteuer-Identifikationsnummer (BR-CO-26).',
    }

    serverSays('GET', '/documents/d-1/e-invoice', () => ({
      status: 200,
      body: {
        ...toBusiness,
        issued: true,
        xrechnung: {
          missing: [identifier, { detail: 'recipient_email', message: 'E-Mail fehlt.' }],
        },
        zugferd: { missing: [identifier] },
      },
    }))

    await mount('/belege/d-1', {
      documents: [document({ kind: 'final_invoice', status: 'issued', number: 'RE-2026-0001' })],
      document_lines: [line('l-1', 1)],
    })

    const card = within(await screen.findByRole('region', { name: 'E-Rechnung' }))

    expect(await card.findByText('Für die E-Rechnung fehlt noch:')).toBeDefined()
    // Each gap is named once, under the form it stops first.
    expect(card.getAllByText(/Umsatzsteuer-Identifikationsnummer/)).toHaveLength(1)
    expect(card.getByText('Für die XRechnung außerdem:')).toBeDefined()
    expect(card.getByText('E-Mail fehlt.')).toBeDefined()
    expect(card.queryByRole('link')).toBeNull()
  })

  it('says why an invoice goes out as a PDF, without anybody choosing it', async () => {
    serverSays('GET', '/documents/d-1/e-invoice', () => ({
      status: 200,
      body: {
        format: 'pdf',
        reason:
          'Der Kunde ist kein Unternehmen. Die E-Rechnung ist nur zwischen Unternehmen ' +
          'vorgeschrieben (§ 14 Abs. 2 Satz 2 Nr. 1 UStG).',
        duty: null,
        issued: false,
        xrechnung: { missing: [] },
        zugferd: { missing: [] },
      },
    }))

    await mount('/belege/d-1', {
      documents: [document({ kind: 'final_invoice' })],
      document_lines: [line('l-1', 1)],
    })

    const card = within(await screen.findByRole('region', { name: 'Versand als PDF' }))

    expect(card.getByText(/Der Kunde ist kein Unternehmen/)).toBeDefined()
    expect(screen.queryByRole('region', { name: 'E-Rechnung' })).toBeNull()
  })

  it('is not asked about for a quote, which is no invoice', async () => {
    await mount('/belege/d-1', { document_lines: [line('l-1', 1)] })

    expect(await screen.findByRole('heading', { level: 1, name: 'Angebot' })).toBeDefined()
    expect(calls.some((call) => call.path === '/documents/d-1/e-invoice')).toBe(false)
  })
})

describe('the job', () => {
  it('starts a quote and an estimate from two buttons, not from one with a choice', async () => {
    serverSays('POST', '/documents', (body) => {
      const made = document({ ...(body as Row), id: 'd-7' })

      server.put('documents', made)

      return { status: 201, body: made }
    })

    await mount('/auftraege/j-1', { documents: [] })

    expect(await screen.findByRole('button', { name: 'Angebot anlegen' })).toBeDefined()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Kostenvoranschlag anlegen' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kostenvoranschlag' }),
    ).toBeDefined()
    expect(screen.getByText(/§ 649 BGB/)).toBeDefined()
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      customerId: 'c-1',
      jobId: 'j-1',
      kind: 'cost_estimate',
      subject: 'Zählerschrank Lindenweg',
    })
  })
})

describe('the text snippets', () => {
  it('are listed by what they are for, and a new one is sent as typed', async () => {
    serverSays('POST', '/documents/text-snippets', (body) => ({
      status: 201,
      body: { id: 's-3', ...(body as Row) },
    }))

    await mount('/textbausteine')
    const person = userEvent.setup()

    const intro = within(await screen.findByRole('region', { name: 'Texte über den Positionen' }))
    expect(await intro.findByText('Anfrage')).toBeDefined()

    await person.click(screen.getByRole('button', { name: 'Textbaustein anlegen' }))
    await person.selectOptions(screen.getByLabelText('Wofür'), 'closing')
    await person.type(screen.getByLabelText('Name'), 'Gruß')
    await person.type(screen.getByLabelText('Text'), 'Mit freundlichen Grüßen')
    await person.click(screen.getByRole('button', { name: 'Textbaustein anlegen' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        purpose: 'closing',
        title: 'Gruß',
        text: 'Mit freundlichen Grüßen',
      })
    })
  })
})
