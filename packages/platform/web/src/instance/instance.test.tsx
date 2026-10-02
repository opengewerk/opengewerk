import 'fake-indexeddb/auto'

import type {
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
} from '@opengewerk/platform-domain'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { House, Settings, Shield } from 'lucide-react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InstanceFrame } from './frame.js'
import type { InstanceEntry } from './frame.js'
import { InstanceOperatorsScreen } from './operators.js'
import { InstanceSettingsScreen } from './settings.js'
import { InstanceTenantsScreen } from './tenants.js'

/**
 * The area of the instance (#188) with its screens, as the boards "Instanz:
 * Betriebe", "Instanz: Einstellungen" and "Instanz: Betreiber" draw them: only
 * for whoever runs the instance with a second factor, and each screen saying
 * and sending what the routes behind it take.
 *
 * Which screens the area lists, under which address and by which word, and
 * every sentence that names a tenant, whoever leads one or whoever runs the
 * instance, come from the application (ADR 0010). The one in these tests
 * belongs to nobody, and calls whoever runs the instance its "Aufsicht".
 */

let server: StandIn

/** The screens of the area as the application that belongs to nobody lists them. */
const navigation: readonly InstanceEntry[] = [
  { to: '/instanz', label: 'Mandanten', icon: House },
  { to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings },
  { to: '/instanz/aufsicht', label: 'Aufsicht', icon: Shield },
]

/** The frame at the address of the area, with the three screens below it. */
async function area(at: string) {
  const frame = (): ReactNode => <InstanceFrame navigation={navigation} />

  return inFrame(frame, {
    at,
    screens: {
      '/': () => <h1>Regale</h1>,
      '/konto': () => <h1>Konto</h1>,
      '/instanz': () => <InstanceTenantsScreen />,
      '/instanz/einstellungen': () => <InstanceSettingsScreen />,
      '/instanz/aufsicht': () => <InstanceOperatorsScreen />,
    },
  })
}

/** What was sent to a route, in order. */
function sent(method: string, path: string): unknown[] {
  return server.heard
    .filter((call) => call.method === method && call.path === path)
    .map((call) => call.body)
}

/** A window as narrow as a phone: no query of the bands matches. */
function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

beforeEach(() => {
  server = standInServer()
  signedIn(server, [aTenant({ name: 'Probewerk Nord' })])
  server.answer('GET', '/instance/access', { operator: true, secondFactor: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the door of the area', () => {
  it('waits while it is asked whether the person runs the instance', async () => {
    server.answer('GET', '/instance/access', { operator: true, secondFactor: true })
    // Answered with nothing at all: the question is still out.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}))
    await area('/instanz')

    expect(await screen.findByText('Wird geladen.')).toBeTruthy()
  })

  it('stays shut for somebody who does not run the instance, in the words of the application', async () => {
    server.answer('GET', '/instance/access', { operator: false, secondFactor: true })
    await area('/instanz')

    expect(await screen.findByText('Hierher kommt nur die Aufsicht der Instanz.')).toBeTruthy()
    expect(screen.getByText('Was alle Mandanten dieser Instanz teilen.')).toBeTruthy()
    expect(server.heard.some((call) => call.path === '/instance/tenants')).toBe(false)
  })

  it('says so when it could not be asked', async () => {
    server.answer('GET', '/instance/access', {}, 500)
    await area('/instanz')

    expect(
      await screen.findByText('Ob du zur Aufsicht gehörst, ließ sich nicht klären.'),
    ).toBeTruthy()
    expect(server.heard.some((call) => call.path === '/instance/tenants')).toBe(false)
  })

  /**
   * For whom else a second factor is required is the application's to say;
   * what one is and where it is set up, the foundation's.
   */
  it('sends whoever runs it without a second factor to "Konto"', async () => {
    server.answer('GET', '/instance/access', { operator: true, secondFactor: false })
    await area('/instanz/einstellungen')

    const said = await screen.findByText(/braucht hier einen zweiten Faktor/)

    expect(said.textContent).toBe(
      'Die Aufsicht braucht hier einen zweiten Faktor, wie die Leitung: eine Authenticator-App oder die Anmeldung mit einem Passkey. Eingerichtet wird beides unter Konto.',
    )
    expect(screen.getByRole('link', { name: 'Konto' }).getAttribute('href')).toBe('/konto')
    expect(server.heard.some((call) => call.path === '/instance/settings')).toBe(false)
  })
})

describe('the frame of the area', () => {
  it('has the navigation the application hands in, and the way back to the tenant', async () => {
    server.answer('GET', '/instance/tenants', [])
    await area('/instanz')

    const nav = (await screen.findAllByRole('navigation', { name: 'Instanz' }))[0] as HTMLElement

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Mandanten', 'Einstellungen', 'Aufsicht', 'Zurück zum Schreibtisch'])
    expect(within(nav).getByRole('link', { name: 'Aufsicht' }).getAttribute('href')).toBe(
      '/instanz/aufsicht',
    )
    expect(
      within(nav).getByRole('link', { name: 'Zurück zum Schreibtisch' }).getAttribute('href'),
    ).toBe('/')
    expect(await within(nav).findByText('Probewerk Nord')).toBeTruthy()
  })

  /**
   * Every screen of the area stands below its address, so the entry at that
   * address would light everywhere if it lit below itself as the others do.
   */
  it('lights the entry at the address of the area there only, and every other one below itself', async () => {
    server.answer('GET', '/instance/settings', {
      mailInternalHosts: [],
      backupTime: '02:30',
      takenOverAt: null,
    })
    await area('/instanz/einstellungen')

    const nav = (await screen.findAllByRole('navigation', { name: 'Instanz' }))[0] as HTMLElement
    const lit = (label: string) =>
      within(nav).getByRole('link', { name: label }).getAttribute('aria-current')

    expect(lit('Einstellungen')).toBe('page')
    expect(lit('Mandanten')).toBeNull()
    expect(lit('Aufsicht')).toBeNull()
    // And the colours that draw it follow the attribute.
    expect(within(nav).getByRole('link', { name: 'Einstellungen' }).className).toContain('bg-ink')
    expect(within(nav).getByRole('link', { name: 'Mandanten' }).className).not.toContain('bg-ink')
  })

  it('lights the entry at the address of the area on that address', async () => {
    server.answer('GET', '/instance/tenants', [])
    await area('/instanz')

    const nav = (await screen.findAllByRole('navigation', { name: 'Instanz' }))[0] as HTMLElement

    expect(within(nav).getByRole('link', { name: 'Mandanten' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Mandanten' }).className).toContain('bg-ink')
  })

  it('names the application and the instance in its header, and no tenant', async () => {
    server.answer('GET', '/instance/tenants', [])
    await area('/instanz')

    const header = await screen.findByRole('banner')

    expect(header.textContent).toContain('Probewerk')
    expect(header.textContent).toContain(`Instanz ${globalThis.location.host}`)
    expect(within(header).queryByText('Probewerk Nord')).toBeNull()
  })

  it('opens its navigation behind "Menü" on a phone, and closes it again', async () => {
    phone()
    server.answer('GET', '/instance/tenants', [])
    await area('/instanz')

    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Menü' }))

    const drawer = screen.getByRole('dialog', { name: 'Menü' })

    expect(
      within(drawer)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Mandanten', 'Einstellungen', 'Aufsicht', 'Zurück zum Schreibtisch'])

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Menü' }))
    await user.click(screen.getByRole('button', { name: 'Menü schließen' }))
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
  })
})

const tenants: readonly InstanceTenantView[] = [
  {
    id: 't-1',
    name: 'Probewerk Nord',
    createdAt: '2026-09-24T18:12:00.000Z',
    leads: [{ name: 'Mia Mitglied', email: 'Mia@Nord.example.de' }],
    members: 4,
    invitedLeads: [],
  },
  {
    id: 't-3',
    name: 'Probewerk Süd',
    createdAt: '2026-09-27T14:31:00.000Z',
    leads: [],
    members: 1,
    invitedLeads: ['anna@sued.example.de'],
  },
  {
    id: 't-4',
    name: 'Probewerk West',
    createdAt: '2026-09-28T10:00:00.000Z',
    leads: [],
    members: 0,
    invitedLeads: [],
  },
]

describe('the tenants on the instance', () => {
  it('lists each with its day, whoever leads it and its people, and nothing of what is in it', async () => {
    server.answer('GET', '/instance/tenants', tenants)
    await area('/instanz')

    const table = await screen.findByRole('table', { name: 'Die Mandanten dieser Instanz' })
    const rows = within(table).getAllByRole('row')

    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Mandant', 'Angelegt', 'Leitung', 'Zugänge'])
    expect(rows[1]?.textContent).toContain('Probewerk Nord')
    expect(rows[1]?.textContent).toContain('24.09.2026')
    // "du" beside oneself, whatever the address is written like.
    expect(rows[1]?.textContent).toContain('Mia Mitglieddu')
    expect(within(rows[1] as HTMLElement).getByText('du')).toBeTruthy()
    expect(rows[2]?.textContent).toContain('Einladung offen')
    expect(rows[2]?.textContent).toContain('anna@sued.example.de')
    expect(rows[3]?.textContent).toContain('Niemand')
    expect(screen.getByText('Vom Inhalt eines Mandanten sieht die Aufsicht nichts.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Mandanten' })).toBeTruthy()
    expect(screen.getByText('Alle Mandanten dieser Instanz, jeder für sich.')).toBeTruthy()
  })

  it('makes one for somebody else and shows the link that makes them lead it, once', async () => {
    server.answer('GET', '/instance/tenants', tenants)
    server.answer('POST', '/instance/tenants', {
      tenantId: 't-5',
      token: 'k7Qm2vXnR4tB9sLw',
      expiresAt: '2026-10-09T14:31:00.000Z',
    })
    await area('/instanz')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Mandant anlegen' }))
    const form = screen
      .getByRole('button', { name: 'Abbrechen' })
      .closest('form') as HTMLFormElement

    expect(within(form).getByText('Einen eigenen Mandanten gibt es unter „Konto“.')).toBeTruthy()
    expect(within(form).getByText('Wer den Link öffnet, leitet den Mandanten.')).toBeTruthy()

    // Nothing goes out while a field is missing, and each says so in the
    // words of the application, or of the foundation for the address.
    await user.click(within(form).getByRole('button', { name: 'Mandant anlegen' }))
    expect(within(form).getByText('Ein Mandant braucht einen Namen.')).toBeTruthy()
    expect(within(form).getByText('Die Leitung braucht einen Namen.')).toBeTruthy()
    expect(within(form).getByText('Die E-Mail-Adresse sieht nicht wie eine aus.')).toBeTruthy()
    expect(sent('POST', '/instance/tenants')).toEqual([])

    await user.type(within(form).getByLabelText('Name des Mandanten'), 'Probewerk Ost')
    await user.type(within(form).getByLabelText('Name der Leitung'), 'Anna Weber')
    await user.type(within(form).getByLabelText(/Adresse der Leitung/), 'anna@ost.example.de')
    await user.click(within(form).getByRole('button', { name: 'Mandant anlegen' }))

    expect(await screen.findByText('Probewerk Ost ist angelegt.')).toBeTruthy()
    // The route calls the person whoever leads the tenant.
    expect(sent('POST', '/instance/tenants')).toEqual([
      { name: 'Probewerk Ost', leadName: 'Anna Weber', leadEmail: 'anna@ost.example.de' },
    ])
    expect((screen.getByLabelText('Einladungslink') as HTMLInputElement).value).toBe(
      `${globalThis.location.origin}/einladung/k7Qm2vXnR4tB9sLw`,
    )
    // How long it holds is the foundation's to say, what it makes of the
    // person the application's.
    expect(
      screen.getByText(
        'Diesen Link an Anna Weber geben. Er ist nur jetzt zu sehen, gilt einmal und sieben Tage lang, und wer ihn öffnet, leitet den neuen Mandanten.',
      ),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(screen.queryByLabelText('Einladungslink')).toBeNull()
  })

  it('refuses a name the application would refuse, and is no longer than it takes', async () => {
    server.answer('GET', '/instance/tenants', tenants)
    await area('/instanz')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Mandant anlegen' }))
    const form = screen
      .getByRole('button', { name: 'Abbrechen' })
      .closest('form') as HTMLFormElement
    const name = within(form).getByLabelText('Name des Mandanten') as HTMLInputElement

    expect(name.maxLength).toBe(40)

    await user.type(name, '   ')
    await user.type(within(form).getByLabelText('Name der Leitung'), 'Anna Weber')
    await user.type(within(form).getByLabelText(/Adresse der Leitung/), 'anna@ost.example.de')
    await user.click(within(form).getByRole('button', { name: 'Mandant anlegen' }))

    expect(within(form).getByText('Ein Mandant braucht einen Namen.')).toBeTruthy()
    expect(sent('POST', '/instance/tenants')).toEqual([])
  })

  it('says why it could not make one: in the words of the server, or of the application', async () => {
    server.answer('GET', '/instance/tenants', tenants)
    server.answer('POST', '/instance/tenants', { message: 'Den Mandanten gibt es schon.' }, 409)
    await area('/instanz')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Mandant anlegen' }))
    const form = screen
      .getByRole('button', { name: 'Abbrechen' })
      .closest('form') as HTMLFormElement

    await user.type(within(form).getByLabelText('Name des Mandanten'), 'Probewerk Ost')
    await user.type(within(form).getByLabelText('Name der Leitung'), 'Anna Weber')
    await user.type(within(form).getByLabelText(/Adresse der Leitung/), 'anna@ost.example.de')
    await user.click(within(form).getByRole('button', { name: 'Mandant anlegen' }))

    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Den Mandanten gibt es schon.',
    )

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await user.click(within(form).getByRole('button', { name: 'Mandant anlegen' }))

    await waitFor(() => {
      expect(within(form).getByRole('alert').textContent).toBe('Der Mandant kam nicht zustande.')
    })
  })

  it('gives the form up without sending anything', async () => {
    server.answer('GET', '/instance/tenants', tenants)
    await area('/instanz')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Mandant anlegen' }))
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull()
    expect(sent('POST', '/instance/tenants')).toEqual([])
  })
})

const settings: InstanceSettingsView = {
  mailInternalHosts: ['mail.intern.example'],
  backupTime: '02:30',
  takenOverAt: '2026-09-27T14:05:00.000Z',
}

describe('the settings of the instance', () => {
  /**
   * The rule is the foundation's, with the name of the application in it; how
   * a tenant sends its mail and what the rule keeps it from are said in the
   * application's word for a tenant.
   */
  it('explain the rule for mail servers with the name of the application', async () => {
    server.answer('GET', '/instance/settings', settings)
    await area('/instanz/einstellungen')

    expect(
      await screen.findByText(
        'Ein Mandant schickt Mails über seinen Mailserver. Liegt der nicht im Internet, sondern im Netz dieser Instanz, lehnt Probewerk ihn ab, außer er steht hier. So kommt kein Mandant in das Netz dahinter.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Was für alle Mandanten gilt.')).toBeTruthy()
  })

  it('say where the mail servers came from, and save them one per line', async () => {
    server.answer('GET', '/instance/settings', settings)
    server.answer('PUT', '/instance/settings', {
      ...settings,
      mailInternalHosts: ['mail.intern.example', '192.168.1.20'],
    })
    await area('/instanz/einstellungen')
    const user = userEvent.setup()

    const hosts = await screen.findByLabelText('Freigegebene Mailserver')

    expect(
      screen.getByText(/Übernommen aus MAIL_INTERNAL_HOSTS in der .env am 27.09.2026/),
    ).toBeTruthy()

    await user.type(hosts, '\n 192.168.1.20 \n\nmail.intern.example')
    const panel = hosts.closest('form') as HTMLFormElement
    await user.click(within(panel).getByRole('button', { name: 'Speichern' }))

    expect(await within(panel).findByText('Gespeichert.')).toBeTruthy()
    expect(sent('PUT', '/instance/settings')).toEqual([
      { mailInternalHosts: ['mail.intern.example', '192.168.1.20'] },
    ])
  })

  it('say nothing of the .env where nothing was taken over from it', async () => {
    server.answer('GET', '/instance/settings', { ...settings, takenOverAt: null })
    await area('/instanz/einstellungen')

    expect(
      await screen.findByText('Einer je Zeile, als Name oder Adresse, ohne Port.'),
    ).toBeTruthy()
    expect(screen.queryByText(/MAIL_INTERNAL_HOSTS/)).toBeNull()
  })

  it('refuse a server with a port before anything goes out', async () => {
    server.answer('GET', '/instance/settings', settings)
    await area('/instanz/einstellungen')
    const user = userEvent.setup()

    const hosts = await screen.findByLabelText('Freigegebene Mailserver')

    await user.type(hosts, '\nmail.lan:25')

    expect(screen.getByText(/„mail.lan:25“ ist kein Servername/)).toBeTruthy()
    expect(
      (
        within(hosts.closest('form') as HTMLFormElement).getByRole('button', {
          name: 'Speichern',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('save the hour of the backup on its own', async () => {
    server.answer('GET', '/instance/settings', settings)
    server.answer('PUT', '/instance/settings', { ...settings, backupTime: '03:15' })
    await area('/instanz/einstellungen')
    const user = userEvent.setup()

    const time = await screen.findByLabelText('Uhrzeit')

    await user.clear(time)
    await user.type(time, '03:15')
    await user.click(
      within(time.closest('form') as HTMLFormElement).getByRole('button', { name: 'Speichern' }),
    )

    await waitFor(() => {
      expect(sent('PUT', '/instance/settings')).toEqual([{ backupTime: '03:15' }])
    })
  })

  it('say why they could not be saved', async () => {
    server.answer('GET', '/instance/settings', settings)
    server.answer('PUT', '/instance/settings', { message: 'Gerade nicht.' }, 503)
    await area('/instanz/einstellungen')
    const user = userEvent.setup()

    const time = await screen.findByLabelText('Uhrzeit')
    const panel = time.closest('form') as HTMLFormElement

    await user.clear(time)
    await user.type(time, '04:00')
    await user.click(within(panel).getByRole('button', { name: 'Speichern' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Gerade nicht.')
  })
})

const operators: readonly OperatorView[] = [
  {
    userId: 'u-1',
    name: 'Mia Mitglied',
    email: 'mia@nord.example.de',
    since: '2026-09-24T18:12:00.000Z',
    secondFactor: true,
  },
  {
    userId: 'u-2',
    name: 'Anna Weber',
    email: 'anna@nord.example.de',
    since: '2026-09-27T14:40:00.000Z',
    secondFactor: false,
  },
]

describe('whoever runs the instance', () => {
  it('is listed with the second factor, in the words of the application', async () => {
    server.answer('GET', '/instance/operators', operators)
    await area('/instanz/aufsicht')

    const table = await screen.findByRole('table', { name: 'Die Aufsicht dieser Instanz' })
    const rows = within(table).getAllByRole('row')

    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader')[0]?.textContent).toBe(
      'Person',
    )
    expect(rows[1]?.textContent).toContain('Eingerichtet')
    expect(rows[2]?.textContent).toContain('Fehlt')
    expect(screen.getByRole('heading', { level: 1, name: 'Aufsicht' })).toBeTruthy()
    expect(
      screen.getByText(
        'Ohne zweiten Faktor kommt niemand hierher; eingerichtet wird er unter „Konto“. Die letzte Aufsicht bleibt.',
      ),
    ).toBeTruthy()
  })

  it('takes nobody off who is looking, and somebody else only after asking', async () => {
    server.answer('GET', '/instance/operators', operators)
    server.answer('DELETE', '/instance/operators/u-2', { removed: 'u-2' })
    await area('/instanz/aufsicht')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Die Aufsicht dieser Instanz' })

    expect(
      (
        within(table).getByRole('button', {
          name: 'Mia Mitglied aus der Aufsicht nehmen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    await user.click(
      within(table).getByRole('button', { name: 'Anna Weber aus der Aufsicht nehmen' }),
    )

    const asking = await screen.findByRole('alertdialog', {
      name: 'Anna Weber aus der Aufsicht nehmen?',
    })

    expect(asking.textContent).toContain('Das Konto und seine Mandanten bleiben.')
    expect(sent('DELETE', '/instance/operators/u-2')).toEqual([])

    await user.click(within(asking).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(sent('DELETE', '/instance/operators/u-2')).toHaveLength(1)
    })
  })

  it('keeps the last one', async () => {
    server.answer('GET', '/instance/operators', [operators[1]])
    await area('/instanz/aufsicht')

    const table = await screen.findByRole('table', { name: 'Die Aufsicht dieser Instanz' })

    expect(
      (
        within(table).getByRole('button', {
          name: 'Anna Weber aus der Aufsicht nehmen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('says why somebody could not be taken off', async () => {
    server.answer('GET', '/instance/operators', operators)
    await area('/instanz/aufsicht')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Die Aufsicht dieser Instanz' })

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await user.click(
      within(table).getByRole('button', { name: 'Anna Weber aus der Aufsicht nehmen' }),
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Aus der Aufsicht nehmen ging nicht.',
    )
  })

  it('names an account that exists by its address', async () => {
    server.answer('GET', '/instance/operators', operators)
    server.answer('POST', '/instance/operators', {
      userId: 'u-3',
      name: 'Britta Bauer',
      email: 'britta@nord.example.de',
      since: '2026-09-27T15:00:00.000Z',
      secondFactor: false,
    })
    await area('/instanz/aufsicht')
    const user = userEvent.setup()

    const field = (await screen.findByLabelText('E-Mail des Kontos')) as HTMLInputElement

    expect(field.placeholder).toBe('name@probe.example')
    expect(screen.getByRole('region', { name: 'Zur Aufsicht machen' })).toBeTruthy()
    expect(
      screen.getByText('Zur Aufsicht wird ein Konto, das es auf dieser Instanz schon gibt.'),
    ).toBeTruthy()

    await user.type(field, 'britta')
    await user.click(screen.getByRole('button', { name: 'Benennen' }))
    expect(screen.getByText('Die E-Mail-Adresse sieht nicht wie eine aus.')).toBeTruthy()
    expect(sent('POST', '/instance/operators')).toEqual([])

    await user.type(field, '@nord.example.de')
    await user.click(screen.getByRole('button', { name: 'Benennen' }))

    expect(await screen.findByText('Britta Bauer gehört jetzt zur Aufsicht.')).toBeTruthy()
    expect(sent('POST', '/instance/operators')).toEqual([{ email: 'britta@nord.example.de' }])
    expect(field.value).toBe('')
  })
})
