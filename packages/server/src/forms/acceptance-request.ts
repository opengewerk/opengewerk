import type { IsoDate } from '@opengewerk/domain'
import { type PrintJob, present, text } from '@opengewerk/platform-server'

import { day } from './appliance-report.js'
import { type GridParty, sheetHead, sheetJob } from './grid-documents.js'

/** What the request to accept a job prints (#310). */
export interface AcceptanceRequest {
  readonly keeper: GridParty
  readonly customer: {
    readonly name: string
    readonly addressLines: readonly string[]
    /** A consumer, who is told the consequences in text form (§ 640 Abs. 2 Satz 2 BGB). */
    readonly consumer: boolean
  }
  readonly job: { readonly designation: string; readonly number: string | null }
  readonly site: string | null
  readonly until: IsoDate
}

const letterStyle = `
.letter { font-size: 10.5pt; line-height: 1.55; }
.letter .sender { font-size: 8pt; color: #5b6573; margin: 0 0 3mm; }
.letter .address { margin: 0 0 8mm; }
.letter .date { text-align: right; margin: 0 0 4mm; }
.letter h2 { font-size: 11pt; margin: 4mm 0 3mm; }
.letter p { margin: 0 0 3mm; }
`

/** The sentence a request states the consequence of the deadline in, for everybody (§ 640 Abs. 2 Satz 1 BGB). */
export function deemedSentence(until: IsoDate): string {
  return `Die Leistung gilt als abgenommen, wenn Sie die Abnahme nicht bis zum ${day(until)} unter Angabe mindestens eines Mangels verweigern (§ 640 Abs. 2 Satz 1 BGB).`
}

/** What a consumer is told in text form with the request (§ 640 Abs. 2 Satz 2 BGB). */
export const consumerNotice =
  'Erklären Sie die Abnahme nicht und verweigern Sie sie auch nicht unter Angabe mindestens eines Mangels, treten die Folgen der Abnahme mit dem Ablauf der Frist ein: die Vergütung wird fällig (§ 641 Abs. 1 BGB), die Gefahr geht auf Sie über (§ 644 BGB), und die Frist für Ihre Mängelansprüche beginnt (§ 634a Abs. 2 BGB).'

/** The request as a letter on portrait A4, with the deadline and, to a consumer, the notice of its consequences. */
export function acceptanceRequestJob(
  request: AcceptanceRequest,
  on: IsoDate,
): Required<Omit<PrintJob, 'size'>> {
  const work = [request.job.designation, request.job.number].filter(present).join(', ')
  const sender = [request.keeper.name, request.keeper.address].filter(present).join(', ')
  const body = `${sheetHead('Aufforderung zur Abnahme', [work, ...(present(request.site) ? [request.site] : [])], request.keeper)}
<div class="letter">
  <p class="sender">${text(sender)}</p>
  <p class="address">${[request.customer.name, ...request.customer.addressLines]
    .filter(present)
    .map((line) => text(line))
    .join('<br>')}</p>
  <p class="date">${text(day(on))}</p>
  <h2>${text(`Aufforderung zur Abnahme: ${work}`)}</h2>
  <p>Sehr geehrte Damen und Herren,</p>
  <p>${text(
    `wir haben die Leistung „${request.job.designation}“${present(request.site) ? ` am Objekt ${request.site}` : ''} fertiggestellt. Wir bitten Sie, sie bis zum ${day(request.until)} abzunehmen.`,
  )}${present(request.keeper.phone) ? text(` Für einen gemeinsamen Termin erreichen Sie uns unter ${request.keeper.phone}.`) : ''}</p>
  <p>${text(deemedSentence(request.until))}</p>
  ${
    request.customer.consumer
      ? `<div class="box"><div class="box-title">Hinweis nach § 640 Abs. 2 Satz 2 BGB</div><div>${text(consumerNotice)}</div></div>`
      : ''
  }
  <p style="margin-top: 5mm;">Mit freundlichen Grüßen<br>${text(request.keeper.name)}</p>
</div>`

  return sheetJob(
    `Aufforderung zur Abnahme, ${work}`,
    body,
    `Aufforderung zur Abnahme, ${work}, ${day(on)}`,
    letterStyle,
  )
}
