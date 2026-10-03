import type { AuditChange, AuditPage, RoleKey } from '@opengewerk/domain'
import { AuditLogScreen, ChangesButton } from '@opengewerk/platform-web/office'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../app/in-router.js'
import { aTenantChoice } from '../session/test-tenants.js'

/**
 * The change log of a business for its owner (#285), as this application
 * binds it. The screen is the foundation's and tested there (ADR 0010); what
 * is held here is what only this application can get wrong: what the log is
 * called and who reads it, what its records are called and where they open,
 * and the one log it opens from a record of its own.
 */

let calls: string[]
let answers: Map<string, unknown>

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'olga', email: 'olga@nord.example.de', name: 'Olga Owner' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])
}

function inQueries(node: ReactNode, at = '/einstellungen/protokoll') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter at={at}>{node}</InRouter>
    </QueryClientProvider>
  )
}

const customerId = '0199aaaa-0000-7000-8000-000000000001'
const documentId = '0199aaaa-0000-7000-8000-000000000003'

const issued: AuditChange = {
  changeId: 'change-1',
  changedAt: '2026-09-27T12:32:00Z',
  operation: 'update',
  table: 'documents',
  recordId: documentId,
  userId: 'anna',
  deviceId: null,
  reason: 'document.issue',
  databaseRole: 'opengewerk_app',
  firstSequence: 40,
  lastSequence: 41,
  fields: [{ field: 'status', before: 'draft', after: 'issued' }],
}

const page: AuditPage = {
  changes: [issued],
  next: null,
  titles: {
    [customerId]: {
      table: 'customers',
      field: 'name',
      title: 'Hausverwaltung Süd GmbH',
      kind: 'property_management',
    },
    [documentId]: { table: 'documents', field: 'number', title: 'AN-2026-0012', kind: 'quote' },
  },
  people: { anna: 'Anna Weber' },
  devices: {},
}

beforeEach(() => {
  calls = []
  answers = new Map()
  answers.set('/audit/changes', page)
  answers.set('/audit/people', [{ userId: 'anna', name: 'Anna Weber' }])

  vi.stubGlobal('fetch', (path: string) => {
    calls.push(path)

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the change log in this application', () => {
  it('says what the log holds, and names a document by its kind and what happened to it', async () => {
    signedInAs('owner')
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))

    expect(
      await screen.findByText(
        'Jede Änderung im Betrieb, Feld für Feld: wer, wann, auf welchem Gerät und auf welchem Weg.',
      ),
    ).toBeTruthy()
    expect(await screen.findByText('Angebot')).toBeTruthy()
    expect(screen.getByText('Festgeschrieben')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'AN-2026-0012' }))

    expect(screen.getByRole('link', { name: 'Zum Beleg' }).getAttribute('href')).toBe(
      `/belege/${documentId}`,
    )
  })

  it('is for the owner, and says so to the office', async () => {
    signedInAs('office')
    render(inQueries(<AuditLogScreen />))

    expect(await screen.findByText('Das Änderungsprotokoll sieht nur der Inhaber.')).toBeTruthy()
    expect(calls.some((path) => path.startsWith('/audit'))).toBe(false)
  })

  it('opens the log of a customer with its contacts, from the button at the customer', async () => {
    signedInAs('owner')
    answers.set(`/audit/changes?table=customers&record=${customerId}`, page)
    const { unmount } = render(inQueries(<ChangesButton table="customers" id={customerId} />))

    expect((await screen.findByRole('link', { name: 'Änderungen' })).getAttribute('href')).toBe(
      `/einstellungen/protokoll?art=customers&datensatz=${customerId}`,
    )
    unmount()

    render(
      inQueries(
        <AuditLogScreen />,
        `/einstellungen/protokoll?art=customers&datensatz=${customerId}`,
      ),
    )

    expect(await screen.findByText('Kunde Hausverwaltung Süd GmbH')).toBeTruthy()
    expect(screen.getByText('mit seinen Ansprechpartnern')).toBeTruthy()
    await waitFor(() => {
      expect(calls).toContain(`/audit/changes?table=customers&record=${customerId}`)
    })
  })
})
