import {
  type FundingEvidence,
  type FundingEvidenceSource,
  type FundingEvidenceState,
  type InstallationKind,
  installationKindLabel,
  type IsoDate,
} from '@opengewerk/domain'
import { type PrintJob, present, text } from '@opengewerk/platform-server'

import { day } from './appliance-report.js'
import {
  type GridParty,
  kilowattHourText,
  kilowattText,
  sheetHead,
  sheetJob,
  sheetTable,
} from './grid-documents.js'

/** One proof of the list on the first page, with how it stands and what lies in for it. */
export interface FundingLine extends FundingEvidence {
  readonly state: FundingEvidenceState
  /** What lies in, or why nothing does: "RE-2026-0412 vom 04.11.2026", "noch kein unterschriebenes …". */
  readonly said: string | null
}

/** A part with a serial number, as the page of serial numbers lists it. */
export interface FundingSerial {
  readonly what: string
  readonly serialNumber: string
}

/** A photo among the files of the installation, as a page of its own. */
export interface FundingPhoto {
  readonly title: string
  readonly fileName: string
  readonly takenOn: IsoDate
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** Everything the papers of a programme print for one installation (#307). */
export interface FundingPapers {
  readonly program: {
    readonly name: string
    readonly sponsor: string | null
    readonly url: string | null
  }
  readonly keeper: GridParty
  readonly customer: { readonly name: string; readonly address: string }
  readonly site: { readonly designation: string; readonly address: string }
  readonly installation: {
    readonly kind: InstallationKind
    readonly designation: string
    readonly maker: string | null
    readonly serialNumber: string | null
    readonly ratingW: number | null
    readonly capacityWh: number | null
    readonly commissionedOn: IsoDate | null
  }
  readonly lines: readonly FundingLine[]
  /** The declaration with the placeholders filled, null where the programme asks for none. */
  readonly declaration: string | null
  readonly serials: readonly FundingSerial[]
}

/** What lies in for a proof of each source, said on the list of the first page, where nothing else says it. */
export const enclosedSaid: Readonly<
  Record<
    Exclude<FundingEvidenceSource, 'operator'>,
    { readonly enclosed: string; readonly missing: string }
  >
> = {
  invoice: { enclosed: '', missing: 'keine gestellte Rechnung zur Anlage' },
  declaration: {
    enclosed: 'mit den Angaben der Anlage, zum Unterschreiben',
    missing: 'das Förderprogramm hat keinen Text der Erklärung',
  },
  commissioning: { enclosed: '', missing: 'noch kein unterschriebenes Inbetriebnahmeprotokoll' },
  photos: { enclosed: '', missing: 'kein Foto unter den Dateien der Anlage' },
  serial_numbers: {
    enclosed: 'aus Anlage und Struktur',
    missing: 'keine Seriennummer an Anlage und Struktur',
  },
}

const fundingStyle = `
.proofs { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.proofs th { text-align: left; font-weight: 600; border-bottom: 0.6pt solid #1b2430; padding: 1mm 2mm 1mm 0; }
.proofs td { border-bottom: 0.3pt solid #d5d9de; padding: 1mm 2mm 1mm 0; vertical-align: top; }
.proofs .number { width: 5mm; color: #8f97a4; }
.proofs .state { width: 36mm; font-weight: 600; }
.proofs .said { width: 58mm; color: #5b6573; }
.enclosed { color: #2f6b3a; }
.missing { color: #a6521a; }
.operator { color: #5b6573; }
.declaration { font-size: 10.5pt; line-height: 1.6; white-space: pre-line; margin: 4mm 0 12mm; }
.signatures { display: flex; gap: 12mm; margin-top: 8mm; }
.signatures div { flex: 1; border-top: 0.6pt solid #1b2430; padding-top: 1mm; font-size: 8.5pt; color: #5b6573; }
.photo { break-after: page; }
.photo:last-child { break-after: auto; }
.photo img { display: block; max-width: 100%; max-height: 215mm; margin: 2mm auto 2mm; object-fit: contain; }
.photo figcaption { font-size: 9pt; color: #5b6573; }
`

const stateLabel: Readonly<Record<FundingEvidenceState, string>> = {
  enclosed: 'liegt bei',
  missing: 'fehlt',
  operator: 'bringt der Betreiber',
}

/** "Wallbox Garage, Wohnhaus, Birkenweg 7, 69214 Eppelheim, für Weber, Familie". */
function where(papers: FundingPapers): string {
  return (
    [papers.installation.designation, papers.site.designation, papers.site.address]
      .filter(present)
      .join(', ') + (present(papers.customer.name) ? `, für ${papers.customer.name}` : '')
  )
}

function footer(papers: FundingPapers, on: IsoDate): string {
  return `Förderunterlagen ${papers.program.name}, Stand ${day(on)}`
}

/** The first page: the programme, the installation and the list of proofs with what lies in, what is missing, what the operator brings. */
export function fundingCoverJob(
  papers: FundingPapers,
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const { program, installation } = papers
  const box = `<div class="box"><div class="box-title">Förderprogramm</div><div>${text(
    [program.name, program.sponsor].filter(present).join(', '),
  )}</div>${present(program.url) ? `<div>Bedingungen: ${text(program.url)}</div>` : ''}</div>`
  const plant = sheetTable(
    [
      ['Anlagenbetreiber', present(papers.customer.name) ? papers.customer.name : null],
      ['Objekt', [papers.site.designation, papers.site.address].filter(present).join(', ')],
      [
        'Anlage',
        [installation.designation, installation.maker].filter(present).join(', ') +
          ` (${installationKindLabel[installation.kind]})`,
      ],
      ['Seriennummer', installation.serialNumber],
      ...(installation.kind === 'battery'
        ? ([
            [
              'Nutzbare Speicherkapazität',
              installation.capacityWh === null ? null : kilowattHourText(installation.capacityWh),
            ],
          ] as const)
        : []),
      ...(installation.kind === 'battery' || installation.kind === 'wallbox'
        ? ([
            [
              'Bemessungsleistung',
              installation.ratingW === null ? null : kilowattText(installation.ratingW),
            ],
          ] as const)
        : []),
      [
        'In Betrieb seit',
        installation.commissionedOn === null ? null : day(installation.commissionedOn),
      ],
    ],
    null,
  )
  const rows = papers.lines
    .map(
      (line, index) =>
        `<tr><td class="number">${String(index + 1)}</td><td>${text(line.label)}</td><td class="state ${
          line.state
        }">${text(stateLabel[line.state])}</td><td class="said">${text(line.said ?? '')}</td></tr>`,
    )
    .join('')
  const proofs = `<table class="proofs"><thead><tr><th></th><th>Nachweis</th><th>Stand</th><th>Was beiliegt</th></tr></thead><tbody>${rows}</tbody></table>`
  const body = `${sheetHead('Förderunterlagen', [where(papers), `Stand ${day(on)}`], papers.keeper)}
${box}
<h2>Anlage</h2>${plant}
<h2>Nachweise</h2>${proofs}
<p class="note">${text(
    'Was der Betreiber bringt, legt er selbst bei. Hinter dieser Seite folgen die Fachunternehmererklärung, die Seriennummern, das Inbetriebnahmeprotokoll, die Fotos und die Rechnungen, in dieser Reihenfolge, soweit das Förderprogramm sie verlangt.',
  )}</p>`

  return sheetJob(
    `Förderunterlagen, ${installation.designation}`,
    body,
    footer(papers, on),
    fundingStyle,
  )
}

/** The declaration of the business with the placeholders filled, and lines to sign. */
export function declarationJob(
  papers: FundingPapers,
  declaration: string,
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const body = `${sheetHead('Fachunternehmererklärung', [`Zum Förderprogramm ${papers.program.name}`, where(papers)], papers.keeper)}
<div class="declaration">${text(declaration)}</div>
<div class="signatures"><div>Ort, Datum</div><div>Unterschrift und Stempel des Fachbetriebs</div></div>`

  return sheetJob(
    `Fachunternehmererklärung, ${papers.installation.designation}`,
    body,
    footer(papers, on),
    fundingStyle,
  )
}

/** The serial numbers of the installation and of what belongs to it. */
export function serialNumbersJob(
  papers: FundingPapers,
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const body = `${sheetHead('Seriennummern', [where(papers), 'Aus Anlage und Struktur'], papers.keeper)}
${sheetTable(
  papers.serials.map((serial) => [serial.what, serial.serialNumber] as const),
  null,
)}`

  return sheetJob(
    `Seriennummern, ${papers.installation.designation}`,
    body,
    footer(papers, on),
    fundingStyle,
  )
}

/** The photos among the files of the installation, one to a page, with its title and file. */
export function photosJob(
  papers: FundingPapers,
  photos: readonly FundingPhoto[],
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const body = photos
    .map(
      (photo) =>
        `<figure class="photo"><img src="data:${text(photo.mediaType)};base64,${Buffer.from(photo.bytes).toString('base64')}" alt="${text(
          photo.title,
        )}"><figcaption>${text(photo.title)}, ${text(photo.fileName)}, ${day(photo.takenOn)}</figcaption></figure>`,
    )
    .join('\n')

  return sheetJob(
    `Fotos, ${papers.installation.designation}`,
    body,
    footer(papers, on),
    fundingStyle,
  )
}
