import { describe, expect, it } from 'vitest'

import { withoutUnwritable } from './characters.js'

/**
 * The characters no document carries, checked once for both packagings.
 *
 * Every special character here is built from its code rather than written as
 * an escape: an editing tool can turn an escape into the character itself on
 * the way into the file, and the test would then check another string than
 * the one it names.
 */

const tab = String.fromCharCode(9)
const lineFeed = String.fromCharCode(10)
const carriageReturn = String.fromCharCode(13)

describe('a text on its way into a document', () => {
  it('keeps tab, line feed and carriage return, which a text needs', () => {
    const typed = `Zeile 1${tab}A${carriageReturn}${lineFeed}Zeile 2`

    expect(withoutUnwritable(typed)).toBe(typed)
  })

  it('drops every other control character', () => {
    const controls = Array.from({ length: 32 }, (_, code) => String.fromCharCode(code))
      .filter((character) => ![tab, lineFeed, carriageReturn].includes(character))
      .join('')

    expect(controls).toHaveLength(29)
    expect(withoutUnwritable(`a${controls}b`)).toBe('ab')
  })

  it('drops what XML 1.0 cannot hold besides: a lone surrogate and the last two code points of the plane', () => {
    const lone = String.fromCharCode(0xd800)
    const last = String.fromCharCode(0xfffe) + String.fromCharCode(0xffff)

    expect(withoutUnwritable(`a${lone}b${last}c`)).toBe('abc')
  })

  it('keeps umlauts, the euro sign and characters beyond the first plane', () => {
    const plug = String.fromCodePoint(0x1f50c)
    const typed = `Zählerschrank für 1.240,00 € ${plug}`

    expect(withoutUnwritable(typed)).toBe(typed)
  })
})
