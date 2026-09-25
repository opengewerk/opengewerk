import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button, Field } from '../components/index.js'
import { Gate } from './gate.js'

/**
 * The frame before sign in (#219), as the boards of the page "Vor der
 * Anmeldung" draw it: one heading in one card, the address the password goes
 * to, and fields and buttons in the sizes of the gate.
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
    at('https://msk.opengewerk.de/')
    const { unmount } = render(<Gate title="Anmelden">Inhalt</Gate>)

    expect(screen.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeTruthy()
    // Once in the head of a phone, once over the card at a desk.
    expect(screen.getAllByText('Verbunden mit')).toHaveLength(2)
    expect(screen.getAllByText('msk.opengewerk.de')).toHaveLength(2)
    unmount()

    at('http://127.0.0.1:23700/')
    render(<Gate title="Anmelden">Inhalt</Gate>)

    expect(screen.queryByText('Verbunden mit')).toBeNull()
    expect(screen.getAllByText('Unverschlüsselt verbunden mit')).toHaveLength(2)
  })

  it('gives fields and buttons the sizes of the gate', () => {
    render(
      <Gate title="Anmelden">
        <Field label="E-Mail" />
        <Button tone="primary" wide>
          Anmelden
        </Button>
        <Button tone="quiet" wide>
          Telefon nicht zur Hand? Wiederherstellungscode
        </Button>
      </Gate>,
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
