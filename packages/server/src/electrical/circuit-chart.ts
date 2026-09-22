import {
  cableInstallationMethodLabel,
  cableLengthText,
  cableText,
  type Circuit,
  distributionBoardKindLabel,
  type DistributionBoardKind,
  type IsoDate,
  overcurrentText,
  rcdText,
} from '@opengewerk/domain'

import type { PageMargin, PrintJob } from '../documents/renderer.js'
import { fontFaces, present, text, typeface } from '../documents/template.js'

/**
 * The circuit chart of one or more boards, the list that hangs on the inside
 * of the door: which breaker feeds what, behind which RCD, over which cable.
 *
 * It is the same structure the office and the site work on, printed, and the
 * point of printing it is the next person who opens the door, who may not be
 * from this business at all. So it says who keeps it and how current it is,
 * and it prints what is known about a circuit and nothing in place of what is
 * not: an empty cell is a question for whoever reads it, a guessed value is a
 * wrong answer.
 *
 * Landscape, because seven columns do not fit the width of a portrait sheet
 * with room to read them, and one board per page and onwards, because each
 * board has a door of its own.
 */

export interface ChartBoard {
  readonly designation: string
  readonly kind: DistributionBoardKind
  readonly location: string | null
  /** When anything on the board last changed, the chart's "Stand". */
  readonly changedOn: IsoDate
  /**
   * The circuits in the order of the board, grouped by section. A group
   * without a section holds the circuits that hang on the board directly.
   */
  readonly groups: readonly {
    readonly section: string | null
    readonly circuits: readonly ChartCircuit[]
  }[]
}

export type ChartCircuit = Pick<
  Circuit,
  | 'designation'
  | 'consumer'
  | 'overcurrentDevice'
  | 'tripCharacteristic'
  | 'ratedCurrentMilli'
  | 'rcdType'
  | 'ratedResidualCurrentMilli'
  | 'cableType'
  | 'cableCores'
  | 'cableCrossSectionMilli'
  | 'cableLengthMilli'
  | 'cableInstallationMethod'
>

export interface CircuitChart {
  /** Who keeps the chart: the business, with a way to reach it. */
  readonly keeper: { readonly name: string; readonly phone: string | null }
  readonly installation: string
  /** The building, as a line: `Einfamilienhaus, Hauptstraße 1, 68535 Edingen`. */
  readonly site: string
  readonly boards: readonly ChartBoard[]
}

/** Narrow margins: the chart is a table and wants the page, not a letterhead. */
const margin: PageMargin = { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' }

function day(on: IsoDate): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** A cell: the value, or nothing, never a dash standing in for one. */
function cell(value: string | null, className = ''): string {
  return `<td${className ? ` class="${className}"` : ''}>${present(value) ? text(value) : ''}</td>`
}

function circuitRow(circuit: ChartCircuit): string {
  return `<tr>
    ${cell(circuit.designation, 'designation')}
    ${cell(circuit.consumer)}
    ${cell(overcurrentText(circuit), 'figure')}
    ${cell(rcdText(circuit), 'figure')}
    ${cell(cableText(circuit), 'figure')}
    ${cell(cableLengthText(circuit), 'figure')}
    ${cell(
      circuit.cableInstallationMethod === null
        ? null
        : cableInstallationMethodLabel[circuit.cableInstallationMethod],
      'figure',
    )}
  </tr>`
}

function boardPage(chart: CircuitChart, board: ChartBoard): string {
  const sectioned = board.groups.some((group) => group.section !== null)
  const rows = board.groups
    .map((group) => {
      // A board with sections gets a heading for each of them, and one for
      // the circuits that hang on the board directly, so that nobody reads
      // those as part of the first section. A board without any gets none.
      const heading = sectioned
        ? `<tr class="section"><td colspan="7">${text(group.section ?? 'Ohne Feld')}</td></tr>`
        : ''

      return heading + group.circuits.map(circuitRow).join('')
    })
    .join('')
  const empty = board.groups.every((group) => group.circuits.length === 0)
  const title = `${distributionBoardKindLabel[board.kind]} ${board.designation}`

  return `<section class="board">
  <header class="head">
    <div>
      <h1>Stromkreisverzeichnis</h1>
      <p class="board-name">${text(title)}${
        present(board.location) ? `<span class="location">, ${text(board.location)}</span>` : ''
      }</p>
      <p class="where">${text(chart.installation)}${
        present(chart.site) ? `, ${text(chart.site)}` : ''
      }</p>
    </div>
    <div class="keeper">
      <div class="keeper-name">${text(chart.keeper.name)}</div>
      ${present(chart.keeper.phone) ? `<div>Telefon ${text(chart.keeper.phone)}</div>` : ''}
      <div>Stand ${day(board.changedOn)}</div>
    </div>
  </header>
  ${
    empty
      ? '<p class="empty">Für diesen Verteiler ist noch kein Stromkreis erfasst.</p>'
      : `<table class="circuits">
    <thead>
      <tr>
        <th class="designation">Stromkreis</th>
        <th>Verbraucher</th>
        <th>Schutzeinrichtung</th>
        <th>RCD</th>
        <th>Leitung</th>
        <th>Länge</th>
        <th>Verlegeart</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
  }
</section>`
}

const pageStyle = `
  html {
    font-family: ${typeface};
    font-size: 9.5pt;
    line-height: 1.35;
    color: #1b2430;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { margin: 0; }
  .board + .board { break-before: page; }
  .head {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm;
    border-bottom: 0.6pt solid #1b2430; padding-bottom: 2.5mm; margin-bottom: 3mm;
  }
  h1 { font-size: 16pt; font-weight: 600; margin: 0 0 1mm; }
  .board-name { font-size: 12pt; font-weight: 600; margin: 0 0 0.8mm; }
  .location { font-weight: 400; }
  .where { margin: 0; color: #5b6573; }
  .keeper { text-align: right; font-size: 8.5pt; color: #5b6573; white-space: nowrap; }
  .keeper-name { font-size: 10pt; font-weight: 600; color: #1b2430; }
  .circuits { width: 100%; border-collapse: collapse; }
  .circuits th {
    font-size: 8.5pt; font-weight: 600; text-align: left;
    border-bottom: 0.6pt solid #1b2430; padding: 1.2mm 1.5mm;
  }
  .circuits td { padding: 1.4mm 1.5mm; border-bottom: 0.3pt solid #d5d9de; vertical-align: top; }
  .circuits tr { break-inside: avoid; }
  .circuits .designation { font-weight: 600; white-space: nowrap; width: 22mm; }
  .circuits .figure { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .circuits tr.section td {
    font-weight: 600; padding-top: 3mm; border-bottom: 0.6pt solid #9aa3ad;
  }
  .circuits tr.section { break-after: avoid; }
  .empty { color: #5b6573; }
`

function footer(chart: CircuitChart): string {
  return `<style>
    ${fontFaces([400])}
    .footer {
      font-family: ${typeface}; font-size: 7pt; color: #5b6573;
      width: 100%; box-sizing: border-box; padding: 0 12mm;
      display: flex; justify-content: space-between;
      -webkit-print-color-adjust: exact;
    }
  </style>
  <div class="footer">
    <span>Stromkreisverzeichnis, ${text(chart.installation)}</span>
    <span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>
  </div>`
}

export function circuitChartJob(chart: CircuitChart): Required<PrintJob> {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${text(`Stromkreisverzeichnis, ${chart.installation}`)}</title>
<style>
${fontFaces([400, 600])}
${pageStyle}
</style>
</head>
<body>
${
  chart.boards.length === 0
    ? `<section class="board"><h1>Stromkreisverzeichnis</h1><p class="empty">${text(
        chart.installation,
      )} hat noch keinen Verteiler.</p></section>`
    : chart.boards.map((board) => boardPage(chart, board)).join('\n')
}
</body>
</html>`

  return { html, footerHtml: footer(chart), margin, landscape: true }
}
