import { describe, expect, it } from 'vitest'

import tokens from './tokens.css?raw'

/**
 * The bands of the board "Breiten und Auflösungen" and the density of the
 * office in each (#218).
 *
 * Until #218 a button in the office was 44 pixels high at every width: a
 * minimum meant for fingers held for the mouse as well, and it won against the
 * 34 pixels of `--spacing-control`, which the canvas draws from 1024 pixels on.
 * Nothing looked broken, the office was only a size too coarse everywhere,
 * which is exactly what no test notices unless it asks for the number.
 */

/** The declarations of the first block that opens with `opening`. */
function blockOf(opening: string): string {
  const start = tokens.indexOf(opening)

  if (start < 0) {
    throw new Error(`Der Block "${opening}" steht nicht in tokens.css`)
  }

  const from = tokens.indexOf('{', start) + 1
  // A media block holds a rule, so its first closing brace ends the rule.
  return tokens.slice(from, tokens.indexOf('}', from))
}

function valueIn(block: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()
}

describe('the bands of the board', () => {
  it('break at 600, 1024, 1600 and 2400 pixels, with no step for 768', () => {
    const theme = blockOf('@theme')

    expect(valueIn(theme, 'breakpoint-sm')).toBe('37.5rem')
    expect(valueIn(theme, 'breakpoint-md')).toBe('initial')
    expect(valueIn(theme, 'breakpoint-lg')).toBe('64rem')
    expect(valueIn(theme, 'breakpoint-xl')).toBe('100rem')
    expect(valueIn(theme, 'breakpoint-2xl')).toBe('150rem')
  })
})

describe('the density of the office', () => {
  it('draws buttons, fields and targets 34 pixels high for a mouse, from 1024 pixels on', () => {
    const theme = blockOf('@theme')

    expect(valueIn(theme, 'spacing-control')).toBe('2.125rem')
    expect(valueIn(theme, 'spacing-control-lg')).toBe('2.125rem')
    expect(valueIn(theme, 'spacing-tap')).toBe('2.125rem')
  })

  it('lets nothing to tap go below 44 pixels under 1024 pixels', () => {
    const finger = blockOf('@media (width < 64rem)')

    expect(valueIn(finger, 'spacing-control')).toBe('2.75rem')
    expect(valueIn(finger, 'spacing-control-lg')).toBe('2.75rem')
    expect(valueIn(finger, 'spacing-tap')).toBe('2.75rem')
  })

  it('sets the text a size up on a phone', () => {
    const phone = blockOf('@media (width < 37.5rem)')

    expect(valueIn(phone, 'text-body')).toBe('0.9375rem')
  })
})
