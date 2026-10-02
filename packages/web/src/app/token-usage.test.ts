import { designTokens, foundationSources, tokenUsage } from '@opengewerk/platform-web/testing'
import { describe, expect, it } from 'vitest'

/**
 * The screens of this application against the design tokens of the foundation
 * (ADR 0010). The check itself is the foundation's and it asks its own
 * components the same; here it walks every screen.
 *
 * It read only the components until the header and the navigation of the
 * office brought colours of their own (#217). Widened to the screens, it found
 * `bg-canvas` and `text-heading` on the inspection record, two classes that
 * had named nothing since they were written.
 */

const screens = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Readonly<Record<string, string>>

/**
 * Strings in the screens that read like a class and are something else. Kept
 * as a list: something new turns this test red once, somebody looks at it,
 * and either it belongs here or it is the typo the test exists for.
 */
const notClasses: ReadonlySet<string> = new Set([
  // The query key of the text snippets, `['text-snippets']`.
  'text-snippets',
])

describe('the screens', () => {
  it('are actually there to look at', () => {
    // Without this the checks below would pass on an empty list, and an empty
    // list is the one result that proves nothing.
    expect(Object.keys(screens).length).toBeGreaterThanOrEqual(50)
  })

  it('name only colours, sizes and radii that the tokens declare', () => {
    expect(tokenUsage(designTokens, screens, { notClasses }).unknown).toEqual([])
  })

  it('use every colour the tokens declare, together with the components they are built from', () => {
    // The other direction. A token nobody reaches for is either a colour that
    // was meant for something and forgotten, or one that should go; either way
    // it is not a token, it is a leftover, and it still has to pass the
    // contrast check and be kept in two grounds.
    const { colours, usedColours } = tokenUsage(
      designTokens,
      { ...foundationSources, ...screens },
      { notClasses },
    )

    expect([...colours].filter((name) => !usedColours.has(name)).sort()).toEqual([])
  })
})
