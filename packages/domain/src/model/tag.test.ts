import { describe, expect, it } from 'vitest'

import { customerStanding, tagKey, tagName, tagNameMaxLength, tagNameProblem } from './tag.js'

describe('the name of a tag', () => {
  it('loses the space at both ends and keeps one between words', () => {
    expect(tagName('  Smart   Home ')).toBe('Smart Home')
  })

  it('is the same tag whatever its case', () => {
    expect(tagKey('Wallbox')).toBe(tagKey(' wallbox'))
    expect(tagKey('Wärmepumpe')).toBe(tagKey('WÄRMEPUMPE'))
    expect(tagKey('Wallbox')).not.toBe(tagKey('Wallboxen'))
  })

  it('may be neither empty nor longer than a chip holds', () => {
    expect(tagNameProblem('   ')).toBe('Ein Tag braucht einen Namen.')
    expect(tagNameProblem('x'.repeat(tagNameMaxLength))).toBeNull()
    expect(tagNameProblem('x'.repeat(tagNameMaxLength + 1))).toBe(
      `Ein Tag hat höchstens ${String(tagNameMaxLength)} Zeichen.`,
    )
    // Counted after the tidying, so a long run of spaces is no reason.
    expect(tagNameProblem(`Wallbox${' '.repeat(60)}`)).toBeNull()
  })
})

describe('whether a customer is an existing one', () => {
  it('follows from a completed job and from nothing else', () => {
    expect(customerStanding([])).toBe('new')
    expect(customerStanding(['draft', 'active', 'cancelled'])).toBe('new')
    expect(customerStanding(['active', 'completed'])).toBe('existing')
  })
})
