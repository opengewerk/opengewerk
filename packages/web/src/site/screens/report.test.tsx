import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, RecordState } from '@opengewerk/domain'
import { signaturePathIsValid, signedContentFingerprint } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DirectWriter } from '../../sync/client.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import type { PullResult, SyncTransport } from '../../sync/transport.js'
import { SiteJobScreen } from './jobs.js'
import { SiteReportScreen } from './report.js'

/**
 * #73 as it happens on site: a report written in a cellar without a network,
 * signed there by the customer, and sent when the device next has one.
 *
 * The stand in for the server keeps what it is sent and hands it back on the
 * next pull, and it does the one thing the real one does on its own: a
 * signature that lands turns its document into a signed one. What it does not
 * do is check the fingerprint. That is the server's test; the one here is that
 * the fingerprint the device sends is the one the server will work out.
 */

type Row = Record<string, unknown>

class Server implements SyncTransport, DirectWriter {
  readonly sent: Operation[][] = []
  offline = false
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

  all(entity: string): Row[] {
    return [...(this.tables.get(entity)?.values() ?? [])]
  }

  private apply(operation: Operation): void {
    const id = operation.recordId
    const current = this.row(operation.entity, id) ?? {
      id,
      deletedAt: null,
      version: 0,
      // The column defaults the device never sends.
      ...(operation.entity === 'documents' ? { status: 'draft', number: null } : {}),
      ...(operation.entity === 'document_lines' ? { kind: 'item', description: null } : {}),
    }
    const values = Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to]))

    this.put(operation.entity, {
      ...current,
      ...values,
      version: Number(current['version'] ?? 0) + 1,
      deletedAt: operation.kind === 'delete' ? '2026-09-21T08:00:00.000Z' : current['deletedAt'],
    })

    // What the trigger on `document_signatures` does.
    if (operation.entity === 'document_signatures') {
      const documentId = String(values['documentId'])
      const document = this.row('documents', documentId) ?? {}

      this.put('documents', {
        ...document,
        status: 'signed',
        version: Number(document['version'] ?? 0) + 1,
      })
    }
  }

  push(_deviceId: string, operations: readonly Operation[]) {
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    this.sent.push([...operations])

    for (const operation of operations) {
      this.apply(operation)
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
    if (this.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    const changes = [...this.changed].map(([entity, ids]) => ({
      entity,
      rows: [...ids].map((id) => this.row(entity, id) as RecordState),
    }))

    this.changed = new Map()
    this.cursor += 1

    return Promise.resolve({ changes, cursor: this.cursor, hasMore: false })
  }

  conflicts() {
    return this.offline ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve([])
  }

  resolve() {
    return Promise.resolve()
  }

  patch() {
    return Promise.reject(new TypeError('Failed to fetch'))
  }

  remove() {
    return Promise.reject(new TypeError('Failed to fetch'))
  }

  /** Everything sent, in the order it was sent. */
  operations(): Operation[] {
    return this.sent.flat()
  }
}

let server: Server
let counter = 0

const customer = { id: 'c-1', kind: 'private', name: 'Familie Berg', version: 1, deletedAt: null }

const job = {
  id: 'j-1',
  customerId: 'c-1',
  siteId: null,
  installationId: null,
  parentJobId: null,
  kind: 'service',
  status: 'active',
  designation: 'Sicherungen fliegen raus',
  description: null,
  number: null,
  version: 1,
  deletedAt: null,
}

async function mount(path: string, rows: Readonly<Record<string, Row[]>> = {}) {
  server.put('customers', customer)
  server.put('jobs', job)

  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`bericht${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet-im-keller',
    entities: ['customers', 'jobs', 'documents', 'document_lines', 'document_signatures'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId',
        component: SiteJobScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/berichte/$documentId',
        component: SiteReportScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  // The job screen asks who is looking, for its tasks. Nobody answers here,
  // so it shows none, which is all these tests need of it.
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return { client, router }
}

/**
 * Two strokes on the pad. The pad is 500 by 200 pixels here, half the box it
 * draws in, so the points in the path are twice the pixel figures.
 */
function signOn(pad: Element): string {
  Object.assign(pad, {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 500,
      height: 200,
      right: 500,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setPointerCapture: () => {},
  })

  fireEvent.pointerDown(pad, { pointerId: 1, clientX: 50, clientY: 150 })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 120, clientY: 60 })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 200, clientY: 140 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 200, clientY: 140 })
  fireEvent.pointerDown(pad, { pointerId: 2, clientX: 260, clientY: 130 })
  fireEvent.pointerMove(pad, { pointerId: 2, clientX: 320, clientY: 90 })
  fireEvent.pointerUp(pad, { pointerId: 2, clientX: 320, clientY: 90 })

  return 'M100,300L240,120L400,280M520,260L640,180'
}

beforeEach(() => {
  server = new Server()
})

describe('a report on site', () => {
  it('is written and signed without a network, and sent as it was written', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1')

    server.offline = true

    await user.click(await screen.findByRole('button', { name: 'Regiebericht schreiben' }))
    await screen.findByText('Noch nicht übertragen.')

    const reportId = router.state.location.pathname.split('/').at(-1) ?? ''

    expect(router.state.location.pathname).toBe(`/auftraege/j-1/berichte/${reportId}`)

    await user.click(screen.getByRole('button', { name: 'Text schreiben' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Was gemacht wurde' }),
      'Zwei Leitungsschutzschalter im Keller getauscht.',
    )
    await user.click(screen.getByRole('button', { name: 'Text sichern' }))

    await user.click(screen.getByRole('button', { name: 'Arbeitszeit eintragen' }))
    await user.type(screen.getByLabelText('Stunden'), '2,5')
    await user.click(screen.getByRole('button', { name: 'Arbeitszeit sichern' }))

    await user.click(screen.getByRole('button', { name: 'Material eintragen' }))
    await user.type(screen.getByLabelText('Material'), 'LS-Schalter B16')
    await user.clear(screen.getByLabelText('Menge'))
    await user.type(screen.getByLabelText('Menge'), '2')
    await user.click(screen.getByRole('button', { name: 'Material sichern' }))

    expect(screen.getByText('2,5 Std.')).toBeTruthy()
    expect(screen.getByText('2 Stk.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Vom Kunden unterschreiben lassen' }))

    // Nothing on the page the customer reads can be changed from it.
    expect(screen.queryByRole('button', { name: 'Arbeitszeit eintragen' })).toBeNull()
    expect(screen.queryByRole('button', { name: /entfernen$/ })).toBeNull()

    await user.type(screen.getByLabelText('Name'), 'Erika Berg')
    const drawn = signOn(screen.getByRole('img', { name: 'Unterschriftsfeld' }))
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    // Signed on the device, before any server has heard of it.
    expect(await screen.findByRole('img', { name: 'Unterschrift von Erika Berg' })).toBeTruthy()
    expect(screen.getByText('Unterschrieben')).toBeTruthy()
    expect(screen.getByText(/Noch nicht übertragen\. Die Unterschrift geht/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Arbeitszeit eintragen' })).toBeNull()
    expect(server.operations()).toEqual([])

    // The network comes back.
    await client.synchronise()
    server.offline = false
    await client.synchronise()

    const sent = server.operations()

    expect(sent.map((operation) => `${operation.entity} ${operation.kind}`)).toEqual([
      'documents create',
      'documents update',
      'document_lines create',
      'document_lines create',
      'document_signatures create',
    ])

    const signature = Object.fromEntries(
      (sent.at(-1)?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )

    expect(signature).toMatchObject({
      documentId: reportId,
      signerName: 'Erika Berg',
      path: drawn,
      deviceInfo: globalThis.navigator.userAgent.slice(0, 500),
    })
    expect(signaturePathIsValid(String(signature['path']))).toBe(true)

    // What the server works out from what it now holds, as `signatureRefusal`
    // does: the device signed exactly that.
    const held = server.row('documents', reportId) ?? {}
    const onServer = signedContentFingerprint({
      introText: typeof held['introText'] === 'string' ? held['introText'] : null,
      lines: server
        .all('document_lines')
        .filter((line) => line['documentId'] === reportId)
        .map((line) => ({
          id: String(line['id']),
          position: Number(line['position']),
          kind: line['kind'] === 'title' ? ('title' as const) : ('item' as const),
          designation: String(line['designation']),
          description: typeof line['description'] === 'string' ? line['description'] : null,
          quantityMilli: Number(line['quantityMilli']),
          unit: line['unit'] === 'hour' ? ('hour' as const) : ('piece' as const),
        })),
    })

    expect(signature['contentFingerprint']).toBe(onServer)

    // A report carries no prices; they are written on the invoice made from it.
    for (const operation of sent.filter((entry) => entry.entity === 'document_lines')) {
      expect(operation.patches.find((patch) => patch.field === 'unitPriceCents')?.to).toBe(0)
    }

    await waitFor(() => {
      expect(screen.queryByText(/Noch nicht übertragen/)).toBeNull()
    })
    expect(server.row('documents', reportId)?.['status']).toBe('signed')
  })

  it('asks for a name and a signature before anything is signed', async () => {
    const user = userEvent.setup()

    await mount('/auftraege/j-1/berichte/d-1', {
      documents: [
        {
          id: 'd-1',
          customerId: 'c-1',
          jobId: 'j-1',
          kind: 'time_and_material_report',
          status: 'draft',
          number: null,
          documentDate: '2026-09-21',
          introText: 'Zählerschrank geprüft.',
          version: 1,
          deletedAt: null,
        },
      ],
    })

    await user.click(
      await screen.findByRole('button', { name: 'Vom Kunden unterschreiben lassen' }),
    )
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    expect(screen.getByText('Der Name dessen, der unterschreibt.')).toBeTruthy()

    await user.type(screen.getByLabelText('Name'), 'Erika Berg')
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    expect(screen.getByRole('alert').textContent).toBe('Bitte im Feld unterschreiben.')
    expect(server.operations()).toEqual([])
  })

  it('cannot be sent to be signed while it says nothing', async () => {
    await mount('/auftraege/j-1/berichte/d-1', {
      documents: [
        {
          id: 'd-1',
          customerId: 'c-1',
          jobId: 'j-1',
          kind: 'time_and_material_report',
          status: 'draft',
          number: null,
          documentDate: '2026-09-21',
          introText: null,
          version: 1,
          deletedAt: null,
        },
      ],
    })

    const sign = await screen.findByRole('button', { name: 'Vom Kunden unterschreiben lassen' })

    expect((sign as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Unterschrieben wird ein Bericht mit Text/)).toBeTruthy()
  })

  it('shows a report signed on another device with its signature and nothing to change', async () => {
    await mount('/auftraege/j-1/berichte/d-1', {
      documents: [
        {
          id: 'd-1',
          customerId: 'c-1',
          jobId: 'j-1',
          kind: 'time_and_material_report',
          status: 'signed',
          number: null,
          documentDate: '2026-09-21',
          introText: 'Zählerschrank geprüft.',
          version: 2,
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
          description: null,
          quantityMilli: 1500,
          unit: 'hour',
          unitPriceCents: 0,
          vatRate: 'standard',
          netCents: 0,
          version: 1,
          deletedAt: null,
        },
      ],
      document_signatures: [
        {
          id: 's-1',
          documentId: 'd-1',
          signerName: 'Erika Berg',
          signedAt: '2026-09-21T12:32:00.000Z',
          deviceInfo: 'Tablet im Transporter',
          path: 'M100,300L240,120',
          contentFingerprint: 'fnv1a32:00000000:0',
          version: 1,
          deletedAt: null,
        },
      ],
    })

    const picture = await screen.findByRole('img', { name: 'Unterschrift von Erika Berg' })

    expect(picture).toBeTruthy()
    expect(screen.getByText(/^Erika Berg, 21\.09\.2026, \d{2}:32 Uhr$/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('unterschrieben')
    expect(screen.getByText('1,5 Std.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Arbeitszeit eintragen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Vom Kunden unterschreiben lassen' })).toBeNull()
  })

  it('is listed under its job with its state', async () => {
    await mount('/auftraege/j-1', {
      documents: [
        {
          id: 'd-1',
          customerId: 'c-1',
          jobId: 'j-1',
          kind: 'time_and_material_report',
          status: 'signed',
          number: null,
          documentDate: '2026-09-21',
          version: 2,
          deletedAt: null,
        },
        {
          id: 'd-2',
          customerId: 'c-1',
          jobId: 'j-1',
          kind: 'quote',
          status: 'draft',
          number: null,
          documentDate: '2026-09-20',
          version: 1,
          deletedAt: null,
        },
      ],
    })

    const list = within(await screen.findByRole('list'))

    // The report and not the quote: the office's documents stay in the office.
    expect(list.getAllByRole('listitem')).toHaveLength(1)
    expect(list.getByText(/^Regiebericht vom/)).toBeTruthy()
    expect(list.getByText('Unterschrieben')).toBeTruthy()
  })
})
