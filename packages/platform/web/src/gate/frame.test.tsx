import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button } from '../components/button.js'
import { Field } from '../components/field.js'
import { InProbe } from '../probe-application.js'
import { Gate, InstanceVersion } from './frame.js'

/**
 * The frame before sign in (#219), as the boards of the page "Vor der
 * Anmeldung" draw it: one heading in one card, the address the password goes
 * to, and fields and buttons in the sizes of the gate.
 *
 * What stands beside the card is the application's (ADR 0010): what it is
 * called, what it says of itself and under which licence it is. The tests
 * here run with an application that belongs to nobody, so that a word found
 * on the screen can only have come from the value over it.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function at(address: string) {
  const url = new URL(address)

  vi.stubGlobal('location', { ...globalThis.location, host: url.host, protocol: url.protocol })
}

describe('the gate before sign in', () => {
  it('names the address the password goes to, with the lock only over an encrypted connection', () => {
    at('https://probewerk.example.de/')
    const { unmount } = render(
      <InProbe>
        <Gate title="Anmelden">Inhalt</Gate>
      </InProbe>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeTruthy()
    // Once in the head of a phone, once over the card at a desk.
    expect(screen.getAllByText('Verbunden mit')).toHaveLength(2)
    expect(screen.getAllByText('probewerk.example.de')).toHaveLength(2)
    unmount()

    at('http://127.0.0.1:23700/')
    render(
      <InProbe>
        <Gate title="Anmelden">Inhalt</Gate>
      </InProbe>,
    )

    expect(screen.queryByText('Verbunden mit')).toBeNull()
    expect(screen.getAllByText('Unverschlüsselt verbunden mit')).toHaveLength(2)
  })

  it('says of the application what the application says of itself, and nothing else', () => {
    render(
      <InProbe>
        <Gate title="Anmelden">Inhalt</Gate>
      </InProbe>,
    )

    // The name once in the head of a phone and once beside the card at a desk.
    expect(screen.getAllByText('Probewerk')).toHaveLength(2)

    // The whole of what stands beside the card: the name, the two sentences
    // and the licence, with nothing of the foundation's own between them.
    expect(screen.getByRole('complementary').textContent).toBe(
      'Probewerk' +
        'Regale, Notizen und Pakete an einem Ort.' +
        'Diese Instanz läuft nur in Tests und gehört niemandem.' +
        'Probelizenz 1.0',
    )
  })

  it('names the version beside the licence, and the licence alone without one (#259)', () => {
    const { unmount } = render(
      <InProbe>
        <InstanceVersion.Provider value="0.2.0">
          <Gate title="Anmelden">Inhalt</Gate>
        </InstanceVersion.Provider>
      </InProbe>,
    )

    expect(screen.getByText('Probelizenz 1.0 · Version 0.2.0')).toBeTruthy()
    unmount()

    render(
      <InProbe>
        <Gate title="Anmelden">Inhalt</Gate>
      </InProbe>,
    )

    expect(screen.getByText('Probelizenz 1.0')).toBeTruthy()
    expect(screen.queryByText(/Version/)).toBeNull()
  })

  it('shows what a step puts over its card, after the address and before the card', () => {
    render(
      <InProbe>
        <Gate title="Anmelden" before={<p role="note">Danach öffnet sich das Regal.</p>}>
          Inhalt
        </Gate>
      </InProbe>,
    )

    const note = screen.getByRole('note')
    const card = screen.getByRole('region', { name: 'Anmelden' })

    expect(screen.getByRole('main').contains(note)).toBe(true)
    expect(note.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('gives fields and buttons the sizes of the gate', () => {
    render(
      <InProbe>
        <Gate title="Anmelden">
          <Field label="E-Mail" />
          <Button tone="primary" wide>
            Anmelden
          </Button>
          <Button tone="quiet" wide>
            Telefon nicht zur Hand? Wiederherstellungscode
          </Button>
        </Gate>
      </InProbe>,
    )

    // 52 pixels on a phone and 42 at a desk, not the 34 of the office.
    expect(screen.getByLabelText('E-Mail').className).toContain('h-13')
    expect(screen.getByLabelText('E-Mail').className).toContain('lg:h-[42px]')
    expect(screen.getByRole('button', { name: 'Anmelden' }).className).toContain('lg:min-h-[46px]')
    // The quiet one is a line of text at the left, never the width of the card.
    expect(
      screen.getByRole('button', { name: 'Telefon nicht zur Hand? Wiederherstellungscode' })
        .className,
    ).not.toContain('w-full')
  })
})
