import {
  type BlockField,
  type FieldValue,
  type FormDefinition,
  type FormField,
  formatMeasured,
  type FormRecordStatus,
  type FormValues,
  type GroupBlock,
  type GroupField,
  type IsoDate,
  limitVerdict,
  type MeasurementField,
  measurementUnitSign,
  type RuleSet,
  signatureBox,
  type SignatureValue,
} from '@opengewerk/domain'

import type { PageMargin, PrintJob } from '../documents/renderer.js'
import { fontFaces, present, text, typeface } from '../documents/template.js'

/**
 * A filled form on paper (#78), the test protocol of #79 first.
 *
 * Printed on every request out of the record and kept nowhere, like the
 * circuit chart: a signed protocol does not change any more, and everything
 * it depends on is in it, down to the circuit each block was measured on, so
 * the same record prints the same page next year. A draft says so across the
 * page.
 *
 * Every measured value stands with its verdict, and the limits are listed
 * with their sources under the table: the reader of a protocol has to be able
 * to check what "outside" was measured against.
 */

export interface PrintedProtocol {
  readonly definition: FormDefinition
  readonly values: FormValues
  readonly performedOn: IsoDate
  readonly status: FormRecordStatus
  /** Who keeps the protocol: the business, with a way to reach it. */
  readonly keeper: { readonly name: string; readonly phone: string | null }
  readonly installation: string
  /** The building, as a line. */
  readonly site: string
  /** The limits of the trade packages, asked on the day of the test. */
  readonly rules: RuleSet
}

const margin: PageMargin = { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' }

function day(on: string): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** A value as it is read on paper, or nothing for a field left empty. */
function shown(field: BlockField, value: FieldValue | undefined): string {
  if (value === undefined) {
    return ''
  }

  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? text(value).replaceAll('\n', '<br>') : ''
    case 'number':
    case 'measurement':
      return typeof value === 'number'
        ? text(formatMeasured(value, field.unit, field.decimals))
        : ''
    case 'choice':
      return text(field.options.find((option) => option.value === value)?.label ?? '')
    case 'yes_no':
      return value === true ? 'ja' : value === false ? 'nein' : ''
    case 'photo':
      return 'bei den Dateien der Anlage'
  }
}

function signatureOf(value: FormValue | undefined): string {
  const signature = value as SignatureValue | undefined

  if (!signature || typeof signature !== 'object' || !('path' in signature)) {
    return '<p class="empty">Noch nicht unterschrieben.</p>'
  }

  // The path has the shape the signature pad draws and nothing else; the
  // check on the way in makes sure of it, so it can stand in the SVG as it is.
  return `<div class="signature">
    <svg class="signature-picture" viewBox="0 0 ${String(signatureBox.width)} ${String(signatureBox.height)}" aria-hidden="true"><path d="${signature.path}" fill="none" stroke="#1b2430" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div>${text(signature.name)}, ${day(signature.signedAt.slice(0, 10))}</div>
  </div>`
}

type FormValue = FormValues[string]

function fieldRow(
  field: FormField,
  value: FormValue | undefined,
  protocol: PrintedProtocol,
): string {
  if (field.kind === 'signature') {
    return `<tr><th>${text(field.label)}</th><td>${signatureOf(value)}</td></tr>`
  }

  if (field.kind === 'group') {
    return ''
  }

  const printed = shown(field, value as FieldValue | undefined)
  const verdict =
    field.kind === 'measurement' && typeof value === 'number'
      ? limitVerdict(field, value, {
          rules: protocol.rules,
          on: protocol.performedOn,
          circuit: null,
        })
      : null

  return `<tr><th>${text(field.label)}</th><td>${printed}${
    verdict && verdict.within === false
      ? ' <span class="outside">außerhalb des Grenzwerts</span>'
      : ''
  }</td></tr>`
}

function groupTable(
  field: GroupField,
  value: FormValue | undefined,
  protocol: PrintedProtocol,
): string {
  const blocks = Array.isArray(value) ? (value as readonly GroupBlock[]) : []

  if (blocks.length === 0) {
    return `<p class="empty">Keine Einträge unter ${text(field.label)}.</p>`
  }

  const header = field.fields
    .map((nested) => {
      const unit =
        nested.kind === 'measurement' || nested.kind === 'number'
          ? ` in ${measurementUnitSign[nested.unit]}`
          : ''

      return `<th>${text(nested.label)}${unit}</th>`
    })
    .join('')
  const rows = blocks
    .map((block) => {
      const name = block.circuit
        ? `${text(block.circuit.designation)}${
            present(block.circuit.consumer)
              ? `<div class="consumer">${text(block.circuit.consumer)}</div>`
              : ''
          }`
        : ''
      const cells = field.fields
        .map((nested) => {
          const entry = block.values[nested.key]

          if (nested.kind === 'measurement' && typeof entry === 'number') {
            const verdict = limitVerdict(nested, entry, {
              rules: protocol.rules,
              on: protocol.performedOn,
              circuit: block.circuit,
            })

            return `<td class="figure${verdict.within === false ? ' outside' : ''}">${text(
              formatMeasured(entry, nested.unit, nested.decimals).replace(
                ` ${measurementUnitSign[nested.unit]}`,
                '',
              ),
            )}${verdict.within === false ? ' !' : ''}</td>`
          }

          return `<td>${shown(nested, entry)}</td>`
        })
        .join('')

      return `<tr><td class="circuit">${name}</td>${cells}</tr>`
    })
    .join('')

  return `<table class="blocks">
    <thead><tr><th class="circuit">${field.repeat === 'circuits' ? 'Stromkreis' : ''}</th>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${limitLegend(field.fields, protocol)}`
}

/** The limits a table was judged against, each with its source, under the table. */
function limitLegend(fields: readonly BlockField[], protocol: PrintedProtocol): string {
  const entries = fields
    .filter(
      (field): field is MeasurementField =>
        field.kind === 'measurement' && field.limit !== undefined,
    )
    .map((field) => {
      const limit = field.limit
      const rule =
        limit?.kind === 'at_least' || limit?.kind === 'at_most'
          ? protocol.rules.at(limit.rule, protocol.performedOn)
          : null
      const said =
        limit?.kind === 'loop_impedance'
          ? `höchstens U0 / Ia aus der Schutzeinrichtung des Stromkreises; ${text(
              ['nominal_voltage', 'factor_b', 'factor_c', 'factor_d']
                .map(
                  (key) => protocol.rules.at(`elektro.loop.${key}`, protocol.performedOn)?.source,
                )
                .filter(present)
                .join('; '),
            )}`
          : limit?.kind === 'rcd_trip_current'
            ? `höchstens IΔn des Stromkreises; ${text(
                protocol.rules.at('elektro.rcd.trip_current_maximum', protocol.performedOn)
                  ?.source ?? '',
              )}`
            : rule
              ? `${limit?.kind === 'at_least' ? 'mindestens' : 'höchstens'} ${text(
                  formatMeasured(
                    limitVerdict(field, null, {
                      rules: protocol.rules,
                      on: protocol.performedOn,
                      circuit: null,
                    }).limitMilli ?? 0,
                    field.unit,
                    field.decimals,
                  ),
                )}; ${text(rule.source)}`
              : 'für diesen Tag kein Grenzwert hinterlegt'

      return `<li><strong>${text(field.label)}:</strong> ${said}</li>`
    })

  return entries.length === 0
    ? ''
    : `<ul class="limits"><li class="limits-head">Ein ! steht an einem Wert außerhalb seines Grenzwerts. Grenzwerte:</li>${entries.join('')}</ul>`
}

function section(protocol: PrintedProtocol, section: FormDefinition['sections'][number]): string {
  const plain = section.fields.filter((field) => field.kind !== 'group')
  const groups = section.fields.filter((field): field is GroupField => field.kind === 'group')

  return `<section class="part">
  <h2>${text(section.title)}${present(section.hint) ? `<span class="hint">${text(section.hint)}</span>` : ''}</h2>
  ${
    plain.length > 0
      ? `<table class="fields"><tbody>${plain
          .map((field) => fieldRow(field, protocol.values[field.key], protocol))
          .join('')}</tbody></table>`
      : ''
  }
  ${groups.map((group) => groupTable(group, protocol.values[group.key], protocol)).join('')}
</section>`
}

const pageStyle = `
  html {
    font-family: ${typeface};
    font-size: 9pt;
    line-height: 1.35;
    color: #1b2430;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { margin: 0; }
  .head {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm;
    border-bottom: 0.6pt solid #1b2430; padding-bottom: 2.5mm; margin-bottom: 3mm;
  }
  h1 { font-size: 15pt; font-weight: 600; margin: 0 0 1mm; }
  h2 { font-size: 11pt; font-weight: 600; margin: 4mm 0 1.5mm; break-after: avoid; }
  h2 .hint { font-size: 8.5pt; font-weight: 400; color: #5b6573; margin-left: 3mm; }
  .where { margin: 0; color: #5b6573; }
  .keeper { text-align: right; font-size: 8.5pt; color: #5b6573; white-space: nowrap; }
  .keeper-name { font-size: 10pt; font-weight: 600; color: #1b2430; }
  .draft {
    font-size: 11pt; font-weight: 600; color: #c8671f; border: 0.8pt solid #c8671f;
    padding: 1mm 2mm; margin: 0 0 3mm; display: inline-block;
  }
  .fields { border-collapse: collapse; width: 100%; }
  .fields th {
    text-align: left; font-weight: 400; color: #5b6573; width: 70mm;
    padding: 1mm 2mm 1mm 0; vertical-align: top;
  }
  .fields td { padding: 1mm 0; vertical-align: top; }
  .fields tr { break-inside: avoid; }
  .blocks { width: 100%; border-collapse: collapse; }
  .blocks th {
    font-size: 8pt; font-weight: 600; text-align: left; vertical-align: bottom;
    border-bottom: 0.6pt solid #1b2430; padding: 1mm 1.5mm;
  }
  .blocks td { padding: 1.2mm 1.5mm; border-bottom: 0.3pt solid #d5d9de; vertical-align: top; }
  .blocks tr { break-inside: avoid; }
  .blocks .circuit { font-weight: 600; width: 30mm; }
  .blocks .consumer { font-weight: 400; color: #5b6573; }
  .blocks .figure { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .outside { font-weight: 600; color: #b3261e; }
  .limits { list-style: none; padding: 0; margin: 2mm 0 0; font-size: 8pt; color: #5b6573; }
  .limits li { margin: 0.5mm 0; }
  .limits-head { font-weight: 600; }
  .signature-picture { display: block; width: 70mm; height: 28mm; }
  .empty { color: #5b6573; }
`

function footer(protocol: PrintedProtocol): string {
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
    <span>${text(protocol.definition.title)}, ${text(protocol.installation)}, ${day(protocol.performedOn)}</span>
    <span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>
  </div>`
}

export function protocolPrintJob(protocol: PrintedProtocol): Required<PrintJob> {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${text(`${protocol.definition.title}, ${protocol.installation}`)}</title>
<style>
${fontFaces([400, 600])}
${pageStyle}
</style>
</head>
<body>
<header class="head">
  <div>
    <h1>${text(protocol.definition.title)}</h1>
    <p class="where">${text(protocol.installation)}${present(protocol.site) ? `, ${text(protocol.site)}` : ''}</p>
    <p class="where">Geprüft am ${day(protocol.performedOn)}</p>
  </div>
  <div class="keeper">
    <div class="keeper-name">${text(protocol.keeper.name)}</div>
    ${present(protocol.keeper.phone) ? `<div>Telefon ${text(protocol.keeper.phone)}</div>` : ''}
  </div>
</header>
${protocol.status === 'draft' ? '<p class="draft">Entwurf, noch nicht unterschrieben</p>' : ''}
${protocol.definition.sections.map((entry) => section(protocol, entry)).join('\n')}
</body>
</html>`

  return { html, footerHtml: footer(protocol), margin, landscape: true }
}
