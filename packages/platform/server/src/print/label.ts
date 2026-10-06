import {
  labelAddress,
  type LabelFormat,
  labelLayouts,
  printedLabelCode,
} from '@opengewerk/platform-domain'
import { encode } from 'uqr'

import { fontFaces, text, typeface } from './helpers.js'
import type { PrintJob } from './renderer.js'

/**
 * What one label says beside its QR code: three lines and its code. Which
 * lines those are is the application's, because it knows what a label of its
 * own hangs on; what they look like is the same everywhere.
 */
export interface LabelFace {
  readonly code: string
  /** The small line on top: who keeps the thing, by the name on their papers. */
  readonly keeper: string
  /** The line in bold, two lines at most: the thing; null on a label that has none yet. */
  readonly name: string | null
  /** Where it is, as one short line, or null. */
  readonly place: string | null
}

/**
 * Labels as they are printed: the QR code at the left, the lines of the face
 * and the code of the label at the right.
 *
 * A label printer gets one label to a page of the label's own size; a sheet
 * A4 gets its fields row by row, from the first free one, and a print that
 * does not fit goes on on the next sheet from its first field. Printed on
 * every request and kept nowhere: what a label says does not change, and a
 * stored PDF would only be a second place for it.
 */
export interface LabelPrint {
  /** One after the other; the same face several times for copies of one label. */
  readonly labels: readonly LabelFace[]
  /** The address of the instance the QR points to. */
  readonly origin: string
  readonly format: LabelFormat
  /** The first free field of a sheet, counted from 1; always 1 on a roll. */
  readonly start: number
  /** The title of the document, which a viewer shows in its tab. */
  readonly title: string
}

/** The type sizes of a label in points: keeper, name, place, code. */
const sizes: Readonly<Record<LabelFormat, readonly [number, number, number, number]>> = {
  roll: [6.5, 9, 6.5, 6],
  sheet: [7.5, 10, 7.5, 7],
}

/** The inner margin of a label, in millimetres: a sheet has no gaps, so its labels need more. */
const padding: Readonly<Record<LabelFormat, number>> = { roll: 2, sheet: 3 }

/**
 * The QR code as an SVG in the given size, black on white with its quiet zone
 * of four modules. Correction level Q, a quarter of the code may go missing:
 * a label gets dusty and scratched over ten years.
 */
export function qrSvg(address: string, sizeMm: number): string {
  const { data, size } = encode(address, { ecc: 'Q', border: 4 })
  let path = ''

  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        path += `M${String(x)} ${String(y)}h1v1h-1z`
      }
    })
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(size)} ${String(size)}" ` +
    `width="${String(sizeMm)}mm" height="${String(sizeMm)}mm" shape-rendering="crispEdges">` +
    `<rect width="${String(size)}" height="${String(size)}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  )
}

function label(face: LabelFace, origin: string, qrMm: number): string {
  const name = face.name ? `<div class="name">${text(face.name)}</div>` : ''
  const place = face.place ? `<div class="place">${text(face.place)}</div>` : ''

  return (
    `<div class="label">${qrSvg(labelAddress(origin, face.code), qrMm)}<div class="words"><div class="top">` +
    `<div class="keeper">${text(face.keeper)}</div>${name}${place}</div>` +
    `<div class="code">${text(printedLabelCode(face.code))}</div></div></div>`
  )
}

/** The print job for the renderer. */
export function labelPrintJob(print: LabelPrint): PrintJob {
  const layout = labelLayouts[print.format]
  const [keeper, name, place, code] = sizes[print.format]
  const inner = padding[print.format]
  // Copies of one label are one face many times over; its QR is worked out once.
  const drawn = new Map<LabelFace, string>()
  const labels = print.labels.map((face) => {
    const known = drawn.get(face) ?? label(face, print.origin, layout.qrMm)

    drawn.set(face, known)

    return known
  })
  const fields = layout.columns * layout.rows
  let body: string

  if (print.format === 'roll') {
    body = labels.map((one) => `<div class="page">${one}</div>`).join('')
  } else {
    // Field by field from the first free one, the used ones left empty; what
    // does not fit goes on at the first field of the next sheet.
    const cells = [...Array.from({ length: print.start - 1 }, () => '<div></div>'), ...labels]
    const sheets: string[] = []

    for (let at = 0; at < cells.length; at += fields) {
      sheets.push(`<div class="page sheet">${cells.slice(at, at + fields).join('')}</div>`)
    }

    body = sheets.join('')
  }

  const page =
    print.format === 'roll'
      ? `${String(layout.widthMm)}mm ${String(layout.heightMm)}mm`
      : '210mm 297mm'
  const style = [
    fontFaces([400, 700]),
    `@page{size:${page};margin:0}`,
    `html,body{margin:0;padding:0}`,
    `body{font-family:${typeface};color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    `.page{break-after:page}`,
    `.page:last-child{break-after:auto}`,
    // The fields of a sheet sit half a millimetre down: 8 rows of 37 mm leave
    // one millimetre of the 297, split between the top and the bottom.
    `.sheet{width:210mm;height:297mm;box-sizing:border-box;padding-top:0.5mm;display:grid;` +
      `grid-template-columns:repeat(3,70mm);grid-auto-rows:37mm;align-content:start}`,
    `.label{width:${String(layout.widthMm)}mm;height:${String(layout.heightMm)}mm;box-sizing:border-box;` +
      `padding:${String(inner)}mm;display:flex;gap:1.5mm;align-items:center;overflow:hidden}`,
    `.label svg{flex:none}`,
    `.words{flex:1;min-width:0;align-self:stretch;display:flex;flex-direction:column;` +
      `justify-content:space-between;padding:0.6mm 0}`,
    `.top{display:flex;flex-direction:column;gap:0.5mm}`,
    `.keeper{font-size:${String(keeper)}pt;line-height:1.2}`,
    // Two lines at most: a long name is cut rather than pushing the code off.
    `.name{font-size:${String(name)}pt;font-weight:700;line-height:1.15;` +
      `overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}`,
    `.place{font-size:${String(place)}pt;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
    `.code{font-size:${String(code)}pt;letter-spacing:0.03em;white-space:nowrap}`,
  ].join('')

  return {
    html: `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${text(print.title)}</title><style>${style}</style></head><body>${body}</body></html>`,
    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    ...(print.format === 'roll'
      ? { size: { width: `${String(layout.widthMm)}mm`, height: `${String(layout.heightMm)}mm` } }
      : {}),
  }
}
