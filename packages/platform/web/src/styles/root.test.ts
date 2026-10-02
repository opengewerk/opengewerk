import { describe, expect, it } from 'vitest'

import styles from './index.css?raw'

/**
 * The tokens are written in rem, and rem is the font size of `html`. Set from
 * a token, the root counted every token twice: `--text-body` made it 14px, and
 * after that `0.875rem` was 12.25px. The office came out an eighth smaller than
 * the canvas draws it, and the site too, because `data-entry` sits on the
 * shell and the root took the size of the office there as well (#229).
 */
describe('the root of the page', () => {
  it('keeps the font size the browser brings', () => {
    const start = styles.indexOf('html {')
    const block = styles.slice(start, styles.indexOf('}', start))

    expect(start).toBeGreaterThan(-1)
    expect(block).toContain('font-family')
    expect(block).not.toContain('font-size')
  })
})

/**
 * Tailwind writes a rule only for a class it has seen, and it looks in the
 * project it runs in: the application. The components here lie outside of it
 * (ADR 0010), so the stylesheet names its own package as a place to look.
 * Measured when the components moved: without the line the stylesheet of the
 * trades application came out 3.6 kB shorter, with every class missing that
 * only a component uses, and the build said nothing.
 */
describe('the stylesheet an entry point loads', () => {
  it('tells Tailwind to read the components of this package for their classes', () => {
    // From `styles/`, one level up is the source of the package.
    expect(styles).toMatch(/^@source '\.\.';$/m)
  })
})
