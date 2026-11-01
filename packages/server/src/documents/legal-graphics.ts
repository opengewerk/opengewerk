import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PDFDocument } from '@cantoo/pdf-lib'
import { type DurabilityContent, durabilityYears } from '@opengewerk/domain'

/**
 * The pages the law prescribes whole, which OpenGewerk prints as they came
 * and never rebuilds, #431.
 *
 * So far one: the harmonised notice on the legal guarantee, annex I to
 * Implementing Regulation (EU) 2025/1960. None of its elements may be changed
 * or added to, and it is at least A4 in size, so a quote to a consumer about
 * goods gets the page the European Commission publishes, as the last page of
 * its PDF. The files lie in `assets/legal` with their source and their terms;
 * a wording in `domain` names one of them by the key below.
 *
 * Every file is held against its digest each time it is read. A file that
 * changed is not the page the law prescribes any more, and printing it would
 * be worse than refusing: the installation is broken, and it says so.
 */

/** Where the files lie, next to `dist` as next to `src`. */
const folder = join(dirname(fileURLToPath(import.meta.url)), '../../assets/legal')

interface LegalFile {
  readonly file: string
  readonly sha256: string
}

export interface LegalGraphic {
  /** The PDF of the Commission, and the page of it that is printed. */
  readonly pdf: LegalFile & { readonly page: number }
  /** The same page as a picture, for the settings screen. */
  readonly image: LegalFile & { readonly mediaType: 'image/png' }
}

export const legalGraphics = {
  // The German version in colour: page 1 of the file, page 2 is black and
  // white, which the Commission names as the one for physical shops.
  'guarantee-notice-de-2025-09-25': {
    pdf: {
      file: 'guarantee-notice-de-2025-09-25.pdf',
      sha256: '1aa13d2557aff2d107fce73c3c0f5ba6ebeb0cbc86e4fe2f7311a6a1d3be1182',
      page: 0,
    },
    image: {
      file: 'guarantee-notice-de-2025-09-25.png',
      sha256: '1a9a521cca675709ddf0ec341d9d3d40b18dfb47756754b29cbfe38a5d6027b8',
      mediaType: 'image/png',
    },
  },
} as const satisfies Readonly<Record<string, LegalGraphic>>

export type LegalGraphicName = keyof typeof legalGraphics

/** A file that is missing or not the one this version shipped. */
export class LegalGraphicError extends Error {
  override readonly name = 'LegalGraphicError'
}

export function isLegalGraphic(name: string): name is LegalGraphicName {
  return Object.hasOwn(legalGraphics, name)
}

function graphicNamed(name: string): LegalGraphic {
  if (!isLegalGraphic(name)) {
    throw new LegalGraphicError(`Die amtliche Seite „${name}“ gehört nicht zu dieser Fassung.`)
  }

  return legalGraphics[name]
}

async function checked(entry: LegalFile): Promise<Uint8Array> {
  let bytes: Uint8Array

  try {
    bytes = await readFile(join(folder, entry.file))
  } catch {
    throw new LegalGraphicError(
      `Die Datei ${entry.file} fehlt in dieser Installation, sie gehört unter assets/legal.`,
    )
  }

  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new LegalGraphicError(
      `Die Datei ${entry.file} ist nicht die, die mit dieser Fassung ausgeliefert wurde, und wird ` +
        'nicht gedruckt.',
    )
  }

  return bytes
}

/**
 * The label of a guarantee of durability, annex II to Implementing
 * Regulation (EU) 2025/1960 (#433), in colour: the file of the Commission,
 * of which only three fields are filled.
 */
const durabilityLabelFile: LegalFile = {
  file: 'durability-label-2026-03-19.svg',
  sha256: '3414c8366823db39702d2557e614f882b530487ce589e903afdc98b7225e1ab1',
}

/** The label as the Commission publishes it, checked against its digest. */
export async function durabilityLabelSource(): Promise<string> {
  return new TextDecoder().decode(await checked(durabilityLabelFile))
}

/**
 * The three editable fields of the label, as the file writes them, and where
 * each one starts. The producer stands at the left edge as "Brand/Trademark"
 * did; the model ends at the right edge where "Model identifier" ended, at
 * 262.9 of the 269.29 points the label is wide.
 */
const labelFields = {
  producer:
    '<text class="cls-5" transform="translate(6.32 74.52)"><tspan x="0" y="0">Brand/</tspan>' +
    '<tspan class="cls-19" x="28.34" y="0">T</tspan><tspan class="cls-22" x="33.61" y="0">rademark</tspan></text>',
  model:
    '<text class="cls-5" transform="translate(196.75 74.52)"><tspan x="0" y="0">Model identifier</tspan></text>',
  years:
    '<text class="cls-3" transform="translate(5.07 150.57)"><tspan x="0" y="0">XX</tspan></text>',
} as const

/** Text as SVG and HTML both read it. */
function escaped(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * The label with its three fields filled, as an `<svg>` to put into a page.
 *
 * Nothing else of the file changes, but its ids and classes get `prefix` in
 * front: the file names its clip paths `clippath`, `clippath-1` and so on,
 * and two labels on one page would otherwise share them.
 */
export function filledDurabilityLabel(
  source: string,
  durability: DurabilityContent,
  prefix: string,
): string {
  const fields = [
    [
      labelFields.producer,
      `<text class="cls-5" transform="translate(6.32 74.52)"><tspan x="0" y="0">${escaped(durability.producer)}</tspan></text>`,
    ],
    [
      labelFields.model,
      `<text class="cls-5" text-anchor="end" transform="translate(262.9 74.52)"><tspan x="0" y="0">${escaped(durability.model)}</tspan></text>`,
    ],
    [
      labelFields.years,
      `<text class="cls-3" transform="translate(5.07 150.57)"><tspan x="0" y="0">${escaped(durabilityYears(durability.halfYears))}</tspan></text>`,
    ],
  ] as const
  let svg = source.slice(source.indexOf('<svg'))

  for (const [field, filled] of fields) {
    if (svg.split(field).length !== 2) {
      throw new LegalGraphicError(
        `In ${durabilityLabelFile.file} steht ein Feld der Kennzeichnung nicht so, wie es soll.`,
      )
    }

    // As a function and not as a text: a text replacement reads "$&", "$`"
    // and "$'" in what somebody typed as parts of the file (security review
    // of #801).
    svg = svg.replace(field, () => filled)
  }

  return svg
    .replaceAll(/\bid="([^"]+)"/g, `id="${prefix}-$1"`)
    .replaceAll(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replaceAll(/\.cls-(\d+)/g, `.${prefix}-cls-$1`)
    .replaceAll(
      /class="([^"]+)"/g,
      (_, names: string) =>
        `class="${names
          .split(' ')
          .map((name) => `${prefix}-${name}`)
          .join(' ')}"`,
    )
}

const require = createRequire(import.meta.url)

/** The two weights of Inter the fields of the label are set in, regular and extra bold. */
const labelFaces = [
  { weight: '400', file: 'inter-latin-400-normal.woff2' },
  { weight: '700 800', file: 'inter-latin-800-normal.woff2' },
] as const

let labelFontRules: string | undefined

/**
 * The @font-face rules for the fields of the label, the fonts inside them as
 * data, as the print of the foundation embeds Barlow. The file asks for
 * "Inter-Regular, Inter" and "Inter-ExtraBold, Inter" at weight 700 with the
 * variation 800; the extra bold face answers both. Latin only, which holds
 * the umlauts and the accents of western Europe; a letter beyond it prints in
 * the font the renderer falls back to.
 */
export function durabilityLabelFonts(): string {
  labelFontRules ??= labelFaces
    .map(({ weight, file }) => {
      const data = readFileSync(require.resolve(`@fontsource/inter/files/${file}`)).toString(
        'base64',
      )

      return (
        `@font-face{font-family:'Inter';font-style:normal;font-weight:${weight};` +
        `font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2')}`
      )
    })
    .join('\n')

  return labelFontRules
}

/** The picture of a page, for a screen, with its media type. */
export async function legalGraphicImage(
  name: string,
): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string }> {
  const { image } = graphicNamed(name)

  return { bytes: await checked(image), mediaType: image.mediaType }
}

/** The printed page of a PDF file of the Commission, copied into `into`. */
async function copiedPage(into: PDFDocument, name: string) {
  const { pdf } = graphicNamed(name)
  const source = await PDFDocument.load(await checked(pdf), { updateMetadata: false })
  const [page] = await into.copyPages(source, [pdf.page])

  if (!page) {
    throw new LegalGraphicError(`In ${pdf.file} fehlt die Seite ${String(pdf.page + 1)}.`)
  }

  return page
}

/** One page as a PDF of its own: the sheet of the instruction it belongs to. */
export async function legalPage(name: string): Promise<Uint8Array> {
  const document = await PDFDocument.create()

  document.addPage(await copiedPage(document, name))

  return document.save()
}

/**
 * The PDF of a document with the pages the law prescribes put in place of
 * the empty pages the template left for them at its end, one per name and in
 * the same order.
 *
 * Swapped rather than appended, so that the page count in the footer of every
 * other page counts them as well: "Seite 3 von 4" and then the notice. The
 * notice itself carries no footer, because nothing may be added to it.
 */
export async function withLegalPages(
  rendered: Uint8Array,
  names: readonly string[],
): Promise<Uint8Array> {
  if (names.length === 0) {
    return rendered
  }

  const document = await PDFDocument.load(rendered, { updateMetadata: false })
  const count = document.getPageCount()

  if (count <= names.length) {
    throw new LegalGraphicError(
      'Das gedruckte PDF hat weniger Seiten als erwartet; die Seiten für die amtlichen ' +
        'Mitteilungen fehlen.',
    )
  }

  for (let index = count - 1; index >= count - names.length; index -= 1) {
    document.removePage(index)
  }

  for (const name of names) {
    document.addPage(await copiedPage(document, name))
  }

  return document.save()
}
