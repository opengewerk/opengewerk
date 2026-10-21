import 'fake-indexeddb/auto'

import type { InstanceCertificateView } from '@opengewerk/platform-domain'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InstanceFrame } from './frame.js'
import { InstanceSettingsScreen } from './settings.js'

/**
 * The card "Signatur der PDFs" among the settings of the instance
 * (opengewerk-haustechnik#457, board `HT-Instanz-Einstellungen`): there only
 * where the application signs, the certificate with its fingerprint, and a
 * new key only after asking.
 */

let server: StandIn

const certificate: InstanceCertificateView = {
  commonName: 'instanz.example.de',
  organisation: 'Probewerk',
  fingerprint:
    '3A:5F:91:0C:7E:B2:44:D8:6A:13:F0:2C:9B:57:E4:81:0D:C6:72:3F:A9:18:5B:E0:47:BC:26:93:F1:6D:08:C2',
  validFrom: '2026-10-21T07:13:00.000Z',
  validTo: '2046-10-21T07:13:00.000Z',
  since: '2026-10-21T07:14:00.000Z',
  readable: true,
  earlier: 0,
}

async function settings() {
  const frame = (): ReactNode => (
    <InstanceFrame
      navigation={[{ to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings }]}
    />
  )

  await inFrame(frame, {
    at: '/instanz/einstellungen',
    screens: { '/instanz/einstellungen': () => <InstanceSettingsScreen /> },
  })

  return userEvent.setup()
}

async function card(): Promise<HTMLElement> {
  return (await screen.findByText('Zertifikat für')).closest('section') as HTMLElement
}

function sent(method: string, path: string): unknown[] {
  return server.heard.filter((call) => call.method === method && call.path === path)
}

beforeEach(() => {
  server = standInServer()
  signedIn(server, [aTenant({ name: 'Probewerk Nord' })])
  server.answer('GET', '/instance/access', { operator: true, secondFactor: true })
  server.answer('GET', '/instance/settings', {
    mailInternalHosts: [],
    backupTime: '02:30',
    takenOverAt: null,
  })
  server.answer('GET', '/instance/mail-server', { sends: true, server: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the signature of the PDFs among the settings of the instance', () => {
  it('is not there where the application signs no PDF', async () => {
    server.answer('GET', '/instance/signing', { signs: false, certificate: null })
    await settings()

    await screen.findByText('Nächtliche Sicherung')
    await waitFor(() => {
      expect(sent('GET', '/instance/signing')).toHaveLength(1)
    })
    expect(screen.queryByText('Signatur der PDFs')).toBeNull()
  })

  it('shows the certificate with its fingerprint, and whether the kept key still opens', async () => {
    server.answer('GET', '/instance/signing', {
      signs: true,
      certificate: { ...certificate, readable: false, earlier: 2 },
    })
    await settings()

    const shown = await card()

    expect(within(shown).getByText('instanz.example.de, Probewerk')).toBeTruthy()
    expect(within(shown).getByText(certificate.fingerprint)).toBeTruthy()
    expect(within(shown).getByText('21.10.2026 bis 21.10.2046')).toBeTruthy()
    expect(within(shown).getByText('2')).toBeTruthy()
    expect(within(shown).getByRole('note').textContent).toContain('SESSION_SECRET')
  })

  it('makes a new key only after asking, and shows what came back', async () => {
    server.answer('GET', '/instance/signing', { signs: true, certificate })
    server.answer('POST', '/instance/signing', {
      signs: true,
      certificate: { ...certificate, fingerprint: 'AA:BB', earlier: 1 },
    })

    const user = await settings()
    const shown = await card()

    await user.click(within(shown).getByRole('button', { name: 'Neuen Schlüssel erzeugen' }))

    const asking = within(await screen.findByRole('alertdialog'))

    expect(sent('POST', '/instance/signing')).toEqual([])

    await user.click(asking.getByRole('button', { name: 'Erzeugen' }))

    expect(await within(shown).findByText('AA:BB')).toBeTruthy()
    expect(sent('POST', '/instance/signing')).toHaveLength(1)
  })

  it('offers to make the first key while there is none', async () => {
    server.answer('GET', '/instance/signing', { signs: true, certificate: null })
    server.answer('POST', '/instance/signing', { signs: true, certificate })

    const user = await settings()

    await user.click(await screen.findByRole('button', { name: 'Schlüssel erzeugen' }))

    expect(await screen.findByText(certificate.fingerprint)).toBeTruthy()
    expect(sent('POST', '/instance/signing')).toHaveLength(1)
  })
})
