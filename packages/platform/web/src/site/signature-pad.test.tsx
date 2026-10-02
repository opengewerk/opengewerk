import { longestSignaturePath, signaturePathIsValid } from '@opengewerk/platform-domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SignaturePicture } from '../components/signature.js'
import { SignaturePad } from './signature-pad.js'

/**
 * The pad somebody signs on, with a finger or a pen: what it draws, what it
 * says to the screen around it, and when it stops taking strokes.
 */

/** The pad, with what it told the screen around it. */
function pad() {
  const said: (string | null)[] = []

  render(<SignaturePad label="Unterschriftsfeld" onChange={(path) => said.push(path)} />)

  return { said, field: screen.getByRole('img', { name: 'Unterschriftsfeld' }) }
}

/**
 * The pad, measured as if it stood on the screen at this size; happy-dom
 * measures every element at nothing. Returns the pointers it captured.
 */
function measured(field: Element, width = 500, height = 200): number[] {
  const captured: number[] = []

  Object.assign(field, {
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width,
      height,
      right: 10 + width,
      bottom: 20 + height,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }),
    setPointerCapture: (pointerId: number) => captured.push(pointerId),
  })

  return captured
}

function drawn(field: Element): string | null {
  return field.querySelector('path')?.getAttribute('d') ?? null
}

/** The pad is 500 by 200 pixels at (10, 20), half the box: a point is twice its pixels. */
function at(x: number, y: number) {
  return { clientX: 10 + x, clientY: 20 + y }
}

describe('the pad', () => {
  it('is a field to sign in, with its hint, and nothing to clear yet', () => {
    const { field } = pad()

    expect(field.getAttribute('viewBox')).toBe('0 0 1000 400')
    expect(field.getAttribute('aria-describedby')).toBe(
      screen.getByText('Mit dem Finger oder einem Stift im Feld unterschreiben.').id,
    )
    // Without it, a stroke down the pad scrolls the page on a phone.
    expect(field.getAttribute('class')).toContain('touch-none')
    expect(drawn(field)).toBe('')
    expect(field.querySelector('line')).not.toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Feld leeren' }).disabled).toBe(
      true,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('draws in the units of the box, and says the path when a stroke ends', () => {
    const { said, field } = pad()

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(50, 150) })
    fireEvent.pointerMove(field, { pointerId: 1, ...at(120, 60) })
    fireEvent.pointerMove(field, { pointerId: 1, ...at(200, 140) })

    expect(drawn(field)).toBe('M100,300L240,120L400,280')
    // Not on every movement of the finger.
    expect(said).toEqual([])

    fireEvent.pointerUp(field, { pointerId: 1, ...at(200, 140) })
    fireEvent.pointerDown(field, { pointerId: 2, ...at(260, 130) })
    fireEvent.pointerMove(field, { pointerId: 2, ...at(320, 90) })
    fireEvent.pointerUp(field, { pointerId: 2, ...at(320, 90) })

    expect(said).toEqual(['M100,300L240,120L400,280', 'M100,300L240,120L400,280M520,260L640,180'])
    expect(drawn(field)).toBe('M100,300L240,120L400,280M520,260L640,180')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Feld leeren' }).disabled).toBe(
      false,
    )
  })

  it('keeps the page where it is, and the stroke going past the edge of the pad', () => {
    const { said, field } = pad()
    const captured = measured(field)

    // `fireEvent` answers false when the pad kept the browser from its own
    // handling of the press.
    expect(fireEvent.pointerDown(field, { pointerId: 7, ...at(400, 100) })).toBe(false)
    expect(captured).toEqual([7])

    fireEvent.pointerMove(field, { pointerId: 7, ...at(640, 260) })
    fireEvent.pointerUp(field, { pointerId: 7, ...at(640, 260) })

    expect(said).toEqual(['M800,200L1000,400'])
  })

  it('draws a tap as a dot', () => {
    const { said, field } = pad()

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(100, 50) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(100, 50) })

    expect(said).toEqual(['M200,100L200,100'])
  })

  it('leaves out a step shorter than a few units', () => {
    const { said, field } = pad()

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerMove(field, { pointerId: 1, ...at(101, 100) })
    fireEvent.pointerMove(field, { pointerId: 1, ...at(102, 100) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(102, 100) })

    expect(said).toEqual(['M200,200L204,200'])
  })

  it('follows the finger that started the stroke and no other', () => {
    const { said, field } = pad()

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerMove(field, { pointerId: 2, ...at(300, 100) })
    fireEvent.pointerUp(field, { pointerId: 2, ...at(300, 100) })

    expect(said).toEqual([])
    expect(drawn(field)).toBe('M200,200L200,200')

    fireEvent.pointerMove(field, { pointerId: 1, ...at(150, 100) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(150, 100) })

    expect(said).toEqual(['M200,200L300,200'])
  })

  it('ends a stroke the browser cancels as one that was lifted', () => {
    const { said, field } = pad()

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerMove(field, { pointerId: 1, ...at(150, 100) })
    fireEvent.pointerCancel(field, { pointerId: 1, ...at(150, 100) })
    fireEvent.pointerMove(field, { pointerId: 1, ...at(200, 100) })

    expect(said).toEqual(['M200,200L300,200'])
    expect(drawn(field)).toBe('M200,200L300,200')
  })

  it('draws nothing while it has no size, and leaves the press to the browser', () => {
    const { said, field } = pad()
    const captured = measured(field, 0, 0)

    expect(fireEvent.pointerDown(field, { pointerId: 1, ...at(10, 10) })).toBe(true)
    fireEvent.pointerMove(field, { pointerId: 1, ...at(50, 50) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(50, 50) })

    expect(captured).toEqual([])
    expect(said).toEqual([])
    expect(drawn(field)).toBe('')
  })

  it('is cleared on demand, and says so', async () => {
    const { said, field } = pad()

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(100, 100) })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Feld leeren' }))

    expect(said).toEqual(['M200,200L200,200', null])
    expect(drawn(field)).toBe('')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Feld leeren' }).disabled).toBe(
      true,
    )

    // A stroke after clearing starts a new signature, not the old one again.
    fireEvent.pointerDown(field, { pointerId: 2, ...at(300, 100) })
    fireEvent.pointerUp(field, { pointerId: 2, ...at(300, 100) })

    expect(said.at(-1)).toBe('M600,200L600,200')
  })

  it('stops at the length one signature may have, keeps what is drawn, and starts over when cleared', async () => {
    const { said, field } = pad()

    measured(field, 1000, 400)
    fireEvent.pointerDown(field, { pointerId: 1, clientX: 10 + 990, clientY: 20 + 390 })

    for (let step = 0; step < 4800; step += 1) {
      fireEvent.pointerMove(field, {
        pointerId: 1,
        clientX: 10 + (step % 2 === 0 ? 1000 : 990),
        clientY: 20 + 390 + (step % 3) * 5,
      })
    }

    fireEvent.pointerUp(field, { pointerId: 1, clientX: 1010, clientY: 420 })

    expect(screen.getByRole('status').textContent).toBe(
      'Das Feld ist voll. Was bis hierher gezeichnet ist, gilt; zum Neuanfang das Feld leeren.',
    )

    const kept = said.at(-1) ?? ''

    expect(said).toHaveLength(1)
    // These strokes come to exactly the length one signature may have: that
    // much is still kept, and not a character more.
    expect(kept.length).toBe(longestSignaturePath)
    expect(signaturePathIsValid(kept)).toBe(true)
    expect(drawn(field)).toBe(kept)

    // Not even a dot more.
    fireEvent.pointerDown(field, { pointerId: 2, ...at(100, 100) })
    fireEvent.pointerUp(field, { pointerId: 2, ...at(100, 100) })

    expect(said.at(-1)).toBe(kept)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Feld leeren' }))

    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.pointerDown(field, { pointerId: 3, clientX: 110, clientY: 120 })
    fireEvent.pointerUp(field, { pointerId: 3, clientX: 110, clientY: 120 })

    expect(said.at(-1)).toBe('M100,100L100,100')
  }, 60_000)

  it('draws with the stroke the picture of a signature is shown with', () => {
    const { field } = pad()

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(100, 100) })

    render(<SignaturePicture path="M200,200L200,200" label="Bild" />)

    const picture = screen.getByRole('img', { name: 'Bild' })
    const stroke = (element: Element) =>
      ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'].map((name) =>
        element.querySelector('path')?.getAttribute(name),
      )

    expect(stroke(field)).toEqual(['none', 'currentColor', '5', 'round', 'round'])
    expect(stroke(picture)).toEqual(stroke(field))
    expect(picture.getAttribute('viewBox')).toBe(field.getAttribute('viewBox'))
  })

  it('is not told twice about one stroke', () => {
    const changes = vi.fn()

    render(<SignaturePad label="Feld" onChange={changes} />)

    const field = screen.getByRole('img', { name: 'Feld' })

    measured(field)
    fireEvent.pointerDown(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerUp(field, { pointerId: 1, ...at(100, 100) })
    fireEvent.pointerCancel(field, { pointerId: 1, ...at(100, 100) })

    expect(changes).toHaveBeenCalledTimes(1)
  })
})
