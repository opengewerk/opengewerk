import type { LineUnit } from '@opengewerk/domain'

/**
 * The unit of an article from the four characters DATANORM 4 gives it (#297),
 * which every supplier fills in its own way: "Stck", "St.", "STK", "Stück".
 * Compared without case, dots and blanks, and without the difference between
 * an umlaut and the two letters a file without umlauts writes for it: "Stück"
 * spelled out that way is the same unit (`folded`). A package, a roll, a set
 * or a carton is a package: sold as one, whatever it holds.
 */
const units: readonly (readonly [LineUnit, readonly string[]])[] = [
  ['piece', ['st', 'stk', 'stck', 'stück', 'pce', 'pcs', 'pc', 'ea']],
  ['metre', ['m', 'mtr', 'meter', 'lfm', 'lfdm', 'lm']],
  ['square_metre', ['m2', 'm²', 'qm']],
  ['cubic_metre', ['m3', 'm³', 'cbm']],
  ['kilogram', ['kg', 'kilo']],
  ['litre', ['l', 'ltr', 'liter']],
  ['hour', ['h', 'std', 'stunde', 'stunden']],
  ['day', ['tag', 'tage', 'tg']],
  [
    'package',
    [
      'pak',
      'pack',
      'paket',
      'pkg',
      'pckg',
      'pkt',
      've',
      'karton',
      'ktn',
      'krt',
      'bund',
      'bd',
      'ring',
      'rol',
      'rll',
      'rolle',
      'satz',
      'set',
      'sack',
      'eimer',
      'dose',
      'beutel',
      'btl',
      'pal',
      'palette',
    ],
  ],
  ['flat_rate', ['psch', 'pauschal', 'pau']],
]

/**
 * A unit as it is compared: lower case, without dots and blanks, and each
 * umlaut and its spelling in two letters folded into the plain vowel, so that
 * both spellings meet, and "Stuck" without the dots as well.
 */
function folded(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.\s]/g, '')
    .replace(/ä|ae/g, 'a')
    .replace(/ö|oe/g, 'o')
    .replace(/ü|ue/g, 'u')
    .replace(/ß/g, 'ss')
}

const byText = new Map(
  units.flatMap(([unit, texts]) => texts.map((text) => [folded(text), unit] as const)),
)

/**
 * The unit, and whether it was recognised. An unknown one becomes a piece,
 * and the preview says for how many articles, so that nobody finds out at the
 * first invoice.
 */
export function unitOf(text: string): { readonly unit: LineUnit; readonly known: boolean } {
  const found = byText.get(folded(text))

  return found ? { unit: found, known: true } : { unit: 'piece', known: false }
}
