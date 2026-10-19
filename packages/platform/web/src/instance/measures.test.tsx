import 'fake-indexeddb/auto'

import type { InstanceMeasuresView } from '@opengewerk/platform-domain'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InstanceFrame } from './frame.js'
import type { InstanceEntry } from './frame.js'
import { InstanceMeasuresScreen } from './measures.js'

/**
 * Part B of the measures and the subprocessors of the instance
 * (opengewerk-haustechnik#358), as the board "Maßnahmen der Instanz" of the
 * page "Bereich der Instanz" draws them: the sections B.1 to B.9 with their
 * fields, the subprocessors as rows to fill in, and one "Speichern" for all.
 *
 * The application here belongs to nobody (ADR 0010); what the screen is for
 * and for whom it holds it says in its own words.
 */

let server: StandIn

const navigation: readonly InstanceEntry[] = [
  { to: '/instanz/massnahmen', label: 'Maßnahmen', icon: Lock },
]

async function area() {
  const frame = (): ReactNode => <InstanceFrame navigation={navigation} />

  return inFrame(frame, {
    at: '/instanz/massnahmen',
    screens: {
      '/': () => <h1>Regale</h1>,
      '/instanz/massnahmen': () => <InstanceMeasuresScreen />,
    },
  })
}

function sent(): unknown[] {
  return server.heard
    .filter((call) => call.method === 'PUT' && call.path === '/instance/measures')
    .map((call) => call.body)
}

const server1 = {
  name: 'Rechenbetrieb Nord GmbH, Hafenweg 1',
  service: 'Server',
  place: 'Deutschland',
}

const kept: InstanceMeasuresView = {
  measures: { serverPlace: 'Deutschland, Nürnberg', accessFirewall: true },
  subprocessors: [server1],
  changedAt: '2026-10-18T07:10:00.000Z',
  changedBy: 'Anna Abel',
}

const save = () => screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement

beforeEach(() => {
  server = standInServer()
  signedIn(server, [aTenant({ name: 'Probewerk Nord' })])
  server.answer('GET', '/instance/access', { operator: true, secondFactor: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the measures of the instance', () => {
  it('show part B as kept, the subprocessors as rows, and when and by whom they were changed', async () => {
    server.answer('GET', '/instance/measures', kept)
    await area()

    expect(
      (
        (await screen.findByRole('textbox', {
          name: 'Land und Ort des Servers',
        })) as HTMLInputElement
      ).value,
    ).toBe('Deutschland, Nürnberg')
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'eine Firewall lässt nur die nötigen Ports durch',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'die Datenträger des Servers sind verschlüsselt',
        }) as HTMLInputElement
      ).checked,
    ).toBe(false)
    expect(screen.getByRole('heading', { name: 'B.9 Weitere Maßnahmen' })).toBeTruthy()

    const row = screen.getByRole('group', { name: '1. Unterauftragsverarbeiter' })

    expect((within(row).getByRole('textbox', { name: 'Leistung' }) as HTMLInputElement).value).toBe(
      'Server',
    )
    expect(
      screen.getByText('Teil B und die Unterauftragsverarbeiter, für jeden Mandanten gleich.'),
    ).toBeTruthy()
    expect(screen.getByText('Zuletzt geändert am 18.10.2026 von Anna Abel.')).toBeTruthy()
  })

  it('save all of it at once: a new box, a new row, and a row taken out', async () => {
    server.answer('GET', '/instance/measures', kept)
    server.answer('PUT', '/instance/measures', {
      ...kept,
      measures: { ...kept.measures, encryptionDisks: true },
      subprocessors: [
        { name: 'Speicher Süd AG, Am Hafen 7', service: 'Sicherungen', place: 'Deutschland' },
      ],
      changedAt: '2026-10-19T08:00:00.000Z',
    })
    await area()
    const user = userEvent.setup()

    await screen.findByRole('textbox', { name: 'Land und Ort des Servers' })
    // Nothing to save before anything changed.
    expect(save().disabled).toBe(true)

    await user.click(
      screen.getByRole('checkbox', { name: 'die Datenträger des Servers sind verschlüsselt' }),
    )
    await user.click(screen.getByRole('button', { name: '1. Unterauftragsverarbeiter entfernen' }))
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    const row = screen.getByRole('group', { name: '1. Unterauftragsverarbeiter' })

    await user.type(
      within(row).getByRole('textbox', { name: 'Name und Anschrift' }),
      'Speicher Süd AG, Am Hafen 7',
    )
    await user.type(within(row).getByRole('textbox', { name: 'Leistung' }), 'Sicherungen')
    await user.type(
      within(row).getByRole('textbox', { name: 'Ort der Verarbeitung' }),
      'Deutschland',
    )
    await user.click(save())

    expect(await screen.findByText('Gespeichert.')).toBeTruthy()
    expect(sent()).toEqual([
      {
        measures: {
          serverPlace: 'Deutschland, Nürnberg',
          accessFirewall: true,
          encryptionDisks: true,
        },
        subprocessors: [
          { name: 'Speicher Süd AG, Am Hafen 7', service: 'Sicherungen', place: 'Deutschland' },
        ],
      },
    ])
  })

  it('take a tick back without a change, and send a box left empty as nothing', async () => {
    server.answer('GET', '/instance/measures', kept)
    server.answer('PUT', '/instance/measures', {
      ...kept,
      measures: { serverPlace: 'Deutschland, Nürnberg' },
    })
    await area()
    const user = userEvent.setup()
    const firewall = await screen.findByRole('checkbox', {
      name: 'eine Firewall lässt nur die nötigen Ports durch',
    })
    const disks = screen.getByRole('checkbox', {
      name: 'die Datenträger des Servers sind verschlüsselt',
    })

    await user.click(disks)
    await user.click(disks)
    expect(save().disabled).toBe(true)

    await user.click(firewall)
    await user.click(save())

    expect(await screen.findByText('Gespeichert.')).toBeTruthy()
    expect(sent()).toEqual([
      { measures: { serverPlace: 'Deutschland, Nürnberg' }, subprocessors: [server1] },
    ])
  })

  it('send nothing while a row lacks a field, and say which', async () => {
    server.answer('GET', '/instance/measures', kept)
    await area()
    const user = userEvent.setup()

    await screen.findByRole('textbox', { name: 'Land und Ort des Servers' })
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }))
    await user.type(
      within(screen.getByRole('group', { name: '2. Unterauftragsverarbeiter' })).getByRole(
        'textbox',
        {
          name: 'Name und Anschrift',
        },
      ),
      'Post Nord GmbH',
    )
    await user.click(save())

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Beim 2. Unterauftragsverarbeiter fehlt „Leistung“.',
    )
    expect(sent()).toEqual([])
  })

  it('say so while part B was never filled in', async () => {
    server.answer('GET', '/instance/measures', {
      measures: {},
      subprocessors: [],
      changedAt: null,
      changedBy: null,
    })
    await area()

    expect(await screen.findByText('Noch nicht ausgefüllt.')).toBeTruthy()
    expect(screen.getByText('Noch keine eingetragen.')).toBeTruthy()
  })
})
