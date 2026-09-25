import { describe, expect, it } from 'vitest'

import tokens from './tokens.css?raw'

/**
 * The colours are checked here and not in a browser.
 *
 * `getComputedStyle` is unusable for this: `color-mix()` comes back in a form a
 * 0 to 255 calculation reads as near black, and a transition on a background
 * freezes at its starting value in a renderer that composites no frames. A run
 * built on it reports failures that are artefacts, and following those changes
 * colours that were fine.
 *
 * Reading the hex values out of the stylesheet and doing the arithmetic is
 * deterministic, needs no browser, and catches the one case that actually slips
 * through: somebody changes a token and checks only the role they had in mind.
 */

/** The values of one block of the stylesheet, by token name. */
function paletteOf(source: string, opening: string): Map<string, string> {
  const start = source.indexOf(opening)

  if (start < 0) {
    throw new Error(`Der Block "${opening}" steht nicht in tokens.css`)
  }

  const from = source.indexOf('{', start) + 1
  const to = source.indexOf('}', from)
  const block = source.slice(from, to)
  const values = new Map<string, string>()

  for (const match of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)) {
    values.set(match[1] as string, match[2] as string)
  }

  return values
}

function channel(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const red = channel(Number.parseInt(hex.slice(1, 3), 16) / 255)
  const green = channel(Number.parseInt(hex.slice(3, 5), 16) / 255)
  const blue = channel(Number.parseInt(hex.slice(5, 7), 16) / 255)

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function ratio(one: string, other: string): number {
  const first = luminance(one)
  const second = luminance(other)

  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

const light = paletteOf(tokens, '@theme')
const dark = paletteOf(tokens, ":root[data-theme='dark']")

/**
 * The surfaces a foreground colour can land on: the page, a card, a sunken
 * strip and the navigation beside the page. Checking a text colour only
 * against the card is how the first draft of this passed while three values
 * were too light: the page and the navigation are darker, and nothing stops a
 * label from sitting on either.
 */
const surfaces = ['ground', 'surface', 'surface-sunken', 'nav'] as const

/** Text, at any size this interface actually uses. 4.5 is the requirement. */
const textColours = [
  'ink',
  'ink-muted',
  'ink-faint',
  'copper-text',
  'done',
  'waiting',
  'conflict',
] as const

/**
 * Filled surfaces with lettering on them. Both halves have to be named,
 * because turning a fill around without turning its lettering around is the
 * quietest way to produce an unreadable badge.
 */
const filled = [
  { front: 'on-copper', back: 'copper-solid', what: 'der gefüllte Kupferknopf' },
  { front: 'on-bar-wait', back: 'bar-wait', what: 'die Leiste, wenn etwas wartet' },
  { front: 'on-status', back: 'conflict', what: 'die Leiste bei einem Konflikt' },
  { front: 'bar-action-wait', back: 'bar-action', what: 'der Knopf auf der wartenden Leiste' },
  { front: 'bar-action-conflict', back: 'bar-action', what: 'der Knopf auf der Konfliktleiste' },
  { front: 'on-offline', back: 'offline', what: '"Offline" im Kopf der Baustelle' },
  { front: 'on-fixed-accent', back: 'fixed-accent', what: 'die Marke "FEST" eines Belegs' },
  { front: 'top-ink', back: 'top', what: 'der Name in der Kopfleiste' },
  { front: 'top-muted', back: 'top', what: 'der Betrieb in der Kopfleiste' },
  { front: 'ground', back: 'ink', what: 'der gewählte Eintrag der Navigation' },
  { front: 'ground', back: 'ink', what: 'der dunkle Knopf, "Akte öffnen"' },
  { front: 'done', back: 'done-fill', what: 'die Marke eines erledigten Zustands' },
  { front: 'waiting', back: 'waiting-fill', what: 'die Marke eines laufenden Zustands' },
  { front: 'conflict', back: 'conflict-fill', what: 'die Marke eines Konflikts' },
  { front: 'ink', back: 'input', what: 'der Text in einem Feld' },
  { front: 'ink-faint', back: 'input', what: 'der Platzhalter in einem Feld' },
  { front: 'ink', back: 'selected', what: 'die gewählte Zeile einer Liste' },
  { front: 'ink-muted', back: 'selected', what: 'eine Nebenspalte der gewählten Zeile' },
] as const

function value(palette: Map<string, string>, name: string, ground: string): string {
  const found = palette.get(name)

  if (!found) {
    throw new Error(`${ground}: der Wert --color-${name} fehlt`)
  }

  return found
}

function check(palette: Map<string, string>, ground: string) {
  for (const front of textColours) {
    for (const back of surfaces) {
      const measured =
        Math.round(ratio(value(palette, front, ground), value(palette, back, ground)) * 100) / 100
      const line = `${ground}: ${front} auf ${back} ist ${measured}:1, verlangt 4.5`

      expect({ [line]: measured >= 4.5 }).toEqual({ [line]: true })
    }
  }

  for (const pair of filled) {
    const measured =
      Math.round(
        ratio(value(palette, pair.front, ground), value(palette, pair.back, ground)) * 100,
      ) / 100
    const line = `${ground}: ${pair.what} ist ${measured}:1, verlangt 4.5`

    expect({ [line]: measured >= 4.5 }).toEqual({ [line]: true })
  }

  // Three, not four and a half: a border is not text. It is what tells
  // somebody where the input field is, so it has to be visible, and the
  // surfaces it may sit on are the page and a card.
  for (const back of ['ground', 'surface'] as const) {
    const measured =
      Math.round(ratio(value(palette, 'line-strong', ground), value(palette, back, ground)) * 100) /
      100
    const line = `${ground}: Feldrand auf ${back} ist ${measured}:1, verlangt 3`

    expect({ [line]: measured >= 3 }).toEqual({ [line]: true })
  }
}

describe('the colour tokens', () => {
  it('carry enough contrast on the light ground', () => {
    check(light, 'hell')
  })

  it('carry enough contrast on the dark ground', () => {
    check(dark, 'dunkel')
  })

  it('give the filled copper button its own value', () => {
    // This is the pair the whole four value scale exists for. White on the
    // plain brand copper is 3.88:1, which carries a heading and fails a 14px
    // button label, and a brand book never had to answer that question because
    // it fixes colours for a mark. Setting `copper-solid` back to `copper`
    // turns this red, which is the point.
    const front = light.get('on-copper') as string
    const back = light.get('copper-solid') as string

    expect(ratio(front, back)).toBeGreaterThanOrEqual(4.5)
    expect(light.get('copper-solid')).not.toBe(light.get('copper'))
  })

  it('keep dark a choice and never the system default', () => {
    // Light on every new device, whatever the operating system prefers (#216).
    // A media query here made the interface dark on every machine set to dark,
    // with no switch to get out again.
    expect(tokens).not.toMatch(/@media\s*\(prefers-color-scheme/)
  })

  it('leave no colour behind when the ground changes', () => {
    // A token added to the light block and forgotten in the dark one keeps its
    // light value there. That is how a badge ends up with dark text on a dark
    // fill: the fill was turned around, the lettering was not.
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort())
  })
})
