import {
  berlinClock,
  type DefectStatus,
  defectStatusLabel,
  type IsoDate,
  signatureBox,
} from '@opengewerk/domain'
import { type PrintJob, present, text } from '@opengewerk/platform-server'

import { day } from './appliance-report.js'
import { type GridParty, sheetHead, sheetJob } from './grid-documents.js'

/** A photo of a defect, as the report prints it. */
export interface DefectReportPhoto {
  readonly title: string
  readonly fileName: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** One defect of the report: what is wrong, its facts, its steps and its photos. */
export interface DefectReportEntry {
  readonly description: string
  readonly status: DefectStatus
  readonly installation: string | null
  /** "Vorbehalt der Abnahme vom 05.11.2026" for one out of an acceptance. */
  readonly origin: string | null
  readonly remedyDueOn: IsoDate | null
  /** Whether the day it was reported lies within the warranty, as a sentence, or null. */
  readonly warranty: string | null
  /** Every step, reported first: the step, who took it, when. */
  readonly steps: readonly { readonly label: string; readonly who: string; readonly at: string }[]
  /** The customer's signature of the acceptance, where it is accepted. */
  readonly signature: { readonly signer: string; readonly at: string; readonly path: string } | null
  readonly photos: readonly DefectReportPhoto[]
}

/** What the report of the defects of a job prints (#311). */
export interface DefectReport {
  readonly keeper: GridParty
  readonly customer: string
  readonly job: { readonly designation: string; readonly number: string | null }
  readonly site: string | null
  readonly defects: readonly DefectReportEntry[]
}

/** A moment as the report says it: "10.11.2026, 10:42", in German time. */
export function momentText(at: Date): string {
  const clock = berlinClock(at)
  const hours = String(Math.floor(clock.minute / 60)).padStart(2, '0')
  const minutes = String(clock.minute % 60).padStart(2, '0')

  return `${day(clock.day)}, ${hours}:${minutes}`
}

/** "3 Mängel, davon 1 abgenommen", "1 Mangel", "Noch kein Mangel". */
export function defectCount(defects: readonly { readonly status: DefectStatus }[]): string {
  if (defects.length === 0) {
    return 'Noch kein Mangel.'
  }

  const accepted = defects.filter((defect) => defect.status === 'accepted').length
  const counted = defects.length === 1 ? '1 Mangel' : `${String(defects.length)} Mängel`

  return accepted === 0 ? `${counted}.` : `${counted}, davon ${String(accepted)} abgenommen.`
}

const reportStyle = `
.lead { margin: 0 0 3mm; }
.defect { padding: 2.5mm 0; border-top: 0.3mm solid #c9ced6; break-inside: avoid; }
.defect-head { display: flex; gap: 3mm; align-items: baseline; font-weight: 600; }
.defect-head .what { flex-grow: 1; }
.facts { margin-top: 1.5mm; border-collapse: collapse; }
.facts th { width: 38mm; text-align: left; font-weight: 400; color: #5b6573; padding: 0.5mm 2mm 0.5mm 0; vertical-align: top; }
.facts td { padding: 0.5mm 0; vertical-align: top; }
/* Label and value without the lines of the papers' tables, as the board draws them. */
.facts th, .facts td { border: 0; }
.steps { margin: 1.5mm 0 0; padding-left: 4.5mm; color: #3d4652; }
.signed { margin-top: 1.5mm; }
.signed svg { display: block; width: 45mm; height: 18mm; }
.photos { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 2mm; }
.photos figure { margin: 0; width: 40mm; }
.photos img { display: block; width: 40mm; height: 28mm; object-fit: cover; border: 0.2mm solid #c9ced6; }
.photos figcaption { font-size: 7.5pt; color: #5b6573; overflow-wrap: anywhere; }
`

function entry(defect: DefectReportEntry, number: number): string {
  const facts = [
    ['Anlage', defect.installation],
    ['Herkunft', defect.origin],
    ['Frist des Kunden', defect.remedyDueOn === null ? null : day(defect.remedyDueOn)],
    ['Gewährleistung', defect.warranty],
  ].filter((fact): fact is [string, string] => present(fact[1]))
  const signature = defect.signature
    ? `<div class="signed"><svg viewBox="0 0 ${String(signatureBox.width)} ${String(signatureBox.height)}" aria-hidden="true"><path d="${defect.signature.path}" fill="none" stroke="#1b2430" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg><div>${text(`${defect.signature.signer}, ${defect.signature.at}`)}</div></div>`
    : ''
  const photos =
    defect.photos.length === 0
      ? ''
      : `<div class="photos">${defect.photos
          .map(
            (photo) =>
              `<figure><img src="data:${text(photo.mediaType)};base64,${Buffer.from(photo.bytes).toString('base64')}" alt="${text(photo.title)}"><figcaption>${text(photo.fileName)}</figcaption></figure>`,
          )
          .join('')}</div>`

  return `<section class="defect">
  <div class="defect-head"><span>${String(number)}.</span><span class="what">${text(defect.description)}</span><span>${text(defectStatusLabel[defect.status])}</span></div>
  ${facts.length === 0 ? '' : `<table class="facts"><tbody>${facts.map(([key, value]) => `<tr><th>${text(key)}</th><td>${text(value)}</td></tr>`).join('')}</tbody></table>`}
  <ul class="steps">${defect.steps.map((step) => `<li>${text(`${step.label}: ${step.who}, ${step.at}`)}</li>`).join('')}</ul>
  ${signature}${photos}
</section>`
}

/** The report of the defects of a job on portrait A4: each with its facts, steps, signature and photos. */
export function defectReportJob(
  report: DefectReport,
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const work = [report.job.designation, report.job.number].filter(present).join(', ')
  const body = `${sheetHead('Mängelbericht', [work, ...(present(report.site) ? [report.site] : [])], report.keeper)}
<p class="lead">${text(`Auftraggeber ${report.customer}. Stand ${day(on)}: ${defectCount(report.defects)}`)}</p>
${report.defects.map((defect, index) => entry(defect, index + 1)).join('\n')}`

  return sheetJob(`Mängelbericht, ${work}`, body, `Mängelbericht, ${work}, ${day(on)}`, reportStyle)
}
