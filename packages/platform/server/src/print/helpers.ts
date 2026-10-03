import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { withoutUnwritable } from './characters.js'

// What every page the renderer prints is written with: escaping for what a
// person typed, the test whether there is anything to print, the fonts
// embedded in the page, and an address as lines. The pages are template
// strings and no components: the server renders no React, and escaping is all
// a template string needs to be safe.

/**
 * HTML escaping for anything a person typed. The characters no document
 * carries go first, the ones XML cannot hold, so a page and an XML file
 * printed from the same content say the same thing. Line breaks stay: the
 * texts rely on them.
 */
export function text(value: string | null | undefined): string {
  return withoutUnwritable(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Whether there is anything to print: neither missing nor only spaces. */
export function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== ''
}

/** The names of countries in German, as a printed address carries them. */
const regions = new Intl.DisplayNames(['de'], { type: 'region' })

const require = createRequire(import.meta.url)

/** The faces the page uses: regular and semibold, Latin and extended Latin. */
const faces = [
  { weight: 400, subset: 'latin', range: latinRange() },
  { weight: 400, subset: 'latin-ext', range: latinExtendedRange() },
  { weight: 600, subset: 'latin', range: latinRange() },
  { weight: 600, subset: 'latin-ext', range: latinExtendedRange() },
] as const

function latinRange(): string {
  return (
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,' +
    'U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
  )
}

function latinExtendedRange(): string {
  return (
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,' +
    'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,' +
    'U+A720-A7FF'
  )
}

let embeddedFaces: Map<number, string> | undefined

/**
 * The @font-face rules, with the fonts inside them as data.
 *
 * Embedded rather than left to the system fonts of the renderer: a font that
 * changes with the renderer image would change every PDF an installation
 * produces after an update, line breaks included. Read once and kept, because
 * they are the same for every page.
 */
export function fontFaces(weights: readonly number[]): string {
  embeddedFaces ??= new Map(
    faces.map((face, index) => {
      const file = require.resolve(
        `@fontsource/barlow/files/barlow-${face.subset}-${String(face.weight)}-normal.woff2`,
      )
      const data = readFileSync(file).toString('base64')

      return [
        index,
        `@font-face{font-family:'Barlow';font-style:normal;font-weight:${String(face.weight)};` +
          `font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');` +
          `unicode-range:${face.range}}`,
      ]
    }),
  )

  return faces
    .map((face, index) => (weights.includes(face.weight) ? embeddedFaces?.get(index) : undefined))
    .filter((rule): rule is string => rule !== undefined)
    .join('\n')
}

/** The font of every printed page, and what stands in for it. */
export const typeface = `'Barlow', 'Liberation Sans', Arial, sans-serif`

/**
 * An address as lines. The country only when it is not the sender's (`home`,
 * a code like `DE`), by its German name and in capitals, as a letter carries it.
 */
export function addressLines(
  address: {
    readonly street: string | null
    readonly houseNumber: string | null
    readonly postalCode: string | null
    readonly city: string | null
    readonly country: string
  },
  home: string,
): string[] {
  const street = [address.street, address.houseNumber].filter(present).join(' ')
  const place = [address.postalCode, address.city].filter(present).join(' ')
  const country =
    address.country !== home ? (regions.of(address.country) ?? address.country).toUpperCase() : ''

  return [street, place, country].filter(present)
}
