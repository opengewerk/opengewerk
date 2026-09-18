import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

// Before anyone writes the first screen, the scaffold proves that a component
// can be rendered and queried. Otherwise whoever writes it first pays for
// setting up the environment on top of their actual work. The component below
// exists for this test and nowhere else.
function Greeting({ name }: { name: string }) {
  const [greeted] = useState(() => `Hallo ${name}`)

  return <p>{greeted}</p>
}

describe('rendering', () => {
  it('renders a component into the test document', () => {
    render(<Greeting name="Welt" />)

    expect(screen.getByText('Hallo Welt')).toBeDefined()
  })
})
