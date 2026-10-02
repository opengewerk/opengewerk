import { longestSignaturePath } from '@opengewerk/platform-domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SignaturePicture } from './signature.js'

/**
 * A signature as it was drawn, in both entries: on a screen of the office in
 * a box, on site under the page that was signed.
 */

describe('the picture of a signature', () => {
  it('is the path as it was drawn, in the box every signature is drawn in', () => {
    render(<SignaturePicture path="M100,300L240,120L400,280" label="Unterschrift von Erika Berg" />)

    const picture = screen.getByRole('img', { name: 'Unterschrift von Erika Berg' })
    const path = picture.querySelector('path')

    expect(picture.getAttribute('viewBox')).toBe('0 0 1000 400')
    expect(path?.getAttribute('d')).toBe('M100,300L240,120L400,280')
    expect(path?.getAttribute('fill')).toBe('none')
    expect(path?.getAttribute('stroke')).toBe('currentColor')
    expect(path?.getAttribute('stroke-width')).toBe('5')
    expect(path?.getAttribute('stroke-linecap')).toBe('round')
    expect(path?.getAttribute('stroke-linejoin')).toBe('round')
  })

  it('keeps the shape of the box at the width it is given, in the colour of the text', () => {
    render(<SignaturePicture path="M1,1L2,2" label="Bild" />)

    expect(screen.getByRole('img', { name: 'Bild' }).getAttribute('class')).toBe(
      'block w-full max-w-md aspect-[5/2] text-ink',
    )
  })

  it('takes its size from the frame around it where the frame decides it', () => {
    render(<SignaturePicture path="M1,1L2,2" label="Bild" className="block h-full w-full" />)

    expect(screen.getByRole('img', { name: 'Bild' }).getAttribute('class')).toBe(
      'block h-full w-full text-ink',
    )
  })

  it('is not drawn at all for a path the pad would never write', () => {
    for (const path of [
      '',
      'M10,20L30,40"/><script>alert(1)</script>',
      'M10,20 L30,40',
      'M1001,20L30,40',
      `M1,1${'L1,1'.repeat(longestSignaturePath / 4)}`,
    ]) {
      const { container, unmount } = render(<SignaturePicture path={path} label="Bild" />)

      expect(container.innerHTML, path.slice(0, 40)).toBe('')
      unmount()
    }
  })
})
