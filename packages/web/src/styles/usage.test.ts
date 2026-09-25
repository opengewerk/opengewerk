import { describe, expect, it } from 'vitest'

import tokens from './tokens.css?raw'

/**
 * A utility class is a string until something builds the stylesheet, and a
 * string with a typo in it looks exactly like one without. `bg-surfce` renders
 * an element with no background, which on an ivory page is invisible, and the
 * typecheck has nothing to say about it.
 *
 * This walks every screen and component, pulls out every class that names a
 * token, and holds it against what `tokens.css` actually declares. It is the
 * cheap half of what a full Tailwind build would tell us, and it runs without
 * one.
 *
 * It read only the components until the header and the navigation of the
 * office brought colours of their own (#217). Widened to the screens, it found
 * `bg-canvas` and `text-heading` on the inspection record, two classes that
 * had named nothing since they were written.
 */

const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Readonly<Record<string, string>>

function declared(prefix: string): ReadonlySet<string> {
  const names = new Set<string>()

  for (const match of tokens.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):`, 'g'))) {
    const name = match[1] as string

    // `--text-body--line-height` belongs to `--text-body`, it is not a name of
    // its own.
    if (!name.includes('--')) {
      names.add(name)
    }
  }

  return names
}

const colours = declared('color')
const spacings = declared('spacing')
const radii = declared('radius')
const fonts = declared('font')
const textSizes = declared('text')

/**
 * Suffixes that belong to Tailwind and not to us. Kept as a list on purpose:
 * something new turns this test red once, somebody looks at it, and either it
 * is a keyword that belongs here or it is the typo the test exists for.
 */
const builtIn: ReadonlySet<string> = new Set([
  'transparent',
  'current',
  'inherit',
  'collapse',
  'separate',
  'dashed',
  'solid',
  'none',
  'left',
  'right',
  'center',
  'justify',
  'normal',
  'medium',
  'semibold',
  'bold',
  'full',
  'auto',
  'sr',
  'only',
  // `h-px` for a hairline, `min-h-dvh` for a page as tall as the screen that
  // is left, `font-mono` for a placeholder in running text: Tailwind's own
  // scale, which `@import 'tailwindcss'` brings along.
  'px',
  'dvh',
  // `border-spacing-0` on a table whose cells draw their own borders (#218).
  'spacing-0',
  'mono',
])

/**
 * Strings in the screens that read like a class and are something else. Kept
 * as a list for the same reason as `builtIn`.
 */
const notClasses: ReadonlySet<string> = new Set([
  // The query key of the text snippets, `['text-snippets']`.
  'text-snippets',
])

/** Which set of names a prefix draws from. `text-` draws from three. */
const namespaces: Readonly<Record<string, readonly ReadonlySet<string>[]>> = {
  bg: [colours],
  border: [colours],
  'border-l': [colours],
  'border-b': [colours],
  'border-t': [colours],
  'border-r': [colours],
  outline: [colours],
  ring: [colours],
  fill: [colours],
  stroke: [colours],
  text: [colours, textSizes],
  rounded: [radii],
  font: [fonts],
  h: [spacings],
  w: [spacings],
  'min-h': [spacings],
  'min-w': [spacings],
  p: [spacings],
  px: [spacings],
  py: [spacings],
  gap: [spacings],
}

const prefixes = Object.keys(namespaces)
  .sort((left, right) => right.length - left.length)
  .join('|')
// Not after a hyphen, a slash or a dot: `max-w-md` is not `w-md`, and
// `./screens/text-snippets.js` is a module and not a colour.
const candidate = new RegExp(`(?<![-/.])\\b(${prefixes})-([a-z][a-z0-9-]*)\\b`, 'g')

describe('the screens and components', () => {
  it('are actually there to look at', () => {
    // Without this the checks below would pass on an empty list, and an empty
    // list is the one result that proves nothing.
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5)
  })

  it('name only colours, sizes and radii that the tokens declare', () => {
    const unknown: string[] = []

    for (const [path, source] of Object.entries(sources)) {
      for (const match of source.matchAll(candidate)) {
        const prefix = match[1] as string
        const suffix = match[2] as string

        // `border-b`, `border-l-4`: a side, optionally with a width. Tailwind's
        // own, and not a colour.
        if (
          builtIn.has(suffix) ||
          notClasses.has(`${prefix}-${suffix}`) ||
          /^[btlrxy](-\d+)?$/.test(suffix)
        ) {
          continue
        }

        const allowed = namespaces[prefix] as readonly ReadonlySet<string>[]

        if (!allowed.some((names) => names.has(suffix))) {
          unknown.push(`${path.split('/').pop() ?? path}: ${prefix}-${suffix}`)
        }
      }
    }

    expect([...new Set(unknown)].sort()).toEqual([])
  })

  it('use every colour the tokens declare', () => {
    // The other direction. A token nobody reaches for is either a colour that
    // was meant for something and forgotten, or one that should go; either way
    // it is not a token, it is a leftover, and it still has to pass the
    // contrast check and be kept in two grounds.
    const used = new Set<string>()

    for (const source of Object.values(sources)) {
      for (const match of source.matchAll(candidate)) {
        used.add(match[2] as string)
        // `border-l-copper` reaches the colour through a side, so the side has
        // to be peeled off before the name is recognised.
        used.add((match[2] as string).replace(/^[btlrxy]-/, ''))
      }
    }

    expect([...colours].filter((name) => !used.has(name)).sort()).toEqual([])
  })
})
