import 'fake-indexeddb/auto'

import type {
  AuditChange,
  InstanceLegalTextsView,
  InstanceLogPage,
} from '@opengewerk/platform-domain'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { FileText, History } from 'lucide-react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InstanceFrame } from './frame.js'
import type { InstanceEntry } from './frame.js'
import { InstanceLegalTextsScreen } from './legal-texts.js'
import { InstanceLogScreen } from './log.js'

/**
 * The legal texts of the instance (opengewerk-haustechnik#129), as the board
 * "Rechtstexte der Instanz" of the page "Bereich der Instanz" draws them: two
 * texts, each saved on its own, with when and by whom it was last changed,
 * and a word of warning while no legal notice is kept.
 *
 * The application here belongs to nobody (ADR 0010); for whom the legal
 * notice holds it says in its word for a tenant.
 */

let server: StandIn

const navigation: readonly InstanceEntry[] = [
  { to: '/instanz/rechtstexte', label: 'Rechtstexte', icon: FileText },
  { to: '/instanz/protokoll', label: 'Protokoll', icon: History },
]

async function area(at: string) {
  const frame = (): ReactNode => <InstanceFrame navigation={navigation} />

  return inFrame(frame, {
    at,
    screens: {
      '/': () => <h1>Regale</h1>,
      '/instanz/rechtstexte': () => <InstanceLegalTextsScreen />,
      '/instanz/protokoll': () => <InstanceLogScreen />,
    },
  })
}

function sent(method: string, path: string): unknown[] {
  return server.heard
    .filter((call) => call.method === method && call.path === path)
    .map((call) => call.body)
}

const kept: InstanceLegalTextsView = {
  imprint: {
    text: '**Probewerk GmbH**\nAm Probehang 4',
    changedAt: '2026-10-02T07:10:00.000Z',
    changedBy: 'Anna Abel',
  },
  privacy: { text: null, changedAt: null, changedBy: null },
}

/** The field of a text: the panel it stands in is called the same. */
function fieldOf(label: string): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement
}

/** The panel a text stands in, found by its field. */
async function panelOf(label: string): Promise<HTMLElement> {
  return (await screen.findByRole('textbox', { name: label })).closest('form') as HTMLElement
}

beforeEach(() => {
  server = standInServer()
  signedIn(server, [aTenant({ name: 'Probewerk Nord' })])
  server.answer('GET', '/instance/access', { operator: true, secondFactor: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the legal texts of the instance', () => {
  it('show each text with when and by whom it was last changed, and where the legal notice stands', async () => {
    server.answer('GET', '/instance/legal-texts', kept)
    await area('/instanz/rechtstexte')

    const imprint = await panelOf('Impressum')

    expect(fieldOf('Impressum').value).toBe('**Probewerk GmbH**\nAm Probehang 4')
    expect(within(imprint).getByText('Zuletzt geändert am 02.10.2026 von Anna Abel.')).toBeTruthy()
    expect(
      within(imprint).getByText(
        'Steht im Fuß der Anmeldung und ist ohne Anmeldung zu lesen. Er gilt für alle Mandanten.',
      ),
    ).toBeTruthy()
    expect(
      within(await panelOf('Datenschutzhinweise')).getByText(
        'Ein leerer Text blendet den Link im Fuß aus.',
      ),
    ).toBeTruthy()
  })

  it('say so while no legal notice is kept', async () => {
    server.answer('GET', '/instance/legal-texts', {
      ...kept,
      imprint: { text: null, changedAt: null, changedBy: null },
    })
    await area('/instanz/rechtstexte')

    expect(
      within(await panelOf('Impressum')).getByText(
        'Noch ist kein Impressum hinterlegt, und im Fuß der Anmeldung fehlt der Link dazu.',
      ),
    ).toBeTruthy()
  })

  it('save one text on its own, and leave the other one out of the request', async () => {
    server.answer('GET', '/instance/legal-texts', kept)
    server.answer('PUT', '/instance/legal-texts', {
      ...kept,
      privacy: {
        text: 'Verantwortlich ist die Probewerk GmbH.',
        changedAt: '2026-10-14T08:00:00.000Z',
        changedBy: 'Anna Abel',
      },
    })
    await area('/instanz/rechtstexte')
    const user = userEvent.setup()
    const privacy = await panelOf('Datenschutzhinweise')
    const save = within(privacy).getByRole('button', { name: 'Speichern' })

    // Nothing to save before anything was typed.
    expect((save as HTMLButtonElement).disabled).toBe(true)

    await user.type(fieldOf('Datenschutzhinweise'), 'Verantwortlich ist die Probewerk GmbH.')
    await user.click(save)

    expect(await within(privacy).findByText('Gespeichert.')).toBeTruthy()
    expect(sent('PUT', '/instance/legal-texts')).toEqual([
      { privacy: 'Verantwortlich ist die Probewerk GmbH.' },
    ])
  })

  it('take a text off when it is emptied, by sending it empty', async () => {
    server.answer('GET', '/instance/legal-texts', kept)
    server.answer('PUT', '/instance/legal-texts', {
      ...kept,
      imprint: { text: null, changedAt: '2026-10-14T08:00:00.000Z', changedBy: 'Anna Abel' },
    })
    await area('/instanz/rechtstexte')
    const user = userEvent.setup()
    const imprint = await panelOf('Impressum')

    await user.clear(fieldOf('Impressum'))
    await user.click(within(imprint).getByRole('button', { name: 'Speichern' }))

    expect(await within(imprint).findByText('Gespeichert.')).toBeTruthy()
    expect(sent('PUT', '/instance/legal-texts')).toEqual([{ imprint: '' }])
  })

  it('show the text as the page will, as text and never as HTML', async () => {
    server.answer('GET', '/instance/legal-texts', {
      ...kept,
      imprint: { ...kept.imprint, text: '# Impressum\n\n<b>fett</b> und **fett**' },
    })
    await area('/instanz/rechtstexte')
    const user = userEvent.setup()
    const imprint = await panelOf('Impressum')

    await user.click(within(imprint).getByRole('button', { name: 'Vorschau' }))

    const preview = within(imprint).getByRole('region', { name: 'Vorschau: Impressum' })

    expect(within(preview).getByRole('heading', { name: 'Impressum' })).toBeTruthy()
    expect(within(preview).getByText('fett', { selector: 'strong' })).toBeTruthy()
    expect(preview.textContent).toContain('<b>fett</b>')
    expect(preview.querySelector('b')).toBeNull()
  })

  it('refuse a text that is too long before it is sent', async () => {
    server.answer('GET', '/instance/legal-texts', kept)
    await area('/instanz/rechtstexte')
    const privacy = await panelOf('Datenschutzhinweise')
    const field = fieldOf('Datenschutzhinweise')
    const user = userEvent.setup()

    await user.click(field)
    await user.paste('x'.repeat(40_001))

    expect(within(privacy).getByText('Höchstens 40.000 Zeichen.')).toBeTruthy()
    expect(
      (within(privacy).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('a change of the legal texts in the log of the instance', () => {
  it('is named as the screen names them, with the way it was made', async () => {
    const change: AuditChange = {
      changeId: 'c-1',
      changedAt: '2026-10-02T07:10:00.000Z',
      operation: 'update',
      table: 'instance_settings',
      recordId: '1',
      userId: 'u-1',
      deviceId: null,
      reason: 'instance.legal',
      databaseRole: 'opengewerk_app',
      firstSequence: 0,
      lastSequence: 0,
      fields: [{ field: 'imprint', before: null, after: '**Probewerk GmbH**\nAm Probehang 4' }],
    }
    const log: InstanceLogPage = {
      changes: [change],
      next: null,
      titles: { '1': { table: 'instance_settings', field: null, title: null, kind: null } },
      people: { 'u-1': 'Anna Abel' },
      devices: {},
    }

    server.answer('GET', '/instance/log', log)
    await area('/instanz/protokoll')

    const table = await screen.findByRole('table', { name: 'Änderungen an der Instanz' })
    const row = within(table).getAllByRole('row')[1]

    expect(row?.textContent).toContain('Rechtstexte der Instanz')
    expect(row?.textContent).toContain('Impressum neu')
    expect(row?.textContent).toContain('Rechtstexte ändern')
  })
})
