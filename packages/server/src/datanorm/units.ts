import type { LineUnit } from '@opengewerk/domain'

/**
 * The unit of an article from the four characters DATANORM 4 gives it (#297),
 * which every supplier fills in its own way: "Stck", "St.", "STK", "Stück".
 * Compared without case, dots and blanks. A package, a roll, a set or a
 * carton is a package: sold as one, whatever it holds.
 */
const units: readonly (readonly [LineUnit, readonly string[]])[] = [
  ['piece', ['st', 'stk', 'stck', 'stuck', 'stück', 'stueck', 'pce', 'pcs', 'pc', 'ea']],
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

const byText = new Map(units.flatMap(([unit, texts]) => texts.map((text) => [text, unit])))

/**
 * The unit, and whether it was recognised. An unknown one becomes a piece,
 * and the preview says for how many articles, so that nobody finds out at the
 * first invoice.
 */
export function unitOf(text: string): { readonly unit: LineUnit; readonly known: boolean } {
  const found = byText.get(text.toLowerCase().replace(/[.\s]/g, ''))

  return found ? { unit: found, known: true } : { unit: 'piece', known: false }
}
