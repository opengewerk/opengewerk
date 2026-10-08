import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { aTenant, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import {
  type DeadlineKindView,
  deadlinePagePath,
  type DeadlinePageView,
  type DeadlineView,
} from './deadline-requests.js'
import { DeadlineSettingsScreen } from './deadline-settings.js'
import { DeadlineListScreen } from './deadlines.js'

/**
 * The list of deadlines and their settings, in an application that is
 * nobody's: at the desk of the probe application a parcel is to be picked up
 * within a week, and the fire doors of a house are checked every six months.
 * The probe application keeps the number of a parcel beside its deadline, and
 * shows it as a column of its own.
 */

let server: StandIn
let afterChange: Mock<() => void>

interface ProbeDeadline extends DeadlineView {
  readonly parcelNumber: string | null
}

const pickup: DeadlineKindView = {
  key: 'parcel.pickup',
  title: 'Abholung eines Pakets',
  about: 'Ein Paket am Empfang wird binnen einer Woche abgeholt.',
  source: 'parcel',
  actions: ['reminder'],
  responsible: 'source',
  intervalDays: 7,
  intervalMonths: null,
  leadDays: 1,
  setting: { intervalDays: null, intervalMonths: null, leadDays: null, responsibleUserId: null },
}

const doors: DeadlineKindView = {
  key: 'door.check',
  title: 'Prüfung der Brandschutztüren',
  about: 'Die Türen eines Hauses werden alle sechs Monate geprüft.',
  source: 'door',
  actions: ['note'],
  responsible: 'lead',
  intervalDays: null,
  intervalMonths: 6,
  leadDays: 14,
  setting: { intervalDays: null, intervalMonths: null, leadDays: null, responsibleUserId: null },
}

function aDeadline(over: Partial<ProbeDeadline> = {}): ProbeDeadline {
  return {
    id: 'd-1',
    kind: 'parcel.pickup',
    kindTitle: 'Abholung eines Pakets',
    status: 'open',
    anchorOn: '2026-09-22',
    dueOn: '2026-09-29',
    remindOn: '2026-09-28',
    leadDays: 1,
    ownLeadDays: null,
    responsible: { userId: 'u-2', name: 'Max Mitglied' },
    ownResponsibleUserId: null,
    source: { label: 'Paket P-0042' },
    remindedFor: null,
    remindedAt: null,
    closedAt: null,
    closedBy: null,
    parcelNumber: 'P-0042',
    ...over,
  }
}

/** The address of the first page of open deadlines, narrowed by nothing. */
const firstPage = '/deadlines?status=open&limit=50'

/** A page of the list as the server answers it: by default all there are. */
function aPage(
  rows: readonly ProbeDeadline[],
  total: number | null = rows.length,
  more = false,
): DeadlinePageView<ProbeDeadline> {
  return { rows, total, more }
}

const people = () => ({
  me: 'u-1',
  people: [
    { userId: 'u-1', name: 'Lea Leitung', active: true },
    { userId: 'u-2', name: 'Max Mitglied', active: true },
    { userId: 'u-3', name: 'Gesa Gesperrt', active: false },
  ],
})

function inScreen(node: React.ReactNode) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InProbe>
        <InRouter at="/fristen">{node}</InRouter>
      </InProbe>
    </QueryClientProvider>,
  )
}

function asked(path: string): number {
  return server.heard.filter((call) => call.method === 'GET' && call.path === path).length
}

function list() {
  inScreen(
    <DeadlineListScreen<ProbeDeadline, DeadlineKindView>
      rights={{ read: 'deadlines.read', write: 'deadlines.write' }}
      words={{
        sub: 'Was am Empfang fällig wird.',
        searchPlaceholder: 'Paket, Haus …',
        emptyOpen: 'Gerade wartet kein Paket.',
      }}
      usePeople={people}
      source={{
        href: (deadline) => (deadline.parcelNumber ? `/pakete/${deadline.parcelNumber}` : null),
        name: (deadline) => deadline.source.label,
      }}
      columns={[
        {
          header: 'Paketnummer',
          className: 'w-[120px] min-w-[100px]',
          text: (deadline) => deadline.parcelNumber,
          cell: (deadline) =>
            deadline.parcelNumber ? <strong>{deadline.parcelNumber}</strong> : null,
        },
      ]}
      filters={[
        {
          key: 'house',
          label: 'Nach Haus filtern',
          all: 'Alle Häuser',
          width: 'w-[150px]',
          options: [
            { value: 'h-1', label: 'Haus Ost' },
            { value: 'h-2', label: 'Haus West' },
          ],
        },
      ]}
      cardFacts={(deadline) =>
        deadline.parcelNumber ? <span>Paket: {deadline.parcelNumber}</span> : null
      }
      responsibleLabel={(kind) => (kind.responsible === 'lead' ? 'Die Leitung' : 'Wer es annahm')}
      anchorWords={(kind) => (kind.source === 'door' ? 'der letzten Prüfung' : 'dem Eingang')}
      afterChange={afterChange}
    />,
  )
}

function settings() {
  inScreen(
    <DeadlineSettingsScreen<DeadlineKindView>
      rights={{ write: 'settings.write' }}
      usePeople={people}
      responsibleLabel={(kind) => (kind.responsible === 'lead' ? 'Die Leitung' : 'Wer es annahm')}
      intervalWords={(kind) =>
        kind.source === 'door'
          ? { label: 'Prüfung alle', hint: 'Gezählt ab der letzten Prüfung.' }
          : { label: 'Abholung binnen', hint: 'Gezählt ab dem Eingang.' }
      }
      actionsSentence={(kind) => `Bei Fälligkeit: ${kind.actions.join(', ')}.`}
      badge={(kind) => (kind.source === 'door' ? <span>Haus</span> : null)}
      note="Eine einzelne Frist bekommt in der Liste einen eigenen Vorlauf."
    />,
  )
}

/** A phone: less than 600 pixels, where each deadline is a box instead of a row. */
function onAPhone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function rightsOf(...rights: string[]) {
  signedIn(server, [aTenant({ roles: ['lead'], roleLabels: ['Leitung'], rights })], {
    name: 'Lea Leitung',
    email: 'lea@nord.example.de',
  })
}

beforeEach(() => {
  server = standInServer()
  afterChange = vi.fn<() => void>()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-30T10:00:00Z') })
  rightsOf('deadlines.read', 'deadlines.write', 'settings.write')
  server.answer('GET', firstPage, aPage([]))
  server.answer('GET', '/deadlines/kinds', [pickup, doors])
  server.answer('GET', '/settings/deadlines', [pickup, doors])
  server.answer('GET', '/deadlines/run', {
    succeededAt: '2026-09-30T09:59:00Z',
    failedAt: null,
    behind: false,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the list of deadlines', () => {
  it('shows what is due with the column of the application, the way to the source and late ones marked', async () => {
    server.answer(
      'GET',
      firstPage,
      aPage([
        aDeadline(),
        aDeadline({
          id: 'd-2',
          dueOn: '2026-10-08',
          remindOn: '2026-10-07',
          parcelNumber: null,
          source: { label: 'Paket ohne Nummer' },
        }),
      ]),
    )
    list()

    const table = await screen.findByRole('table', { name: 'Fristen' })

    expect(within(table).getByRole('columnheader', { name: 'Paketnummer' })).toBeTruthy()
    expect(within(table).getByText('P-0042').tagName).toBe('STRONG')
    expect(within(table).getByRole('link', { name: 'Paket P-0042' }).getAttribute('href')).toBe(
      '/pakete/P-0042',
    )
    expect(within(table).queryByRole('link', { name: 'Paket ohne Nummer' })).toBeNull()
    expect(within(table).getByText('überfällig')).toBeTruthy()
    expect(screen.getByText('2 offen')).toBeTruthy()
    expect(screen.getByText('Was am Empfang fällig wird.')).toBeTruthy()
  })

  it('asks the server for a page narrowed by the kind, the filters of the application, the person and the search', async () => {
    const narrowed =
      '/deadlines?status=open&kind=door.check&person=u-2&search=Tor&house=h-1&limit=50'

    server.answer('GET', firstPage, aPage([aDeadline()]))
    server.answer(
      'GET',
      narrowed,
      aPage([aDeadline({ id: 'd-2', source: { label: 'Paket am Tor' } })], null),
    )
    list()

    await screen.findByRole('table', { name: 'Fristen' })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Nach Art filtern'), 'door.check')
    await user.selectOptions(screen.getByLabelText('Nach Haus filtern'), 'h-1')
    await user.selectOptions(screen.getByLabelText('Nach Person filtern'), 'u-2')
    await user.type(screen.getByLabelText('Fristen durchsuchen'), 'Tor')

    expect(await screen.findByText('Paket am Tor')).toBeTruthy()
    expect(asked(narrowed)).toBeGreaterThan(0)
  })

  it('asks for the late ones at the address an application counts them with', () => {
    expect(deadlinePagePath({ status: 'open', late: true, limit: 1 })).toBe(
      '/deadlines?status=open&late=true&limit=1',
    )
  })

  it('loads the next page, and says how many of how many it shows', async () => {
    server.answer('GET', firstPage, aPage([aDeadline()], 2, true))
    server.answer(
      'GET',
      '/deadlines?status=open&offset=1&limit=50',
      aPage([aDeadline({ id: 'd-2', source: { label: 'Paket am Tor' } })], 2),
    )
    list()

    expect(await screen.findByText('1 von 2')).toBeTruthy()
    expect(screen.getByText('2 offen')).toBeTruthy()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Weitere laden' }))

    expect(await screen.findByText('Paket am Tor')).toBeTruthy()
    expect(screen.getByText('2 von 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Weitere laden' })).toBeNull()
  })

  it('names no number narrowed to a person, and offers nobody who cannot sign in', async () => {
    server.answer('GET', firstPage, aPage([aDeadline()], 2, true))
    server.answer(
      'GET',
      '/deadlines?status=open&person=u-2&limit=50',
      aPage([aDeadline()], null, true),
    )
    list()

    await screen.findByText('2 offen')
    const choice = screen.getByLabelText('Nach Person filtern')

    expect(within(choice).queryByRole('option', { name: 'Gesa Gesperrt' })).toBeNull()

    await userEvent.setup().selectOptions(choice, 'u-2')

    await waitFor(() => {
      expect(screen.queryByText(/^\d+ offen$/)).toBeNull()
    })
    expect(screen.queryByText(/\d von \d/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Weitere laden' })).toBeTruthy()
  })

  it('says on the card how far the day lies after its anchor, in months for a kind that counts them', async () => {
    server.answer(
      'GET',
      firstPage,
      aPage([
        aDeadline({
          id: 'd-3',
          kind: 'door.check',
          kindTitle: 'Prüfung der Brandschutztüren',
          anchorOn: '2026-04-15',
          dueOn: '2026-10-15',
          remindOn: '2026-10-01',
          leadDays: 14,
          parcelNumber: null,
          source: { label: 'Haus Ost' },
        }),
      ]),
    )
    list()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Frist zu Haus Ost ändern' }))

    expect(
      await screen.findByText(/6 Monate nach der letzten Prüfung am 15\.04\.2026/),
    ).toBeTruthy()
    expect(
      within(screen.getByLabelText('Verantwortlich')).getByRole('option', {
        name: 'Wie die Art vorgibt: Die Leitung',
      }),
    ).toBeTruthy()
  })

  it('shows what the application says about the record on the card, and offers nobody blocked', async () => {
    server.answer('GET', firstPage, aPage([aDeadline()]))
    list()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Frist zu Paket P-0042 ändern' }))

    expect(await screen.findByText('Paket: P-0042')).toBeTruthy()
    expect(screen.getByText(/7 Tage nach dem Eingang am 22\.09\.2026/)).toBeTruthy()
    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Verantwortlich')).getByRole('option', {
          name: 'Lea Leitung (du)',
        }),
      ).toBeTruthy()
    })
    expect(
      within(screen.getByLabelText('Verantwortlich')).queryByRole('option', {
        name: 'Gesa Gesperrt',
      }),
    ).toBeNull()
  })

  it('says when the engine failed the last time', async () => {
    server.answer('GET', '/deadlines/run', {
      succeededAt: '2026-09-30T08:00:00Z',
      failedAt: '2026-09-30T09:00:00Z',
      behind: true,
    })
    list()

    const alert = await screen.findByRole('alert')

    expect(alert.textContent).toMatch(/Der letzte Abgleich der Fristen am .* ist gescheitert\./)
    expect(alert.textContent).toContain('Wer die Instanz betreibt')
  })

  it('says what may be missing after a pass that failed, and not that nothing happened', async () => {
    server.answer('GET', '/deadlines/run', {
      succeededAt: '2026-09-30T08:00:00Z',
      failedAt: '2026-09-30T09:00:00Z',
      behind: true,
    })
    list()

    const said = (await screen.findByRole('alert')).textContent

    // A pass that fails over one reminder has written the deadlines before it
    // and made every other reminder.
    expect(said).toContain(
      'Bis der Abgleich wieder durchläuft, können neue Fristen fehlen und Erinnerungen ausbleiben.',
    )
    expect(said).not.toMatch(/entsteht keine neue Frist|wird an keine\s+erinnert/)
  })

  it('says when the engine has not gone through for too long, or never', async () => {
    server.answer('GET', '/deadlines/run', {
      succeededAt: '2026-09-29T10:00:00Z',
      failedAt: null,
      behind: true,
    })
    list()

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Die Fristen wurden zuletzt am .* abgeglichen\./,
    )
  })

  it('says that the deadlines were never gone through, when that is so', async () => {
    server.answer('GET', '/deadlines/run', { succeededAt: null, failedAt: null, behind: true })
    list()

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Die Fristen wurden noch nie abgeglichen.',
    )
  })

  it('says nothing about the engine while all is well', async () => {
    server.answer('GET', firstPage, aPage([aDeadline()]))
    list()

    await screen.findByRole('table', { name: 'Fristen' })
    await waitFor(() => {
      expect(server.heard.some((call) => call.path === '/deadlines/run')).toBe(true)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows nothing and asks for nothing without the right to read', async () => {
    rightsOf('settings.write')
    list()

    expect(await screen.findByText('Fristen sehen darf dieser Zugang nicht.')).toBeTruthy()
    expect(server.heard.some((call) => call.path.startsWith('/deadlines'))).toBe(false)
  })

  it('offers nothing to press without the right to decide', async () => {
    rightsOf('deadlines.read')
    server.answer('GET', firstPage, aPage([aDeadline()]))
    list()

    // The list is only asked for once the rights are known, so the table
    // stands for an answer that says what this access may do.
    const table = await screen.findByRole('table', { name: 'Fristen' })

    expect(within(table).getByText('Max Mitglied')).toBeTruthy()
    expect(within(table).queryByRole('button', { name: 'Erledigt' })).toBeNull()
    expect(within(table).queryByRole('button', { name: /ändern$/ })).toBeNull()
  })

  it('asks for the deadlines anew once one is done, and lets the application follow up', async () => {
    server.answer('GET', firstPage, aPage([aDeadline()]))
    server.answer('POST', '/deadlines/d-1/done', aDeadline({ status: 'done' }))
    list()

    const table = await screen.findByRole('table', { name: 'Fristen' })
    const user = userEvent.setup()
    await user.click(within(table).getByRole('button', { name: 'Erledigt' }))

    await waitFor(() => {
      expect(afterChange).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(asked(firstPage)).toBe(2)
    })
  })

  it('does not follow up on a change the server refused', async () => {
    server.answer('GET', firstPage, aPage([aDeadline()]))
    server.answer('POST', '/deadlines/d-1/done', { message: 'Die Frist ist schon erledigt.' }, 409)
    list()

    const table = await screen.findByRole('table', { name: 'Fristen' })
    const user = userEvent.setup()
    await user.click(within(table).getByRole('button', { name: 'Erledigt' }))

    await screen.findByRole('alert')
    expect(afterChange).not.toHaveBeenCalled()
  })

  it('lets the application follow up once the card of a deadline is saved', async () => {
    server.answer('GET', firstPage, aPage([aDeadline()]))
    server.answer('PATCH', '/deadlines/d-1', aDeadline({ ownLeadDays: 3 }))
    list()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Frist zu Paket P-0042 ändern' }))

    // Nothing changed yet, so there is nothing to save.
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await user.type(screen.getByLabelText('Vorlauf in Tagen'), '3')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(afterChange).toHaveBeenCalledTimes(1)
    })
    // Only the lead, which is what changed: the person stays whoever somebody
    // else may have chosen since the card was opened (opengewerk-haustechnik#31).
    expect(server.heard.find((call) => call.method === 'PATCH')?.body).toEqual({ leadDays: 3 })
  })

  it('shows a box per deadline on a phone, with what the application adds and its buttons', async () => {
    onAPhone()
    server.answer('GET', firstPage, aPage([aDeadline()]))
    list()

    const boxes = await screen.findByRole('list', { name: 'Fristen' })

    expect(screen.queryByRole('table', { name: 'Fristen' })).toBeNull()
    expect(within(boxes).getByText('Abholung eines Pakets · P-0042 · Max Mitglied')).toBeTruthy()
    expect(within(boxes).getByRole('link', { name: 'Paket P-0042' })).toBeTruthy()
    await waitFor(() => {
      expect(within(boxes).getByRole('button', { name: 'Erledigt' })).toBeTruthy()
    })
  })

  it('offers nothing to press on a phone without the right to decide', async () => {
    onAPhone()
    rightsOf('deadlines.read')
    server.answer('GET', firstPage, aPage([aDeadline()]))
    list()

    // As in the table: the list is only asked for once the rights are known.
    const boxes = await screen.findByRole('list', { name: 'Fristen' })

    expect(within(boxes).getByText('Abholung eines Pakets · P-0042 · Max Mitglied')).toBeTruthy()
    expect(within(boxes).queryByRole('button', { name: 'Erledigt' })).toBeNull()
    expect(within(boxes).queryByRole('button', { name: /ändern$/ })).toBeNull()
  })

  it('says what the application says when nothing is open', async () => {
    list()

    expect(await screen.findByText('Gerade wartet kein Paket.')).toBeTruthy()
  })
})

describe('the settings of the deadlines', () => {
  it('take an interval in months for a kind that counts in months, and send it in that unit', async () => {
    server.answer('PUT', '/settings/deadlines/door.check', {
      ...doors,
      setting: { ...doors.setting, intervalMonths: 3 },
    })
    settings()

    const interval = await screen.findByLabelText('Prüfung alle')
    expect((interval as HTMLInputElement).value).toBe('6')
    expect(screen.getAllByText('Monate').length).toBeGreaterThan(0)

    const user = userEvent.setup()
    await user.clear(interval)
    await user.type(interval, '3')
    const card = interval.closest('section') ?? document.body
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(
        server.heard.find(
          (call) => call.method === 'PUT' && call.path === '/settings/deadlines/door.check',
        )?.body,
      ).toEqual({ leadDays: null, intervalMonths: 3, responsibleUserId: null })
    })
  })

  it('refuses an interval in months out of bounds before anything is sent', async () => {
    settings()

    const interval = await screen.findByLabelText('Prüfung alle')
    const user = userEvent.setup()
    await user.clear(interval)
    await user.type(interval, '601')

    expect(screen.getByText('Die Frist ist höchstens 600 Monate lang.')).toBeTruthy()
  })

  it('sends an interval in days for a kind that counts in days', async () => {
    server.answer('PUT', '/settings/deadlines/parcel.pickup', pickup)
    settings()

    const interval = await screen.findByLabelText('Abholung binnen')
    const user = userEvent.setup()
    await user.clear(interval)
    await user.type(interval, '10')
    const card = interval.closest('section') ?? document.body
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(
        server.heard.find(
          (call) => call.method === 'PUT' && call.path === '/settings/deadlines/parcel.pickup',
        )?.body,
      ).toEqual({ leadDays: null, intervalDays: 10, responsibleUserId: null })
    })
  })

  it('shows what the application puts beside a kind, and its remark', async () => {
    settings()

    expect(await screen.findByText('Haus')).toBeTruthy()
    expect(
      screen.getByText('Eine einzelne Frist bekommt in der Liste einen eigenen Vorlauf.'),
    ).toBeTruthy()
    expect(screen.getByText('Bei Fälligkeit: note.')).toBeTruthy()
  })

  it('are only read without the right to change them', async () => {
    rightsOf('deadlines.read')
    settings()

    await screen.findByText('Prüfung der Brandschutztüren')
    await waitFor(() => {
      expect((screen.getByLabelText('Prüfung alle') as HTMLInputElement).disabled).toBe(true)
    })
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})
