import { PDFDocument } from '@cantoo/pdf-lib'
import { fieldsOf, type IsoDate, occasionKey } from '@opengewerk/domain'
import { fontFaces, type PrintJob, text } from '@opengewerk/platform-server'

import {
  type ApplianceReport,
  applianceTable,
  day,
  type LastTest,
  nextOf,
  reportFooter,
  reportHead,
  reportMargin,
  reportStyle,
  verdictOf,
} from './appliance-report.js'

/**
 * The test of the electrical installation of a site (#302), a report over
 * the tests after DIN VDE 0100-600, DIN VDE 0105-100 and DGUV Vorschrift 3,
 * and no form of its own. It brings together what is recorded already, the last signed test of each installation and of each
 * appliance, so nothing is filled in twice and the deadlines stay with the
 * protocols.
 *
 * The first part says the result of the whole, a line for each installation
 * and appliance with its test, its result and the day of the next, and the
 * next day a test is due at the site. Behind it come the protocols of the
 * installations as each prints on its own (`bound`); the measured values of
 * the appliances stay in their protocols, as in the report of #303.
 */

const title = 'Prüfung der Elektroinstallation'

/** An installation of the site with its last signed test of the whole of it. */
export interface ReportedInstallation {
  readonly designation: string
  /** Its kind, as the screens name it. */
  readonly kind: string
  /** Null for an installation nobody has tested yet. */
  readonly last: LastTest | null
  /** The day its next inspection is due, the day of its deadline (#822), or null. */
  readonly next: IsoDate | null
  /** The test of a part after the last test of the whole that drew that day forward, or null. */
  readonly sooner: LastTest | null
}

export interface InspectionReport extends ApplianceReport {
  readonly installations: readonly ReportedInstallation[]
}

/** What a column says of the test: the title of its form without the word every protocol starts with. */
function testOf(last: LastTest): string {
  return last.definition.title.replace(/^Prüfprotokoll /, '')
}

/** "2 Anlagen: 1 ohne Mängel, …", or `none` where the site has none of the kind. */
function counted(
  lasts: readonly (LastTest | null)[],
  [one, many, none]: readonly [string, string, string],
): string {
  const tested = lasts.filter((last): last is LastTest => last !== null)
  const defects = tested.filter((last) => verdictOf(last).defects).length

  return lasts.length === 0
    ? none
    : `${String(lasts.length)} ${lasts.length === 1 ? one : many}: ${String(tested.length - defects)} ohne Mängel, ${String(defects)} mit Mängeln, ${String(lasts.length - tested.length)} noch nicht geprüft.`
}

/**
 * The result of the whole, as the first part of the report says it: defects
 * where any last test found some, otherwise whether everything is tested, and
 * under it the counts and the next day a test is due at the site.
 */
export function inspectionResult(report: InspectionReport): {
  readonly verdict: string
  readonly defects: boolean
  readonly lines: readonly string[]
} {
  const lasts = [...report.installations, ...report.appliances].map((entry) => entry.last)
  const tested = lasts.filter((last): last is LastTest => last !== null)
  const defects = tested.some((last) => verdictOf(last).defects)
  const next = [
    ...report.installations.map((entry) => entry.next),
    ...report.appliances.map((entry) => (entry.last ? nextOf(entry.last) : null)),
  ]
    .filter((on) => on !== null)
    .sort()[0]

  return {
    verdict: defects
      ? 'Mängel festgestellt'
      : tested.length === 0
        ? 'Noch nichts geprüft'
        : tested.length < lasts.length
          ? 'Noch nicht alles geprüft'
          : 'Keine Mängel festgestellt',
    defects,
    lines: [
      `${counted(
        report.installations.map((entry) => entry.last),
        ['Anlage', 'Anlagen', 'Keine Anlage.'],
      )} ${counted(
        report.appliances.map((entry) => entry.last),
        ['Gerät', 'Geräte', 'Kein Gerät.'],
      )}`,
      ...(next === undefined ? [] : [`Nächste Prüfung am Objekt: ${day(next)}.`]),
    ],
  }
}

const style = `
  h2 { font-size: 10.5pt; font-weight: 600; margin: 4mm 0 1.5mm; }
  .result {
    box-sizing: border-box; border: 0.6pt solid #d5d9de; border-radius: 1mm; padding: 2mm 3mm;
  }
  .result p { margin: 0; }
  .verdict { font-size: 11pt; font-weight: 600; }
`

/**
 * Under the test of the whole, the test of a part that drew the next day
 * forward (#822): "Vorgezogen durch die Erweiterung vom 20.10.2026".
 */
function drawnForward(sooner: LastTest): string {
  const field = fieldsOf(sooner.definition).find((entry) => entry.key === occasionKey)
  const option =
    field?.kind === 'choice'
      ? field.options.find((entry) => entry.value === sooner.values[occasionKey])
      : undefined

  return `Vorgezogen durch die ${option?.label ?? 'Teilprüfung'} vom ${day(sooner.performedOn)}`
}

function installationRow(entry: ReportedInstallation): string {
  const { last, next, sooner } = entry
  const verdict = last ? verdictOf(last) : null
  const result =
    verdict === null
      ? '<span class="untested">noch nicht geprüft</span>'
      : verdict.defects
        ? `<span class="outside">${text(verdict.said)}</span>`
        : text(verdict.said)

  return `<tr>
    <td>${text(entry.designation)}<div class="maker">${text(entry.kind)}</div></td>
    <td>${last ? text(testOf(last)) : ''}${
      sooner ? `<div class="maker">${text(drawnForward(sooner))}</div>` : ''
    }</td>
    <td class="figure">${last ? day(last.performedOn) : ''}</td>
    <td>${result}</td>
    <td class="figure">${next ? day(next) : ''}</td>
  </tr>`
}

export function inspectionReportJob(report: InspectionReport): Required<Omit<PrintJob, 'size'>> {
  const result = inspectionResult(report)
  const protocols = report.installations.some((entry) => entry.last !== null)
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${text(`${title}, ${report.site}`)}</title>
<style>
${fontFaces([400, 600])}
${reportStyle}
${style}
</style>
</head>
<body>
${reportHead(title, report, 'je Anlage und Gerät die letzte unterschriebene Prüfung')}
<div class="result">
  <p class="verdict${result.defects ? ' outside' : ''}">Ergebnis: ${text(result.verdict)}</p>
  ${result.lines.map((line) => `<p>${text(line)}</p>`).join('\n  ')}
</div>
<h2>Anlagen</h2>
${
  report.installations.length === 0
    ? '<p class="untested">An diesem Objekt gibt es noch keine Anlage.</p>'
    : `<table>
  <thead><tr><th>Anlage</th><th>Prüfung</th><th>Geprüft am</th><th>Ergebnis</th><th>Nächste Prüfung</th></tr></thead>
  <tbody>${report.installations.map(installationRow).join('')}</tbody>
</table>`
}
<h2>Geräte nach DGUV Vorschrift 3</h2>
${applianceTable(report.appliances)}
<p class="note">Die Prüffristen legt der Betreiber nach seiner Gefährdungsbeurteilung fest. ${
    protocols
      ? 'Die Protokolle der Anlagen folgen auf den nächsten Seiten, die Messwerte der Geräte stehen im Prüfprotokoll des Geräts.'
      : 'Die Messwerte der Geräte stehen im Prüfprotokoll des Geräts.'
  }</p>
</body>
</html>`

  return {
    html,
    footerHtml: reportFooter(`${title}, ${report.site}, Stand ${day(report.on)}`),
    margin: reportMargin,
    landscape: true,
  }
}

/**
 * The report and the protocols behind it as one PDF, in that order, each
 * part with its own pages as it was printed.
 */
export async function bound(parts: readonly Uint8Array[], name: string): Promise<Uint8Array> {
  const whole = await PDFDocument.create({ updateMetadata: false })

  whole.setTitle(name)

  for (const part of parts) {
    const source = await PDFDocument.load(part, { updateMetadata: false })
    const pages = await whole.copyPages(source, source.getPageIndices())

    for (const page of pages) {
      whole.addPage(page)
    }
  }

  return whole.save()
}
