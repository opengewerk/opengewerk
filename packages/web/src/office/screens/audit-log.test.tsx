import type { AuditChainReport, AuditChange, AuditPage, RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { AuditLogScreen, ChangesButton } from './audit-log.js'

/**
 * The change log for the owner (#285), as the boards "Änderungsprotokoll" of
 * the canvas draw it: the check of the chain, the list with one change opened
 * and its fields in the words of the office, the log of one record, and the
 * boxes on a phone.
 */

let calls: string[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(path: string, body: unknown, status = 200): void {
  answers.set(path, { status, body })
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('/api/auth/get-session', {
    user: { id: 'olga', email: 'olga@nord.example.de', name: 'Olga Owner' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

function inQueries(node: ReactNode, at = '/einstellungen/protokoll') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter at={at}>{node}</InRouter>
    </QueryClientProvider>
  )
}

/** A window of this width, as far as `matchMedia` is asked about it. */
function windowOf(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const least = /min-width:\s*([\d.]+)rem/.exec(query)

    return {
      matches: least ? width >= Number(least[1]) * 16 : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

const customerId = '0199aaaa-0000-7000-8000-000000000001'
const contactId = '0199aaaa-0000-7000-8000-000000000002'

function aChange(over: Partial<AuditChange> = {}): AuditChange {
  return {
    changeId: 'change-1',
    changedAt: '2026-09-27T12:32:00Z',
    operation: 'update',
    table: 'customers',
    recordId: customerId,
    userId: 'anna',
    deviceId: 'device-anna',
    reason: 'sync.write',
    databaseRole: 'opengewerk_app',
    firstSequence: 40,
    lastSequence: 42,
    fields: [
      { field: 'notes', before: null, after: 'Schlüssel beim Hausmeister, Herr Kaya.' },
      { field: 'phone', before: '0621 400 18 20', after: '0621 400 18 24' },
      { field: 'street', before: 'Rheinstr.', after: 'Rheinstraße' },
    ],
    ...over,
  }
}

const insertOfContact = aChange({
  changeId: 'change-0',
  changedAt: '2026-09-26T14:20:00Z',
  operation: 'insert',
  table: 'contacts',
  recordId: contactId,
  userId: null,
  deviceId: null,
  reason: null,
  databaseRole: 'postgres',
  firstSequence: 30,
  lastSequence: 34,
  fields: [
    { field: 'created_at', before: null, after: '2026-09-26T14:20:00Z' },
    { field: 'customer_id', before: null, after: customerId },
    { field: 'family_name', before: null, after: 'Keller' },
    { field: 'given_name', before: null, after: 'Sabine' },
    { field: 'id', before: null, after: contactId },
  ],
})

function aPage(changes: readonly AuditChange[], next: number | null = null): AuditPage {
  return {
    changes,
    next,
    titles: {
      [customerId]: {
        table: 'customers',
        field: 'name',
        title: 'Hausverwaltung Süd GmbH',
        kind: 'property_management',
      },
      [contactId]: { table: 'contacts', field: null, title: 'Sabine Keller', kind: null },
    },
    people: { anna: 'Anna Weber' },
    devices: {
      'device-anna':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
    },
  }
}

beforeEach(() => {
  calls = []
  answers = new Map()
  windowOf(1280)
  serverSays('/audit/changes', aPage([aChange(), insertOfContact]))
  serverSays('/audit/people', [
    { userId: 'anna', name: 'Anna Weber' },
    { userId: 'olga', name: 'Olga Owner' },
  ])

  vi.stubGlobal('fetch', (path: string) => {
    calls.push(path)

    const answer = answers.get(path) ?? { status: 200, body: {} }

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

describe('the change log', () => {
  it('lists the changes with record, change, person, device and way', async () => {
    signedInAs('owner')
    render(inQueries(<AuditLogScreen />))

    const table = await screen.findByRole('table', { name: 'Änderungen' })
    const rows = within(table).getAllByRole('row').slice(1)

    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Hausverwaltung Süd GmbH')
    expect(rows[0]?.textContent).toContain('Kunde')
    expect(rows[0]?.textContent).toContain('Notizen, Straße, Telefon')
    expect(rows[0]?.textContent).toContain('Anna Weber')
    expect(rows[0]?.textContent).toContain('Chrome auf Android · Abgleich')
    expect(rows[1]?.textContent).toContain('Sabine Keller')
    expect(rows[1]?.textContent).toContain('Angelegt')
    expect(rows[1]?.textContent).toContain('Niemand')
    expect(rows[1]?.textContent).toContain('Direkt in der Datenbank')
  })

  it('opens a change with its fields before and after in the words of the office', async () => {
    signedInAs('owner')
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await user.click(await screen.findByRole('button', { name: 'Hausverwaltung Süd GmbH' }))

    const fields = screen.getByRole('table', { name: 'Felder vorher und nachher' })

    expect(within(fields).getByRole('row', { name: /Straße/ }).textContent).toContain(
      'Rheinstr.Rheinstraße',
    )
    expect(within(fields).getByRole('row', { name: /Notizen/ }).textContent).toContain(
      'leerSchlüssel beim Hausmeister, Herr Kaya.',
    )
    expect(screen.getByText('Gerät: Chrome auf Android')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nur dieser Datensatz' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zum Kunden' }).getAttribute('href')).toBe(
      `/kunden/${customerId}`,
    )
  })

  it('names what a field points at and leaves out the key and the moment of a new row', async () => {
    signedInAs('owner')
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await user.click(await screen.findByRole('button', { name: 'Sabine Keller' }))

    const fields = screen.getByRole('table', { name: 'Felder vorher und nachher' })

    expect(within(fields).getByRole('row', { name: /Kunde/ }).textContent).toContain(
      'Hausverwaltung Süd GmbH',
    )
    expect(within(fields).queryByRole('row', { name: /Kennung/ })).toBeNull()
    expect(within(fields).queryByRole('row', { name: /Angelegt am/ })).toBeNull()
  })

  it('is not there for the office', async () => {
    signedInAs('office')
    render(inQueries(<AuditLogScreen />))

    expect(await screen.findByText('Das Änderungsprotokoll sieht nur der Inhaber.')).toBeTruthy()
    expect(calls.some((path) => path.startsWith('/audit'))).toBe(false)
  })

  it('loads older changes from where the page ended', async () => {
    signedInAs('owner')
    serverSays('/audit/changes', aPage([aChange()], 40))
    serverSays(
      '/audit/changes?before=40',
      aPage([
        aChange({
          changeId: 'change-older',
          changedAt: '2026-09-20T08:00:00Z',
          firstSequence: 10,
          lastSequence: 10,
          fields: [{ field: 'email', before: null, after: 'buchhaltung@hv-sued.de' }],
        }),
      ]),
    )
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await user.click(await screen.findByRole('button', { name: 'Ältere Änderungen laden' }))

    await waitFor(() => {
      expect(
        within(screen.getByRole('table', { name: 'Änderungen' })).getAllByRole('row'),
      ).toHaveLength(3)
    })
    expect(screen.getByText('Das sind alle.')).toBeTruthy()
  })
})

describe('the check of the chain', () => {
  it('runs when asked and says the chain is whole', async () => {
    signedInAs('owner')
    serverSays('/audit/chain', {
      checked: 18412,
      brokenAt: null,
      problem: null,
      brokenAtTime: null,
      checkedAt: '2026-09-27T12:40:00Z',
    } satisfies AuditChainReport)
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await screen.findByRole('table', { name: 'Änderungen' })

    expect(calls).not.toContain('/audit/chain')

    await user.click(screen.getByRole('button', { name: 'Protokoll prüfen' }))

    expect(await screen.findByText('Vollständig und unverändert.')).toBeTruthy()
    expect(screen.getByText(/18\.412 Einträge geprüft am 27\.09\.2026 um 14:40/)).toBeTruthy()
  })

  it('says where the chain breaks and marks the change', async () => {
    signedInAs('owner')
    serverSays('/audit/chain', {
      checked: 40,
      brokenAt: 41,
      problem: 'Der Eintrag wurde nachträglich verändert.',
      brokenAtTime: '2026-09-27T12:32:00Z',
      checkedAt: '2026-09-27T12:40:00Z',
    } satisfies AuditChainReport)
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await screen.findByRole('table', { name: 'Änderungen' })
    await user.click(screen.getByRole('button', { name: 'Protokoll prüfen' }))

    expect(
      await screen.findByText('Ab dem Eintrag vom 27.09.2026, 14:32 passt die Kette nicht mehr.'),
    ).toBeTruthy()
    expect(screen.getByText(/Der Eintrag wurde nachträglich verändert\./)).toBeTruthy()

    const rows = within(screen.getByRole('table', { name: 'Änderungen' })).getAllByRole('row')

    expect(rows[1]?.textContent).toContain('Kette bricht hier')
    expect(rows[2]?.textContent).not.toContain('Kette bricht hier')
  })
})

describe('the log of one record', () => {
  it('asks for the record and its parts and shows which it is', async () => {
    signedInAs('owner')
    serverSays(
      `/audit/changes?table=customers&record=${customerId}`,
      aPage([aChange(), insertOfContact]),
    )

    render(
      inQueries(
        <AuditLogScreen />,
        `/einstellungen/protokoll?art=customers&datensatz=${customerId}`,
      ),
    )

    expect(await screen.findByText('Kunde Hausverwaltung Süd GmbH')).toBeTruthy()
    expect(screen.getByText('mit seinen Ansprechpartnern')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Alle Datensätze zeigen' })).toBeTruthy()
    expect(calls).toContain(`/audit/changes?table=customers&record=${customerId}`)
    // Narrowed to one record the kind of record is no longer a choice.
    expect(screen.queryByRole('combobox', { name: 'Art' })).toBeNull()
  })

  it('is opened from the record by the owner, and the button is not there for the office', async () => {
    signedInAs('owner')
    const { unmount } = render(inQueries(<ChangesButton table="customers" id={customerId} />))

    expect((await screen.findByRole('link', { name: 'Änderungen' })).getAttribute('href')).toBe(
      `/einstellungen/protokoll?art=customers&datensatz=${customerId}`,
    )
    unmount()

    signedInAs('office')
    render(inQueries(<ChangesButton table="customers" id={customerId} />))
    await waitFor(() => {
      expect(calls.filter((path) => path === '/auth/tenants').length).toBeGreaterThan(1)
    })
    expect(screen.queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })
})

describe('on a phone', () => {
  it('shows a box per change and opens its fields in place', async () => {
    windowOf(390)
    signedInAs('owner')
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))

    const list = await screen.findByRole('list', { name: 'Änderungen' })
    const boxes = within(list).getAllByRole('button', { expanded: false })

    expect(screen.queryByRole('table', { name: 'Änderungen' })).toBeNull()
    expect(boxes[0]?.textContent).toContain('Anna Weber · Chrome auf Android · Abgleich')

    await user.click(boxes[0] as HTMLElement)

    expect(within(list).getByRole('button', { expanded: true })).toBeTruthy()
    expect(within(list).getByText('Straße')).toBeTruthy()
    expect(within(list).getByRole('link', { name: 'Zum Kunden' })).toBeTruthy()
  })
})
