import 'fake-indexeddb/auto'

import {
  readFormValues,
  type RecordState,
  reportDefinition,
  type ReportField,
  signedContentFingerprint,
} from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { SiteJobScreen } from './jobs.js'
import { SiteReportScreen } from './report.js'

/**
 * The fields a business gives its reports (#78) on site: filled in without a
 * network, read by the customer before signing, and part of what the
 * signature is about.
 */

let server: TestServer
let counter = 0

const weather: ReportField = {
  kind: 'choice',
  key: 'field_1',
  label: 'Wetter',
  options: [
    { value: 'trocken', label: 'trocken' },
    { value: 'Regen', label: 'Regen' },
  ],
}

const distance: ReportField = {
  kind: 'number',
  key: 'field_2',
  label: 'Anfahrt',
  unit: 'kilometre',
  decimals: 0,
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: null,
      installationId: null,
      kind: 'service',
      status: 'active',
      designation: 'Sicherungen fliegen raus',
      number: 'AU-2026-0003',
    },
  ],
  form_definitions: [
    {
      id: 'fd-1',
      key: 'report',
      definitionVersion: 1,
      definition: JSON.stringify(reportDefinition(1, [weather, distance])),
    },
  ],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`site-report-fields${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet-im-keller',
    entities: [
      'customers',
      'jobs',
      'documents',
      'document_lines',
      'document_signatures',
      'form_definitions',
    ],
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

/** Two strokes on the pad, as in the report tests. */
function signOn(pad: Element): void {
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
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 120, clientY: 60 })
}

beforeEach(() => {
  server = new TestServer()
})

describe('the fields of a report on site (#78)', () => {
  it('are filled in without a network, read before signing and signed with the report', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1')

    server.offline = true

    await user.click(await screen.findByRole('button', { name: 'Regiebericht schreiben' }))
    await screen.findByText('Noch nicht übertragen.')

    const reportId = router.state.location.pathname.split('/').at(-1) ?? ''

    // A choice is kept the moment it is made, a figure once the focus moves on.
    await user.selectOptions(screen.getByLabelText('Wetter'), 'Regen')
    await user.type(screen.getByLabelText('Anfahrt in km'), '25')
    await user.click(screen.getByRole('button', { name: 'Text schreiben' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Was gemacht wurde' }),
      'Zwei Leitungsschutzschalter getauscht.',
    )
    await user.click(screen.getByRole('button', { name: 'Text sichern' }))

    await waitFor(() => {
      expect(readFormValues(client.get('documents', reportId)?.['fieldValues'])).toEqual({
        field_1: 'Regen',
        field_2: 25_000,
      })
    })
    expect(client.get('documents', reportId)?.['fieldsVersion']).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Vom Kunden unterschreiben lassen' }))

    // What the customer reads before signing, with the rest of the report.
    expect(screen.getByText('Regen')).toBeTruthy()
    expect(screen.getByText('25 km')).toBeTruthy()

    await user.type(screen.getByLabelText('Name'), 'Erika Berg')
    signOn(screen.getByRole('img', { name: 'Unterschriftsfeld' }))
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))
    await screen.findByRole('img', { name: 'Unterschrift von Erika Berg' })

    // The network comes back.
    await client.synchronise()
    server.offline = false
    await client.synchronise()

    const report = server.row('documents', reportId)
    const signature = server
      .operations()
      .find((operation) => operation.entity === 'document_signatures')
    const sent = Object.fromEntries(
      (signature?.patches ?? []).map((patch) => [patch.field, patch.to]),
    )

    // The fingerprint the server works out from what it holds, the fields in it.
    expect(sent['contentFingerprint']).toBe(
      signedContentFingerprint({
        introText: String(report?.['introText']),
        lines: [],
        fields: String(report?.['fieldValues']),
      }),
    )
    expect(sent['contentFingerprint']).not.toBe(
      signedContentFingerprint({ introText: String(report?.['introText']), lines: [] }),
    )
  })
})
