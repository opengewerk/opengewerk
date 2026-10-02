import { describe, expect, it } from 'vitest'

import { designTokens, foundationSources, tokenUsage } from '../testing.js'

/**
 * The components of this package against the tokens of this package. The
 * screens of an application ask the same question of themselves, with the
 * same tool, and add the one this package cannot answer alone: whether every
 * colour is used by anything.
 *
 * The check read only the components until the header and the navigation of
 * an application brought colours of their own. Widened to its screens, it
 * found two classes on a record that had named nothing since they were
 * written.
 */
describe('the components', () => {
  it('are actually there to look at', () => {
    // Without this the check below would pass on an empty list, and an empty
    // list is the one result that proves nothing.
    expect(Object.keys(foundationSources).length).toBeGreaterThanOrEqual(5)
  })

  it('name only colours, sizes and radii that the tokens declare', () => {
    expect(tokenUsage(designTokens, foundationSources).unknown).toEqual([])
  })
})

describe('the check of the classes', () => {
  it('finds a class that names no token, and says where', () => {
    const found = tokenUsage(designTokens, {
      './screens/list.tsx': '<div className="bg-surfce text-ink rounded-card" />',
    })

    expect(found.unknown).toEqual(['list.tsx: bg-surfce'])
  })

  it('reads a colour through the side of a border', () => {
    const found = tokenUsage(designTokens, {
      './a.tsx': '<div className="border-l-4 border-l-copper border-b" />',
    })

    expect(found.unknown).toEqual([])
    expect(found.usedColours.has('copper')).toBe(true)
  })

  it('leaves alone what an application says is no class', () => {
    const source = { './a.tsx': "useQuery({ queryKey: ['text-snippets'] })" }

    expect(tokenUsage(designTokens, source).unknown).toEqual(['a.tsx: text-snippets'])
    expect(
      tokenUsage(designTokens, source, { notClasses: new Set(['text-snippets']) }).unknown,
    ).toEqual([])
  })

  it('knows the colours the tokens declare', () => {
    const { colours } = tokenUsage(designTokens, {})

    expect(colours.has('copper')).toBe(true)
    expect(colours.has('ink')).toBe(true)
    expect(colours.size).toBeGreaterThanOrEqual(20)
  })
})
