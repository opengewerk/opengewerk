import type {
  AuditChainReport,
  AuditChange,
  AuditPage,
  TenantId,
} from '@opengewerk/platform-domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InterfaceApplication } from '../application.js'
import { clockTime, moment } from '../format.js'
import { InRouter } from '../in-router.js'
import { InProbe, probeApplication } from '../probe-application.js'
import type { TenantChoice } from '../session/session.js'
import { AuditLogScreen, ChangesButton } from './audit-log.js'
import { useAuditWords } from './audit-words.js'

/**
 * The change log of a tenant (ADR 0010), for an application that belongs to
 * nobody: its shelves with their notes, its tenants called "Mandant", the log
 * for whoever leads one. The check of the chain, the list with one change
 * opened and its fields in the application's words, the log of one record,
 * the button at a record and the boxes on a phone.
 */

let calls: string[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(path: string, body: unknown, status = 200): void {
  answers.set(path, { status, body })
}

/** Somebody of the tenant with these rights, as the server resolved them. */
function signedInWith(...rights: string[]) {
  const tenant: TenantChoice = {
    id: 't-1' as TenantId,
    name: 'Probewerk Nord',
    roles: ['lead'],
    roleLabels: ['Leitung'],
    rights,
    secondFactor: true,
  }

  serverSays('/api/auth/get-session', {
    user: { id: 'lea', email: 'lea@nord.example.de', name: 'Lea Leitung' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('/auth/tenants', [tenant])
}

function inQueries(
  node: ReactNode,
  at = '/einstellungen/protokoll',
  application?: InterfaceApplication,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InProbe application={application}>
        <InRouter at={at}>{node}</InRouter>
      </InProbe>
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

const shelfId = '0199cccc-0000-7000-8000-000000000001'
const noteId = '0199cccc-0000-7000-8000-000000000002'

function aChange(over: Partial<AuditChange> = {}): AuditChange {
  return {
    changeId: 'change-1',
    changedAt: '2026-10-03T12:32:00Z',
    operation: 'update',
    table: 'shelves',
    recordId: shelfId,
    userId: 'mia',
    deviceId: 'device-mia',
    reason: 'sync.write',
    databaseRole: 'opengewerk_app',
    firstSequence: 40,
    lastSequence: 41,
    fields: [
      { field: 'closed', before: 'false', after: 'true' },
      { field: 'label', before: 'Werkzeug', after: 'Werkzeug und Messgeräte' },
    ],
    ...over,
  }
}

const insertOfNote = aChange({
  changeId: 'change-0',
  changedAt: '2026-10-02T14:20:00Z',
  operation: 'insert',
  table: 'notes',
  recordId: noteId,
  userId: null,
  deviceId: null,
  reason: null,
  databaseRole: 'postgres',
  firstSequence: 30,
  lastSequence: 34,
  fields: [
    { field: 'created_at', before: null, after: '2026-10-02T14:20:00Z' },
    { field: 'id', before: null, after: noteId },
    { field: 'shelf_id', before: null, after: shelfId },
    { field: 'text', before: null, after: 'Zange fehlt' },
  ],
})

function aPage(changes: readonly AuditChange[], next: number | null = null): AuditPage {
  return {
    changes,
    next,
    titles: {
      [shelfId]: {
        table: 'shelves',
        field: 'label',
        title: 'Werkzeug und Messgeräte',
        kind: null,
      },
      [noteId]: { table: 'notes', field: 'text', title: 'Zange fehlt', kind: null },
    },
    people: { mia: 'Mia Mitglied' },
    devices: {
      'device-mia':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
    },
  }
}

beforeEach(() => {
  calls = []
  answers = new Map()
  windowOf(1280)
  serverSays('/audit/changes', aPage([aChange(), insertOfNote]))
  serverSays('/audit/people', [
    { userId: 'lea', name: 'Lea Leitung' },
    { userId: 'mia', name: 'Mia Mitglied' },
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
  vi.restoreAllMocks()
})

describe('the change log', () => {
  it("lists the changes with record, change, person, device and way, in the application's words", async () => {
    signedInWith('audit.read')
    render(inQueries(<AuditLogScreen />))

    const table = await screen.findByRole('table', { name: 'Änderungen' })
    const rows = within(table).getAllByRole('row').slice(1)

    expect(screen.getByText('Was im Mandanten geändert wurde, Feld für Feld.')).toBeTruthy()
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Werkzeug und Messgeräte')
    expect(rows[0]?.textContent).toContain('Regal')
    expect(rows[0]?.textContent).toContain('Beschriftung, Geschlossen')
    expect(rows[0]?.textContent).toContain('Mia Mitglied')
    expect(rows[0]?.textContent).toContain('Chrome auf Android · Abgleich')
    expect(rows[1]?.textContent).toContain('Zange fehlt')
    expect(rows[1]?.textContent).toContain('Notiz')
    expect(rows[1]?.textContent).toContain('Angelegt')
    expect(rows[1]?.textContent).toContain('Niemand')
    expect(rows[1]?.textContent).toContain('Direkt in der Datenbank')
  })

  it('opens a change with its fields before and after, and the ways to the record', async () => {
    signedInWith('audit.read')
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await user.click(await screen.findByRole('button', { name: 'Werkzeug und Messgeräte' }))

    const fields = screen.getByRole('table', { name: 'Felder vorher und nachher' })

    expect(within(fields).getByRole('row', { name: /Beschriftung/ }).textContent).toContain(
      'WerkzeugWerkzeug und Messgeräte',
    )
    expect(within(fields).getByRole('row', { name: /Geschlossen/ }).textContent).toContain('NeinJa')
    expect(screen.getByText('Gerät: Chrome auf Android')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nur dieser Datensatz' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zum Regal' }).getAttribute('href')).toBe(
      `/regale/${shelfId}`,
    )
  })

  it('names what a field points at and leaves out the key and the moment of a new row', async () => {
    signedInWith('audit.read')
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await user.click(await screen.findByRole('button', { name: 'Zange fehlt' }))

    const fields = screen.getByRole('table', { name: 'Felder vorher und nachher' })

    expect(within(fields).getByRole('row', { name: /Regal/ }).textContent).toContain(
      'Werkzeug und Messgeräte',
    )
    expect(within(fields).queryByRole('row', { name: /Kennung/ })).toBeNull()
    expect(within(fields).queryByRole('row', { name: /Angelegt am/ })).toBeNull()
    // A note is no record of its own and has no screen to be opened on.
    expect(screen.queryByRole('button', { name: 'Nur dieser Datensatz' })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Zum / })).toBeNull()
  })

  it("offers every kind of record in the application's words, the foundation's among them", async () => {
    signedInWith('audit.read')
    render(inQueries(<AuditLogScreen />))
    await screen.findByRole('table', { name: 'Änderungen' })

    const kinds = within(screen.getByRole('combobox', { name: 'Art' }))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '')

    expect(kinds[0]).toBe('Alle Arten')
    expect(kinds).toContain('Regal')
    expect(kinds).toContain('Briefzeile')
    expect(kinds).toContain('Zugang')
    expect(kinds).toContain('Mandant')
    expect(kinds.slice(1)).toEqual(
      [...kinds.slice(1)].sort((one, other) => one.localeCompare(other, 'de')),
    )
  })

  it('is not there for whoever lacks the right, and says who reads it', async () => {
    signedInWith('notes.write')
    render(inQueries(<AuditLogScreen />))

    expect(await screen.findByText('Das Protokoll sieht nur die Leitung.')).toBeTruthy()
    expect(calls.some((path) => path.startsWith('/audit'))).toBe(false)
  })

  it('loads older changes from where the page ended', async () => {
    signedInWith('audit.read')
    serverSays('/audit/changes', aPage([aChange()], 40))
    serverSays(
      '/audit/changes?before=40',
      aPage([
        aChange({
          changeId: 'change-older',
          changedAt: '2026-09-20T08:00:00Z',
          firstSequence: 10,
          lastSequence: 10,
          fields: [{ field: 'closed', before: null, after: 'false' }],
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

  it('says so where an entry hands in no words for the log', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { audit: _words, ...withoutWords } = probeApplication()

    function Asking() {
      useAuditWords()

      return null
    }

    expect(() =>
      render(
        <InProbe application={withoutWords}>
          <Asking />
        </InProbe>,
      ),
    ).toThrow('Diese Ansicht braucht die Wörter des Änderungsprotokolls')
  })
})

describe('the check of the chain', () => {
  it('runs when asked and says the chain is whole', async () => {
    signedInWith('audit.read')
    serverSays('/audit/chain', {
      checked: 18412,
      brokenAt: null,
      problem: null,
      brokenAtTime: null,
      checkedAt: '2026-10-03T12:40:00Z',
    } satisfies AuditChainReport)
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await screen.findByRole('table', { name: 'Änderungen' })

    expect(calls).not.toContain('/audit/chain')

    await user.click(screen.getByRole('button', { name: 'Protokoll prüfen' }))

    expect(await screen.findByText('Vollständig und unverändert.')).toBeTruthy()
    // In the time zone of the device, whichever that is: the CI runs in UTC.
    const at = new Date('2026-10-03T12:40:00Z')
    const day = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(at)

    expect(
      screen.getByText(`18.412 Einträge geprüft am ${day} um ${clockTime(at)}.`, { exact: false }),
    ).toBeTruthy()
  })

  it('says where the chain breaks and marks the change', async () => {
    signedInWith('audit.read')
    serverSays('/audit/chain', {
      checked: 40,
      brokenAt: 41,
      problem: 'Der Eintrag wurde nachträglich verändert.',
      brokenAtTime: '2026-10-03T12:32:00Z',
      checkedAt: '2026-10-03T12:40:00Z',
    } satisfies AuditChainReport)
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))
    await screen.findByRole('table', { name: 'Änderungen' })
    await user.click(screen.getByRole('button', { name: 'Protokoll prüfen' }))

    expect(
      await screen.findByText(
        `Ab dem Eintrag vom ${moment('2026-10-03T12:32:00Z')} passt die Kette nicht mehr.`,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/Der Eintrag wurde nachträglich verändert\./)).toBeTruthy()

    const rows = within(screen.getByRole('table', { name: 'Änderungen' })).getAllByRole('row')

    expect(rows[1]?.textContent).toContain('Kette bricht hier')
    expect(rows[2]?.textContent).not.toContain('Kette bricht hier')
  })
})

describe('the log of one record', () => {
  it('asks for the record and its parts and shows which it is, in the words of the application', async () => {
    signedInWith('audit.read')
    serverSays(`/audit/changes?table=shelves&record=${shelfId}`, aPage([aChange(), insertOfNote]))

    render(
      inQueries(<AuditLogScreen />, `/einstellungen/protokoll?art=shelves&datensatz=${shelfId}`),
    )

    expect(await screen.findByText('Regal Werkzeug und Messgeräte')).toBeTruthy()
    expect(screen.getByText('mit seinen Notizen')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Alle Datensätze zeigen' })).toBeTruthy()
    expect(calls).toContain(`/audit/changes?table=shelves&record=${shelfId}`)
    // Narrowed to one record the kind of record is no longer a choice.
    expect(screen.queryByRole('combobox', { name: 'Art' })).toBeNull()
  })

  it('takes no record the application does not open the log from', async () => {
    signedInWith('audit.read')
    render(inQueries(<AuditLogScreen />, `/einstellungen/protokoll?art=notes&datensatz=${noteId}`))

    await screen.findByRole('table', { name: 'Änderungen' })

    expect(calls).toContain('/audit/changes')
    expect(screen.queryByRole('button', { name: 'Alle Datensätze zeigen' })).toBeNull()
  })

  it('is opened from the record by whoever reads the log, and the button is not there for others', async () => {
    signedInWith('audit.read')
    const { unmount } = render(inQueries(<ChangesButton table="shelves" id={shelfId} />))

    expect((await screen.findByRole('link', { name: 'Änderungen' })).getAttribute('href')).toBe(
      `/einstellungen/protokoll?art=shelves&datensatz=${shelfId}`,
    )
    unmount()

    signedInWith('notes.write')
    render(inQueries(<ChangesButton table="shelves" id={shelfId} />))
    await waitFor(() => {
      expect(calls.filter((path) => path === '/auth/tenants').length).toBeGreaterThan(1)
    })
    expect(screen.queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })
})

describe('on a phone', () => {
  it('shows a box per change and opens its fields in place', async () => {
    windowOf(390)
    signedInWith('audit.read')
    const user = userEvent.setup()

    render(inQueries(<AuditLogScreen />))

    const list = await screen.findByRole('list', { name: 'Änderungen' })
    const boxes = within(list).getAllByRole('button', { expanded: false })

    expect(screen.queryByRole('table', { name: 'Änderungen' })).toBeNull()
    expect(boxes[0]?.textContent).toContain('Mia Mitglied · Chrome auf Android · Abgleich')

    await user.click(boxes[0] as HTMLElement)

    expect(within(list).getByRole('button', { expanded: true })).toBeTruthy()
    expect(within(list).getByText('Beschriftung')).toBeTruthy()
    expect(within(list).getByRole('link', { name: 'Zum Regal' })).toBeTruthy()
  })
})
