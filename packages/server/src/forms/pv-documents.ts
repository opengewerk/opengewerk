import { azimuthText, type IsoDate } from '@opengewerk/domain'
import { type PrintJob, present, text } from '@opengewerk/platform-server'

import { day, reportFooter, reportMargin, reportStyle } from './appliance-report.js'

/**
 * The papers of a PV system for its operator (#305): the component list with
 * every serial number, the plan of its strings and the forecast of its yield.
 *
 * Printed from the structure as it stands for "Stringplan und
 * Komponentenliste", and from what a handover froze for the folder, which then
 * has the signed protocols behind it. Both come from this one page, so the
 * folder looks the same as what the office checked before handing it over.
 */

/** What a component is, in the words of the list. */
export const pvComponentKinds = {
  inverter: 'Wechselrichter',
  module: 'Modul',
  battery: 'Speicher',
  meter: 'Zähler',
  wallbox: 'Wallbox',
} as const

export type PvComponentKind = keyof typeof pvComponentKinds

export interface PvComponent {
  readonly kind: PvComponentKind
  readonly designation: string
  /** Maker and type, "JA Solar, JAM54S30-400/MR", where known. */
  readonly maker: string | null
  readonly serialNumber: string | null
  /** In watts, where the structure names it. */
  readonly ratedPowerW: number | null
}

export interface PvStringRow {
  readonly inverter: string
  readonly inverterModel: string | null
  readonly mppInput: number | null
  readonly designation: string
  readonly modules: number
  /** Of all its modules, in watts; null where one names none. */
  readonly ratedPowerW: number | null
  readonly azimuthDeg: number | null
  readonly tiltDeg: number | null
}

/** A PV system as its papers print it. */
export interface PvDossier {
  readonly keeper: { readonly name: string; readonly phone: string | null }
  readonly system: string
  /** The site on one line, with its address. */
  readonly site: string
  readonly customer: string
  readonly forecast: { readonly kwh: number; readonly source: string | null } | null
  readonly components: readonly PvComponent[]
  readonly strings: readonly PvStringRow[]
}

/** A signed protocol the folder holds, as it was named when it was handed over. */
export interface PvHandoverProtocol {
  readonly id: string
  readonly title: string
  readonly installation: string
  readonly performedOn: IsoDate
}

/** What a handover freezes: the papers of the day, the protocols behind them, and who handed them over. */
export interface PvHandoverContent extends PvDossier {
  readonly protocols: readonly PvHandoverProtocol[]
  readonly handedOverBy: string | null
}

const watts = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const peak = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('de-DE')

/** "10 kW" for an inverter, "400 W" for a module. */
function power(component: PvComponent): string {
  if (component.ratedPowerW === null) {
    return ''
  }

  return component.ratedPowerW >= 1000
    ? `${watts.format(component.ratedPowerW / 1000)} kW`
    : `${watts.format(component.ratedPowerW)} W`
}

function kwp(watt: number | null): string {
  return watt === null ? '' : `${peak.format(watt / 1000)} kWp`
}

/** The forecast as a sentence, or that there is none. */
export function forecastSentence(forecast: PvDossier['forecast']): string {
  return forecast === null
    ? 'Keine Ertragsprognose eingetragen.'
    : `Ertragsprognose: ${whole.format(forecast.kwh)} kWh im Jahr${
        present(forecast.source) ? `, Quelle: ${forecast.source}` : ''
      }.`
}

function componentTable(components: readonly PvComponent[]): string {
  if (components.length === 0) {
    return '<p class="note">Die PV-Struktur nennt noch keine Komponente.</p>'
  }

  return `<table>
    <thead><tr><th style="width: 30mm">Art</th><th style="width: 50mm">Bezeichnung</th><th>Hersteller und Typ</th><th style="width: 42mm">Seriennummer</th><th style="width: 22mm; text-align: right">Leistung</th></tr></thead>
    <tbody>${components
      .map(
        (component) => `<tr>
      <td>${text(pvComponentKinds[component.kind])}</td>
      <td>${text(component.designation)}</td>
      <td>${text(component.maker ?? '')}</td>
      <td>${present(component.serialNumber) ? text(component.serialNumber) : '<span class="untested">nicht erfasst</span>'}</td>
      <td class="figure" style="text-align: right">${text(power(component))}</td>
    </tr>`,
      )
      .join('')}</tbody>
  </table>`
}

function stringTable(strings: readonly PvStringRow[]): string {
  if (strings.length === 0) {
    return '<p class="note">Die PV-Struktur nennt noch keinen String.</p>'
  }

  const modules = strings.reduce((sum, entry) => sum + entry.modules, 0)
  const total = strings.every((entry) => entry.ratedPowerW !== null)
    ? strings.reduce((sum, entry) => sum + (entry.ratedPowerW ?? 0), 0)
    : null

  return `<table>
    <thead><tr><th>Wechselrichter</th><th style="width: 24mm; text-align: right">MPP-Eingang</th><th style="width: 34mm">String</th><th style="width: 18mm; text-align: right">Module</th><th style="width: 24mm; text-align: right">Leistung</th><th style="width: 32mm">Ausrichtung</th><th style="width: 18mm; text-align: right">Neigung</th></tr></thead>
    <tbody>${strings
      .map(
        (entry) => `<tr>
      <td>${text(entry.inverter)}${present(entry.inverterModel) ? `<div class="maker">${text(entry.inverterModel)}</div>` : ''}</td>
      <td class="figure" style="text-align: right">${entry.mppInput === null ? '' : String(entry.mppInput)}</td>
      <td>${text(entry.designation)}</td>
      <td class="figure" style="text-align: right">${String(entry.modules)}</td>
      <td class="figure" style="text-align: right">${text(kwp(entry.ratedPowerW))}</td>
      <td>${entry.azimuthDeg === null ? '' : text(azimuthText(entry.azimuthDeg))}</td>
      <td class="figure" style="text-align: right">${entry.tiltDeg === null ? '' : `${String(entry.tiltDeg)}°`}</td>
    </tr>`,
      )
      .join('')}
      <tr><td colspan="3" class="number">Zusammen</td><td class="figure number" style="text-align: right">${String(modules)}</td><td class="figure number" style="text-align: right">${text(kwp(total))}</td><td></td><td></td></tr>
    </tbody>
  </table>`
}

/**
 * The papers of a PV system on landscape A4: the head, for a handover what the
 * folder holds, the forecast, the components, the strings. `handedOverOn` is
 * the day of a handover, or null for the papers as the structure stands on `on`.
 */
export function pvDocumentsJob(
  dossier: PvDossier,
  on: IsoDate,
  handover: { readonly protocols: readonly PvHandoverProtocol[] } | null,
): Required<Omit<PrintJob, 'size'>> {
  const title = handover ? 'Unterlagen der PV-Anlage' : 'Stringplan und Komponentenliste'
  const holds = handover
    ? `<div class="box"><div class="box-title">In dieser Mappe</div><div>${text(
        [
          'Komponentenliste, Stringplan und Ertragsprognose',
          ...handover.protocols.map(
            (protocol) =>
              `${protocol.title}, ${protocol.installation}, vom ${day(protocol.performedOn)}`,
          ),
        ].join('; '),
      )}. So, wie die Anlage am Tag der Übergabe dokumentiert war.</div></div>`
    : ''
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${text(`${title}, ${dossier.system}`)}</title>
<style>
${reportStyle}
h2 { font-size: 11pt; font-weight: 600; margin: 4mm 0 1.5mm; break-after: avoid; }
.box { border: 0.6pt solid #d5d9de; border-radius: 1mm; padding: 2mm 3mm; margin-bottom: 2mm; }
.box-title { font-size: 10.5pt; font-weight: 600; margin-bottom: 0.5mm; }
</style>
</head>
<body>
<header class="head">
  <div>
    <h1>${text(title)}</h1>
    <p class="where">${text(dossier.system)}, ${text(dossier.site)}${present(dossier.customer) ? `, für ${text(dossier.customer)}` : ''}</p>
    <p class="where">${handover ? `Übergeben am ${day(on)}` : `Stand ${day(on)}, aus der PV-Struktur`}</p>
  </div>
  <div class="keeper">
    <div class="keeper-name">${text(dossier.keeper.name)}</div>
    ${present(dossier.keeper.phone) ? `<div>Telefon ${text(dossier.keeper.phone)}</div>` : ''}
  </div>
</header>
${holds}
<p class="summary">${text(forecastSentence(dossier.forecast))}</p>
<h2>Komponentenliste</h2>
${componentTable(dossier.components)}
<h2>Stringplan</h2>
${stringTable(dossier.strings)}
${
  handover
    ? '<p class="note">Die Protokolle folgen auf den nächsten Seiten, wie sie für sich gedruckt werden. Spätere Änderungen an der Anlage stehen nicht in dieser Mappe; sie bleibt, wie sie übergeben wurde.</p>'
    : ''
}
</body>
</html>`

  return {
    html,
    footerHtml: reportFooter(
      handover
        ? `${title}, ${dossier.system}, übergeben am ${day(on)}`
        : `${title}, ${dossier.system}, Stand ${day(on)}`,
    ),
    margin: reportMargin,
    landscape: true,
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether what a handover holds has the shape this version writes. A row
 * from the database was written by the server and nothing else, but a folder
 * printed from a shape it does not know would print nonsense rather than fail.
 */
export function isPvHandoverContent(value: unknown): value is PvHandoverContent {
  return (
    isRecord(value) &&
    isRecord(value['keeper']) &&
    typeof value['system'] === 'string' &&
    typeof value['site'] === 'string' &&
    typeof value['customer'] === 'string' &&
    (value['forecast'] === null || isRecord(value['forecast'])) &&
    Array.isArray(value['components']) &&
    Array.isArray(value['strings']) &&
    Array.isArray(value['protocols']) &&
    (value['protocols'] as unknown[]).every(
      (entry) => isRecord(entry) && typeof entry['id'] === 'string',
    )
  )
}
