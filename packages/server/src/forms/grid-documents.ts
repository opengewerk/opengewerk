import {
  addMonths,
  azimuthText,
  type InstallationKind,
  type IsoDate,
  pvOrientations,
  type OrientedString,
  type RuleSet,
} from '@opengewerk/domain'
import { type PrintJob, present, text } from '@opengewerk/platform-server'

import { day, reportFooter, reportMargin, reportStyle } from './appliance-report.js'

/**
 * The papers for a grid operator and the help for the Marktstammdatenregister
 * (#306, Feature-Gliederung 5.1), out of customer, site, installation and PV
 * structure.
 *
 * "Anmeldung" and "Fertigmeldung" are data sheets: what the forms and portals
 * of the grid operators ask, in an order to put beside the operator's own form
 * or to carry into its portal. OpenGewerk fills in no form of an operator;
 * each has its own. A value the installation does not hold is a line to write
 * on. The completion names the day of the commissioning and has the signed
 * commissioning protocols behind it.
 *
 * The help for the register asks every question the annex of the MaStRV asks
 * of the operator, the solar unit, the EEG plant and the battery, answered out
 * of the installation or left blank for the operator; a question that only
 * holds from a power on or for a plant before a day stands there only then.
 * On top the deadline of the operator, a month after the commissioning.
 */

/** A party on the papers, its address on one line. */
export interface GridParty {
  readonly name: string
  readonly address: string
  readonly phone: string | null
  readonly email: string | null
}

/** A part of the installation as a line of the papers names it. */
export interface GridPart {
  readonly designation: string
  /** Maker and type, "Fronius Symo GEN24 10.0 Plus", where known. */
  readonly maker: string | null
  readonly serialNumber: string | null
  /** In watts, where the structure names it; a battery and a wallbox name none. */
  readonly ratedPowerW: number | null
  /** The inverter a battery hangs at, by its designation. */
  readonly inverter: string | null
  readonly commissionedOn: IsoDate | null
}

/** Everything the papers of one installation print. */
export interface GridPapers {
  readonly keeper: GridParty
  readonly customer: GridParty & {
    /** A private customer is a natural person, the register asks it other questions. */
    readonly naturalPerson: boolean
    readonly vatId: string | null
  }
  readonly site: { readonly designation: string; readonly address: string }
  readonly installation: {
    readonly kind: InstallationKind
    readonly designation: string
    readonly maker: string | null
    readonly serialNumber: string | null
  }
  /** The grid operator the installation is reported to, null where it names none. */
  readonly operator: {
    readonly name: string
    readonly portalUrl: string | null
    readonly requirements: string | null
  } | null
  readonly reference: string | null
  /** The entry in an installer directory the papers name (`registrationFor`). */
  readonly registration: {
    readonly operator: string
    readonly number: string
    readonly until: IsoDate | null
    readonly electrician: string | null
  } | null
  readonly modules: {
    readonly count: number
    readonly makers: readonly string[]
    readonly ratedPowerW: number | null
  }
  readonly inverters: readonly GridPart[]
  readonly batteries: readonly GridPart[]
  readonly meters: readonly GridPart[]
  readonly wallboxes: readonly GridPart[]
  readonly strings: readonly OrientedString[]
  /** The day of the commissioning: the newest signed commissioning protocol, otherwise "In Betrieb seit". */
  readonly commissionedOn: IsoDate | null
  /** The signed commissioning protocols the completion has behind it, by title and day. */
  readonly protocols: readonly {
    readonly title: string
    readonly installation: string
    readonly performedOn: IsoDate
  }[]
}

const kilowatts = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const peak = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "10 kW". */
export function kilowattText(watts: number): string {
  return `${kilowatts.format(watts / 1000)} kW`
}

/** "9,60 kWp". */
export function peakText(watts: number): string {
  return `${peak.format(watts / 1000)} kWp`
}

/** The power of all parts together in watts, or null where a part names none, rather than a sum short of it. */
export function totalPower(
  parts: readonly { readonly ratedPowerW: number | null }[],
): number | null {
  return parts.length === 0 || parts.some((part) => part.ratedPowerW === null)
    ? null
    : parts.reduce((sum, part) => sum + (part.ratedPowerW ?? 0), 0)
}

/** "WR 1, Fronius Symo GEN24 10.0 Plus, Seriennummer 34120117, 10 kW", leaving out what is missing. */
function partLine(part: GridPart): string {
  return [
    part.designation,
    part.maker,
    present(part.serialNumber) ? `Seriennummer ${part.serialNumber}` : null,
    part.ratedPowerW === null ? null : kilowattText(part.ratedPowerW),
  ]
    .filter(present)
    .join(', ')
}

/** "Süd, 180°, Neigung 30°, 12 Module". */
function orientationText(orientation: ReturnType<typeof pvOrientations>[number]): string {
  return [
    azimuthText(orientation.azimuthDeg),
    orientation.tiltDeg === null ? null : `Neigung ${String(orientation.tiltDeg)}°`,
    `${String(orientation.modules)} ${orientation.modules === 1 ? 'Modul' : 'Module'}`,
  ]
    .filter(present)
    .join(', ')
}

/** A row of a sheet: what is asked, the answer or null for a line to write on, and for the register its row in the annex. */
export type SheetRow = readonly [question: string, answer: string | null, where?: string]

export interface SheetSection {
  readonly title: string
  readonly rows: readonly SheetRow[]
}

function contact(party: GridParty): string | null {
  const said = [party.phone, party.email].filter(present).join(', ')

  return said === '' ? null : said
}

/** The entry in an installer directory in one line, or null for a line to write on. */
function registrationText(registration: GridPapers['registration']): string | null {
  return registration === null
    ? null
    : `${registration.operator}, Nummer ${registration.number}${
        registration.until === null ? '' : `, gültig bis ${day(registration.until)}`
      }`
}

const plantTitle: Partial<Record<InstallationKind, string>> = {
  pv_system: 'PV-Anlage',
  battery: 'Speicher',
  wallbox: 'Wallbox',
}

/**
 * The sections of the application or the completion: who runs the plant,
 * where it stands, who builds it with its entry in an installer directory,
 * the plant out of its structure, and for the completion its commissioning.
 */
export function gridSections(papers: GridPapers, completion: boolean): readonly SheetSection[] {
  const { installation } = papers
  const plant: SheetRow[] = [['Bezeichnung', installation.designation]]

  if (installation.kind === 'pv_system') {
    const modules = papers.modules
    plant.push(
      [
        'Module',
        modules.count === 0
          ? null
          : [
              `${String(modules.count)} ${modules.count === 1 ? 'Modul' : 'Module'}`,
              modules.makers.join(', '),
              modules.ratedPowerW === null ? null : `zusammen ${peakText(modules.ratedPowerW)}`,
            ]
              .filter(present)
              .join(', '),
      ],
      ...(papers.inverters.length === 0
        ? [['Wechselrichter', null] as const]
        : papers.inverters.map((inverter) => ['Wechselrichter', partLine(inverter)] as const)),
    )
    const inverterPower = totalPower(papers.inverters)
    plant.push([
      'Wechselrichterleistung zusammen',
      inverterPower === null ? null : kilowattText(inverterPower),
    ])
  } else {
    const said = [
      installation.maker,
      present(installation.serialNumber) ? `Seriennummer ${installation.serialNumber}` : null,
    ]
      .filter(present)
      .join(', ')

    plant.push([plantTitle[installation.kind] ?? 'Anlage', said === '' ? null : said])
  }

  // A battery and a wallbox of a PV system go with its papers; one of their own are the plant itself.
  for (const battery of papers.batteries) {
    plant.push(['Speicher', partLine(battery)], ['Nutzbare Speicherkapazität', null])
  }

  if (installation.kind === 'battery') {
    plant.push(['Nutzbare Speicherkapazität', null], ['Wechselrichterleistung', null])
  }

  for (const wallbox of papers.wallboxes) {
    plant.push(['Wallbox', partLine(wallbox)], ['Bemessungsleistung der Wallbox', null])
  }

  if (installation.kind === 'wallbox') {
    plant.push(['Bemessungsleistung', null])
  }

  if (!completion) {
    plant.push(['Geplante Inbetriebnahme', null])
  }

  const meters = papers.meters.map((meter) => meter.serialNumber).filter(present)
  const sections: SheetSection[] = [
    {
      title: 'Anlagenbetreiber',
      rows: [
        ['Name', papers.customer.name],
        ['Anschrift', present(papers.customer.address) ? papers.customer.address : null],
        ['Telefon', papers.customer.phone],
        ['E-Mail', papers.customer.email],
      ],
    },
    {
      title: 'Ort der Anlage',
      rows: [
        ['Objekt', [papers.site.designation, papers.site.address].filter(present).join(', ')],
        ['Zähler', meters.length === 0 ? null : meters.join(', ')],
      ],
    },
    {
      title: 'Elektrofachbetrieb',
      rows: [
        ['Name', papers.keeper.name],
        ['Anschrift', present(papers.keeper.address) ? papers.keeper.address : null],
        ['Telefon und E-Mail', contact(papers.keeper)],
        ['Installateurverzeichnis', registrationText(papers.registration)],
        ['Verantwortliche Elektrofachkraft', papers.registration?.electrician ?? null],
      ],
    },
    { title: plantTitle[installation.kind] ?? 'Anlage', rows: plant },
  ]

  if (completion) {
    sections.push({
      title: 'Inbetriebsetzung',
      rows: [
        [
          'Tag der Inbetriebsetzung',
          papers.commissionedOn === null ? null : day(papers.commissionedOn),
        ],
        ...papers.protocols.map(
          (protocol) =>
            [
              'Protokoll',
              `${protocol.title}, ${protocol.installation}, vom ${day(protocol.performedOn)}, folgt auf den nächsten Seiten`,
            ] as const,
        ),
      ],
    })
  }

  return sections
}

/** The last day the operator may register in, a month after the commissioning as the rule of the day says (§ 5 Abs. 5 MaStRV). */
export function marketRegisterDueOn(
  commissionedOn: IsoDate | null,
  rules: RuleSet,
): IsoDate | null {
  if (commissionedOn === null) {
    return null
  }

  // A plant put into operation before the MaStRV has no deadline of it.
  const rule = rules.at('elektro.mastr.registration_months', commissionedOn)

  return rule?.unit === 'months' && typeof rule.value === 'number'
    ? addMonths(commissionedOn, rule.value)
    : null
}

/** Before this day a solar unit was put into operation, the register asks about its control and limit (annex, *9). */
const controlAskedBefore = '2023-01-01'

/**
 * The questions of the register in the order of its annex, answered out of
 * the papers, null where only the operator knows. The thresholds of power go
 * by the inverters, which make the net rated power of a solar unit, and by the
 * modules where no inverter names one; unknown, no question that hangs on one.
 */
export function marketRegisterSections(papers: GridPapers): readonly SheetSection[] {
  const { customer, site, operator } = papers
  const reference = papers.reference
  const sections: SheetSection[] = [
    customer.naturalPerson
      ? {
          title: 'Anlagenbetreiber als Marktakteur, natürliche Person',
          rows: [
            ['Name', customer.name, 'A.1.1'],
            ['Anschrift', present(customer.address) ? customer.address : null, 'A.1.2'],
            ['Geburtsdatum', null, 'A.1.7'],
            ['Kontakt für Rückfragen', contact(customer), 'A.1.14'],
            ['Nur Einkünfte aus nichtselbstständiger Arbeit, außer aus der Anlage', null, 'A.2.2'],
            ['Hauptwirtschaftszweig', null, 'A.2.3'],
            [
              'Marktpartner-ID, ACER-Code, USt-IdNr., wenn vorhanden',
              customer.vatId,
              'A.1.11 bis 13',
            ],
          ],
        }
      : {
          title: 'Anlagenbetreiber als Marktakteur, Unternehmen oder Organisation',
          rows: [
            ['Name', customer.name, 'A.1.1'],
            ['Anschrift', present(customer.address) ? customer.address : null, 'A.1.2'],
            ['Rechtsform', null, 'A.1.4'],
            ['Registergericht und Registernummer, wenn eingetragen', null, 'A.1.5, 6'],
            ['Kontakt für Rückfragen', contact(customer), 'A.1.14'],
            ['Kleinst-, kleines oder mittleres Unternehmen', null, 'A.2.1'],
            ['Hauptwirtschaftszweig', null, 'A.2.3'],
            ['USt-IdNr.', customer.vatId, 'A.1.13'],
            ['Marktpartner-ID und ACER-Code, wenn vorhanden', null, 'A.1.11, 12'],
          ],
        },
  ]
  const commissioned = papers.commissionedOn === null ? null : day(papers.commissionedOn)

  if (papers.installation.kind === 'pv_system') {
    const modulePower = papers.modules.ratedPowerW
    const inverterPower = totalPower(papers.inverters)
    const power = inverterPower ?? modulePower
    const orientations = pvOrientations(papers.strings)
    const main = orientations[0]
    const second = orientations[1]
    const before = papers.commissionedOn !== null && papers.commissionedOn < controlAskedBefore
    const atLeast = (watts: number) => power !== null && power >= watts
    const unit: SheetRow[] = [
      ['Name der Einheit', `${papers.installation.designation}, ${site.designation}`, 'B.1.1.1'],
      ['Standort', present(site.address) ? site.address : null, 'B.1.1.2'],
      ['Inbetriebnahme', commissioned, 'B.1.1.6'],
      ['Bruttoleistung der Module', modulePower === null ? null : peakText(modulePower), 'B.1.1.7'],
      [
        'Wechselrichterleistung',
        inverterPower === null ? null : kilowattText(inverterPower),
        'B.1.6.1.2',
      ],
      ['Energieträger', 'Solare Strahlungsenergie', 'B.1.1.16'],
      ['Art der Solaranlage', null, 'B.1.6.1.1'],
      [
        'Anzahl der Module',
        papers.modules.count === 0 ? null : String(papers.modules.count),
        'B.1.6.1.3',
      ],
      ['Hauptausrichtung und Neigung', main ? orientationText(main) : null, 'B.1.6.1.4, 5'],
      [
        'Nebenausrichtung und Neigung',
        second ? orientationText(second) : main ? 'keine' : null,
        'B.1.6.1.6, 7',
      ],
      ['Art der Einspeisung', null, 'B.1.1.14'],
      ['Anschlussnetzbetreiber', operator?.name ?? null, 'B.1.1.21'],
      ['Kennung beim Netzbetreiber', reference, 'B.1.1.22'],
      ['Nutzung des Gebäudes, bei einer Anlage auf einem Gebäude', null, 'B.1.6.3.1'],
      ['Fläche und ihre Nutzung vorher, bei einer Anlage nicht auf einem Gebäude', null, 'B.1.6.2'],
      ['Genehmigung, wenn die Anlage eine braucht', null, 'B.1.2'],
    ]

    if (before) {
      unit.push(
        ['Fernsteuerbarkeit durch den Netzbetreiber', null, 'B.1.1.12'],
        ['Leistungsbegrenzung', null, 'B.1.6.1.8'],
      )
    }

    if (atLeast(25_000)) {
      unit.push(['Fernsteuerbarkeit durch den Direktvermarkter', null, 'B.1.1.13'])
    }

    if (atLeast(100_000)) {
      unit.push(
        ['W-EIC', null, 'B.1.1.4'],
        ['Präqualifikation für Regelleistung', null, 'B.1.1.11'],
      )
    }

    if (atLeast(1_000_000)) {
      unit.push(
        ['Schwarzstartfähigkeit', null, 'B.1.1.9'],
        ['Inselbetriebsfähigkeit', null, 'B.1.1.10'],
      )
    }

    const eeg: SheetRow[] = [
      ['Installierte Leistung', modulePower === null ? null : peakText(modulePower), 'B.2.1.1'],
      ['Inbetriebnahme nach EEG', commissioned, 'B.2.1.2'],
    ]

    if (atLeast(25_000)) {
      eeg.push(['Zuschlagsnummer, nach einer Ausschreibung', null, 'B.2.2.1'])
    }

    if (atLeast(1_000_000)) {
      eeg.push(['Betrieb durch eine Bürgerenergiegesellschaft', null, 'B.2.1.4'])
    }

    sections.push({ title: 'Solareinheit', rows: unit }, { title: 'EEG-Anlage', rows: eeg })
  }

  const storages: readonly GridPart[] =
    papers.installation.kind === 'battery'
      ? [
          {
            designation: papers.installation.designation,
            maker: papers.installation.maker,
            serialNumber: papers.installation.serialNumber,
            ratedPowerW: null,
            inverter: null,
            commissionedOn: papers.commissionedOn,
          },
        ]
      : papers.batteries

  for (const battery of storages) {
    sections.push({
      title: `Stromspeicher ${battery.designation}`,
      rows: [
        ['Name der Einheit', `${battery.designation}, ${site.designation}`, 'B.1.1.1'],
        ['Standort', present(site.address) ? site.address : null, 'B.1.1.2'],
        [
          'Inbetriebnahme',
          battery.commissionedOn === null ? null : day(battery.commissionedOn),
          'B.1.1.6',
        ],
        ['Speichertechnologie', 'Batterie', 'B.1.9.1'],
        ['Batterietechnologie', null, 'B.1.9.2.2'],
        ['Nutzbare Speicherkapazität', null, 'D.2.1'],
        ['Wechselrichterleistung', null, 'B.1.9.2.1'],
        [
          'AC- oder DC-gekoppelt',
          battery.inverter === null ? null : `DC-gekoppelt, am ${battery.inverter}`,
          'B.1.9.2.3',
        ],
        ['Anlage nach EEG', null, 'B.1.1.25'],
        ['Anschlussnetzbetreiber', operator?.name ?? null, 'B.1.1.21'],
        ['Kennung beim Netzbetreiber', reference, 'B.1.1.22'],
      ],
    })
  }

  return sections
}

const sheetStyle = `
${reportStyle}
h2 { font-size: 10pt; font-weight: 600; margin: 3.5mm 0 1mm; break-after: avoid; }
.box { border: 0.6pt solid #d5d9de; border-radius: 1mm; padding: 2mm 3mm; margin-bottom: 1mm; break-inside: avoid; }
.box-title { font-size: 10pt; font-weight: 600; margin-bottom: 0.5mm; }
.sheet th { width: 62mm; font-size: 9pt; font-weight: 400; color: #5b6573; border-bottom: 0.3pt solid #d5d9de; vertical-align: top; padding: 1mm 2mm 1mm 0; }
.sheet td { padding: 1mm 0; }
.sheet .where { width: 20mm; font-size: 7.5pt; color: #8f97a4; text-align: right; white-space: nowrap; }
.blank { display: block; min-height: 3.6mm; border-bottom: 0.6pt dotted #8f97a4; }
.blank-hint { font-size: 7.5pt; color: #8f97a4; }
`

function sheetTable(rows: readonly SheetRow[], hint: string | null): string {
  const blank = `<span class="blank">${hint === null ? '' : `<span class="blank-hint">${text(hint)}</span>`}</span>`

  return `<table class="sheet"><tbody>${rows
    .map(
      ([question, answer, where]) =>
        `<tr><th>${text(question)}</th><td>${
          answer === null ? blank : text(answer)
        }</td>${where === undefined ? '' : `<td class="where">${text(where)}</td>`}</tr>`,
    )
    .join('')}</tbody></table>`
}

function sheetJob(title: string, body: string, footer: string): Required<Omit<PrintJob, 'size'>> {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${text(title)}</title>
<style>
${sheetStyle}
</style>
</head>
<body>
${body}
</body>
</html>`

  return {
    html,
    footerHtml: reportFooter(footer),
    margin: reportMargin,
    landscape: false,
  }
}

function head(title: string, lines: readonly string[], keeper: GridParty): string {
  return `<header class="head">
  <div>
    <h1>${text(title)}</h1>
    ${lines.map((line) => `<p class="where">${text(line)}</p>`).join('\n    ')}
  </div>
  <div class="keeper">
    <div class="keeper-name">${text(keeper.name)}</div>
    ${present(keeper.phone) ? `<div>Telefon ${text(keeper.phone)}</div>` : ''}
  </div>
</header>`
}

function where(papers: GridPapers): string {
  return (
    [papers.installation.designation, papers.site.designation, papers.site.address]
      .filter(present)
      .join(', ') + (present(papers.customer.name) ? `, für ${papers.customer.name}` : '')
  )
}

/**
 * The application or the completion for the grid operator of the installation,
 * on portrait A4. `on` is the day it is printed.
 */
export function gridPaperJob(
  papers: GridPapers,
  completion: boolean,
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const title = completion ? 'Fertigmeldung an den Netzbetreiber' : 'Anmeldung beim Netzbetreiber'
  const operator = papers.operator
  const lines = [
    ...(operator === null
      ? []
      : [`An ${operator.name}${present(papers.reference) ? `, Kennung ${papers.reference}` : ''}`]),
    where(papers),
    `Stand ${day(on)}`,
  ]
  const asks =
    operator !== null && (present(operator.requirements) || present(operator.portalUrl))
      ? `<div class="box"><div class="box-title">Was der Netzbetreiber verlangt</div>${
          present(operator.requirements)
            ? `<div style="white-space: pre-line">${text(operator.requirements)}</div>`
            : ''
        }${
          present(operator.portalUrl)
            ? `<div>Portal: ${text(operator.portalUrl)}. Die Angaben dieses Blatts lassen sich so ins Portal übertragen.</div>`
            : ''
        }</div>`
      : ''
  const wallbox = papers.installation.kind === 'wallbox' || papers.wallboxes.length > 0
  const note = [
    wallbox
      ? 'Eine Wallbox ist dem Netzbetreiber vor der Inbetriebnahme mitzuteilen; über 12 kVA Summen-Bemessungsleistung je Anlage braucht sie seine Zustimmung (§ 19 Abs. 2 NAV).'
      : null,
    'Leere Zeilen nennt die Anlagenakte noch nicht, sie werden von Hand ergänzt.',
  ]
    .filter(present)
    .join(' ')
  const body = `${head(title, lines, papers.keeper)}
${asks}
${gridSections(papers, completion)
  .map((section) => `<h2>${text(section.title)}</h2>${sheetTable(section.rows, null)}`)
  .join('\n')}
<p class="note">${text(note)}</p>`

  return sheetJob(
    `${title}, ${papers.installation.designation}`,
    body,
    `${title}, ${papers.installation.designation}, Stand ${day(on)}`,
  )
}

/** The help for the Marktstammdatenregister on portrait A4, with the deadline of the operator on top. */
export function marketRegisterJob(
  papers: GridPapers,
  dueOn: IsoDate | null,
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const title = 'Ausfüllhilfe für das Marktstammdatenregister'
  const deadline =
    papers.commissionedOn === null || dueOn === null
      ? 'Frist: ein Monat nach der Inbetriebnahme (§ 5 Abs. 5 MaStRV). Der Tag der Inbetriebnahme steht noch nicht fest.'
      : `Frist: ein Monat nach der Inbetriebnahme (§ 5 Abs. 5 MaStRV). In Betrieb seit ${day(papers.commissionedOn)}, also bis zum ${day(dueOn)}.`
  const body = `${head(title, [where(papers), `Stand ${day(on)}, aus Kunde, Anlage und PV-Struktur`], papers.keeper)}
<div class="box"><div class="box-title">Melden muss der Anlagenbetreiber</div><div>Er registriert sich selbst als Marktakteur und jede Einheit, unter marktstammdatenregister.de; der Elektrofachbetrieb meldet nicht. ${text(deadline)}</div></div>
${marketRegisterSections(papers)
  .map(
    (section) =>
      `<h2>${text(section.title)}</h2>${sheetTable(section.rows, 'trägt der Betreiber ein')}`,
  )
  .join('\n')}`

  return sheetJob(
    `${title}, ${papers.installation.designation}`,
    body,
    `${title}, ${papers.installation.designation}, Stand ${day(on)}; Fragen nach der Anlage zur MaStRV`,
  )
}
