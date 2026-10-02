import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DocumentState } from './document-state.js'

describe('the state of a document', () => {
  it('shows a number once there is one, and none while there is not', () => {
    const { rerender } = render(<DocumentState status="draft" />)
    expect(screen.getByText('Entwurf')).toBeDefined()

    rerender(<DocumentState status="issued" number="RE-2026-0231" />)
    expect(screen.getByText('Festgeschrieben')).toBeDefined()
    expect(screen.getByText('RE-2026-0231')).toBeDefined()
  })
})
