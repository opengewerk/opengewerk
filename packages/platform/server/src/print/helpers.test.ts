import { describe, expect, it } from 'vitest'

import { addressLines, fontFaces, present, text, typeface } from './helpers.js'

// What every printed page is written with, checked here once for every
// application that prints. Special characters are built from their codes: an
// editing tool can turn a written escape into the character itself on the way
// into the file, and the test would check another string than it names.

const lineFeed = String.fromCharCode(10)
const bell = String.fromCharCode(7)

const address = {
  street: 'Hauptstraße',
  houseNumber: '12a',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  country: 'DE',
}

describe('a text on a printed page', () => {
  it('escapes every character HTML would read as markup', () => {
    expect(text(`<b class="x">Müller & 'Söhne'</b>`)).toBe(
      '&lt;b class=&quot;x&quot;&gt;Müller &amp; &#39;Söhne&#39;&lt;/b&gt;',
    )
  })

  it('drops what no document carries and keeps its line breaks', () => {
    expect(text(`Zeile 1${bell}${lineFeed}Zeile 2`)).toBe(`Zeile 1${lineFeed}Zeile 2`)
  })

  it('is empty for nothing', () => {
    expect(text(null)).toBe('')
    expect(text(undefined)).toBe('')
  })
})

describe('whether there is anything to print', () => {
  it('is not, for nothing and for spaces only', () => {
    expect([null, undefined, '', '   ', lineFeed].map(present)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('is, for a word with spaces around it', () => {
    expect(present('  Ja ')).toBe(true)
  })
})

describe('an address as lines', () => {
  it('leaves the country out at home', () => {
    expect(addressLines(address, 'DE')).toEqual(['Hauptstraße 12a', '68535 Edingen-Neckarhausen'])
  })

  it('names another country in German and in capitals', () => {
    expect(addressLines({ ...address, country: 'AT' }, 'DE')).toEqual([
      'Hauptstraße 12a',
      '68535 Edingen-Neckarhausen',
      'ÖSTERREICH',
    ])
  })

  it('leaves out what is missing, and no empty line for it', () => {
    expect(
      addressLines(
        { street: null, houseNumber: '  ', postalCode: '68535', city: null, country: 'DE' },
        'DE',
      ),
    ).toEqual(['68535'])
  })
})

describe('the fonts of a printed page', () => {
  it('embeds the faces of the weights asked for, Latin and extended Latin, as data', () => {
    const rules = fontFaces([400]).split('\n')

    expect(rules).toHaveLength(2)
    for (const rule of rules) {
      expect(rule).toMatch(
        /^@font-face\{font-family:'Barlow';font-style:normal;font-weight:400;font-display:block;src:url\(data:font\/woff2;base64,[A-Za-z0-9+/]+=*\) format\('woff2'\);unicode-range:[U+0-9A-F,-]+\}$/,
      )
    }
    expect(rules[0]).toContain('unicode-range:U+0000-00FF,')
    expect(rules[1]).toContain('unicode-range:U+0100-02BA,')
  })

  it('embeds both weights when both are asked for, and none when none is', () => {
    expect(
      fontFaces([400, 600])
        .split('\n')
        .map((rule) => /font-weight:(\d+)/.exec(rule)?.[1]),
    ).toEqual(['400', '400', '600', '600'])
    expect(fontFaces([])).toBe('')
  })

  it('names the embedded font first, and fonts every system has after it', () => {
    expect(typeface.split(', ')).toEqual(["'Barlow'", "'Liberation Sans'", 'Arial', 'sans-serif'])
  })
})
