import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ApplicationProvider,
  useApplication,
  useInstanceSentences,
  useStaffSentences,
} from './application.js'
import { probeApplication } from './probe-application.js'

/**
 * What an application says of itself reaches a screen of the foundation one
 * way: through the value over it (ADR 0010). A screen under none has no name
 * and no sentence to show, and has to say so. A name of its own to fall back
 * on would be the name of some application, shown in every other.
 */

function Named() {
  const application = useApplication()

  return <p>{application.name}</p>
}

describe('what an application says of itself', () => {
  it('reaches a screen from the value over it', () => {
    render(
      <ApplicationProvider application={probeApplication({ name: 'Probewerk Zwei' })}>
        <Named />
      </ApplicationProvider>,
    )

    expect(screen.getByText('Probewerk Zwei')).toBeTruthy()
  })

  it('is the nearest one, where one stands inside another', () => {
    render(
      <ApplicationProvider application={probeApplication({ name: 'Außen' })}>
        <ApplicationProvider application={probeApplication({ name: 'Innen' })}>
          <Named />
        </ApplicationProvider>
      </ApplicationProvider>,
    )

    expect(screen.getByText('Innen')).toBeTruthy()
    expect(screen.queryByText('Außen')).toBeNull()
  })

  it('is missing for a screen outside of any, which says so and shows no name of its own', () => {
    // React logs what a component threw before it hands it on.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => render(<Named />)).toThrow(
        'Diese Ansicht braucht die Angaben der Anwendung und steht außerhalb davon.',
      )
    } finally {
      logged.mockRestore()
    }
  })
})

function Staffed() {
  return <p>{useStaffSentences().what}</p>
}

function Instanced() {
  return <p>{useInstanceSentences().what}</p>
}

/**
 * "Zugänge" and the area of the instance only stand in the office, and their
 * sentences come only with the value the office hands in: a phone on site
 * does not load what it never shows. A screen of the two in an entry without
 * them has nothing to say, and says so.
 */
describe('the sentences of the screens only one entry shows', () => {
  it('reach those screens from the value of the entry that hands them in', () => {
    render(
      <ApplicationProvider application={probeApplication()}>
        <Staffed />
        <Instanced />
      </ApplicationProvider>,
    )

    expect(screen.getByText('Wer im Mandanten mitarbeitet.')).toBeTruthy()
    expect(screen.getByText('Was alle Mandanten dieser Instanz teilen.')).toBeTruthy()
  })

  it('are missing in an entry that does not hand them in, which the screen says', () => {
    const { staff: _staff, instance: _instance, ...shared } = probeApplication().sentences
    const elsewhere = probeApplication({ sentences: shared })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() =>
        render(
          <ApplicationProvider application={elsewhere}>
            <Staffed />
          </ApplicationProvider>,
        ),
      ).toThrow('Diese Ansicht braucht Sätze der Anwendung, die dieser Einstieg nicht mitbringt.')
      expect(() =>
        render(
          <ApplicationProvider application={elsewhere}>
            <Instanced />
          </ApplicationProvider>,
        ),
      ).toThrow('Diese Ansicht braucht Sätze der Anwendung, die dieser Einstieg nicht mitbringt.')
    } finally {
      logged.mockRestore()
    }
  })
})
