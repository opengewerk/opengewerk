import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationProvider, useApplication } from './application.js'
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
