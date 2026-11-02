import {
  type Appliance,
  applianceMobilityLabel,
  type FormDefinition,
  type FormValues,
  type IsoDate,
  nextInspectionOn,
} from '@opengewerk/domain'
import {
  fontFaces,
  type PageMargin,
  present,
  type PrintJob,
  text,
  typeface,
} from '@opengewerk/platform-server'

/**
 * The report of a site after DGUV Vorschrift 3 (#303): every appliance of the
 * register with the result of its last signed test and the day of the next,
 * one line each, on landscape A4 like a protocol.
 *
 * Printed on every request out of the register and kept nowhere, like the
 * circuit chart. It says what stands now; the measured values are in the
 * protocol of each appliance, which the report names by its day.
 */

/** The last signed test of an appliance, as the report reads it. */
export interface LastTest {
  readonly definition: FormDefinition
  readonly values: FormValues
  readonly performedOn: IsoDate
}

export interface ReportedAppliance {
  readonly appliance: Pick<
    Appliance,
    | 'inventoryNumber'
    | 'designation'
    | 'manufacturer'
    | 'model'
    | 'protectionClass'
    | 'mobility'
    | 'location'
  >
  /** Null for an appliance nobody has tested yet. */
  readonly last: LastTest | null
}

export interface ApplianceReport {
  readonly keeper: { readonly name: string; readonly phone: string | null }
  /** The site as a line, with its address. */
  readonly site: string
  readonly customer: string
  /** The day the report stands at. */
  readonly on: IsoDate
  readonly appliances: readonly ReportedAppliance[]
}

const margin: PageMargin = { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' }

function day(on: string): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** The last day of the month a day is in, as a date. */
function endOfMonth(on: IsoDate): IsoDate {
  const [year, month] = on.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return `${on.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

/**
 * What a test found, by the field `verdict` of its form, and whether it found
 * defects; a form without that field says nothing either way.
 */
function verdictOf(test: LastTest): { readonly said: string; readonly defects: boolean } {
  const field = test.definition.sections
    .flatMap((section) => section.fields)
    .find((entry) => entry.key === 'verdict')
  const value = test.values['verdict']
  const option =
    field?.kind === 'choice' ? field.options.find((entry) => entry.value === value) : undefined

  return { said: option?.label ?? '', defects: value === 'defects' }
}

/** The day the next test is due, as the last one names it. */
function nextOf(test: LastTest): IsoDate | null {
  return nextInspectionOn(test.definition, test.values, test.performedOn)
}

/** The counts under the table: how many, with which result, and how many due this month. */
export function reportSummary(report: ApplianceReport): string {
  const tested = report.appliances.filter((entry) => entry.last !== null)
  const defects = tested.filter((entry) => entry.last && verdictOf(entry.last).defects).length
  const untested = report.appliances.length - tested.length
  const until = endOfMonth(report.on)
  const due = tested.filter((entry) => {
    const next = entry.last ? nextOf(entry.last) : null

    return next !== null && next <= until
  }).length
  const count = report.appliances.length

  return [
    `${count} ${count === 1 ? 'Gerät' : 'Geräte'}: ${tested.length - defects} ohne Mängel, ${defects} mit Mängeln, ${untested} noch nicht geprüft.`,
    `Fällig bis zum ${day(until)}: ${due}.`,
  ].join(' ')
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
  .where { margin: 0; color: #5b6573; }
  .keeper { text-align: right; font-size: 8.5pt; color: #5b6573; white-space: nowrap; }
  .keeper-name { font-size: 10pt; font-weight: 600; color: #1b2430; }
  table { width: 100%; border-collapse: collapse; }
  th {
    font-size: 8pt; font-weight: 600; text-align: left; vertical-align: bottom;
    border-bottom: 0.6pt solid #1b2430; padding: 1mm 1.5mm;
  }
  td { padding: 1.2mm 1.5mm; border-bottom: 0.3pt solid #d5d9de; vertical-align: top; }
  tr { break-inside: avoid; }
  .number { font-weight: 600; white-space: nowrap; }
  .maker { color: #5b6573; }
  .figure { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .outside { font-weight: 600; color: #b3261e; }
  .untested { color: #5b6573; }
  .summary { margin: 3mm 0 0; }
  .note { margin: 1mm 0 0; font-size: 8pt; color: #5b6573; }
`

function row(entry: ReportedAppliance): string {
  const { appliance, last } = entry
  const maker = [appliance.manufacturer, appliance.model].filter(present).join(' ')
  const verdict = last ? verdictOf(last) : null
  const next = last ? nextOf(last) : null
  const result =
    verdict === null
      ? '<span class="untested">noch nicht geprüft</span>'
      : verdict.defects
        ? `<span class="outside">${text(verdict.said)}</span>`
        : text(verdict.said)

  return `<tr>
    <td class="number">${text(appliance.inventoryNumber ?? '')}</td>
    <td>${text(appliance.designation)}${present(maker) ? `<div class="maker">${text(maker)}</div>` : ''}</td>
    <td>${text(appliance.protectionClass)}</td>
    <td>${text(applianceMobilityLabel[appliance.mobility])}</td>
    <td>${text(appliance.location ?? '')}</td>
    <td class="figure">${last ? day(last.performedOn) : ''}</td>
    <td>${result}</td>
    <td class="figure">${next ? day(next) : ''}</td>
  </tr>`
}

function footer(report: ApplianceReport): string {
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
    <span>Prüfbericht nach DGUV Vorschrift 3, ${text(report.site)}, Stand ${day(report.on)}</span>
    <span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>
  </div>`
}

export function applianceReportJob(report: ApplianceReport): Required<Omit<PrintJob, 'size'>> {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${text(`Prüfbericht nach DGUV Vorschrift 3, ${report.site}`)}</title>
<style>
${fontFaces([400, 600])}
${pageStyle}
</style>
</head>
<body>
<header class="head">
  <div>
    <h1>Prüfbericht nach DGUV Vorschrift 3</h1>
    <p class="where">${text(report.site)}${present(report.customer) ? `, für ${text(report.customer)}` : ''}</p>
    <p class="where">Stand ${day(report.on)}, je Gerät das letzte unterschriebene Protokoll</p>
  </div>
  <div class="keeper">
    <div class="keeper-name">${text(report.keeper.name)}</div>
    ${present(report.keeper.phone) ? `<div>Telefon ${text(report.keeper.phone)}</div>` : ''}
  </div>
</header>
${
  report.appliances.length === 0
    ? '<p class="untested">An diesem Objekt gibt es noch kein Gerät.</p>'
    : `<table>
  <thead><tr><th>Inventar</th><th>Gerät</th><th>Schutzklasse</th><th>Art</th><th>Standort</th><th>Geprüft am</th><th>Ergebnis</th><th>Nächste Prüfung</th></tr></thead>
  <tbody>${report.appliances.map(row).join('')}</tbody>
</table>`
}
<p class="summary">${text(reportSummary(report))}</p>
<p class="note">Die Prüffristen legt der Betreiber nach seiner Gefährdungsbeurteilung fest. Die einzelnen Messwerte stehen im Prüfprotokoll des Geräts.</p>
</body>
</html>`

  return { html, footerHtml: footer(report), margin, landscape: true }
}
