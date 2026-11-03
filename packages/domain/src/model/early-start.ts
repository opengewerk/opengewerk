import {
  type IsoDate,
  signaturePathIsValid,
  signerNameProblem,
  type Synced,
} from '@opengewerk/platform-domain'

import {
  documentInstructions,
  type InstructionGap,
  type ShippedWording,
} from '../rules/instructions.js'
import { shippedWordings } from '../rules/instructions.js'
import type { IssuerContent } from './document-content.js'
import { textFingerprint } from './document-signature.js'
import type { EarlyStartRequestId, JobId } from './identifier.js'
import type { InstructionForDocument, InstructionTemplate } from './instruction.js'
import type { JobKind } from './job.js'

/**
 * The instructions a consumer gets at a service call (#292, Feature-Gliederung
 * 4.1): the instruction on withdrawal, the notes on when the right ends, the
 * model form, and the sheet for an early start. A service call often has no
 * quote, and the instructions of #109 hang on a quote; these hang on the job.
 * In the business's wording, as on a quote, and for a contract about work.
 *
 * Decided by Moritz on 27.09.2026: at the door the device shows them and the
 * customer signs the request for an early start like a report, and gets it all
 * by mail; a call taken on the phone gets them by mail from the office.
 */
export const jobInstructionTemplates = [
  'withdrawal',
  'withdrawal_notes',
  'withdrawal_form',
  'early_start',
] as const satisfies readonly InstructionTemplate[]

/**
 * The note for an urgent repair the customer asked for (#292): no right of
 * withdrawal for the repair itself, § 312g (2) no. 11 BGB, and nothing beyond
 * it is covered. One sentence, the same in the office and on site.
 */
export const urgentRepairNote =
  'Für die Reparatur selbst besteht dann kein Widerrufsrecht (§ 312g Abs. 2 Nr. 11 BGB). ' +
  'Was darüber hinaus vereinbart wird, fällt nicht darunter.'

/**
 * Why a job gets no instructions, or null when it does: a service call for a
 * customer who is not a business. A project is agreed on a quote, which
 * carries them; a business has no right of withdrawal.
 */
export function jobInstructionsRefusal(
  job: { readonly kind: JobKind },
  customer: { readonly isBusiness: boolean },
): string | null {
  if (job.kind !== 'service') {
    return 'Belehrungen am Auftrag gibt es für einen Serviceeinsatz. Ein Projekt bekommt sie mit seinem Angebot.'
  }

  if (customer.isBusiness) {
    return 'Der Kunde ist ein Unternehmen und hat kein Widerrufsrecht.'
  }

  return null
}

/** One instruction as the device shows it and the PDF prints it: the heading and the words, filled in. */
export interface InstructionSheet {
  readonly template: InstructionTemplate
  readonly title: string
  readonly text: string
}

/**
 * The instructions of a service call on a day, put together as for a quote to
 * a consumer, and what is missing for them: the four of
 * `jobInstructionTemplates` in the business's order and wording, the
 * placeholders filled from the letterhead.
 *
 * The sheet for an early start is signed on the device and not on paper, so
 * its words there are the request alone (`requestOnDevice`), without the
 * sentence on how to send the paper back and the lines to write on.
 */
export function jobInstructions(
  instructions: readonly InstructionForDocument[],
  on: IsoDate,
  issuer: IssuerContent,
  wordings: readonly ShippedWording[] = shippedWordings,
): {
  readonly sheets: readonly InstructionSheet[]
  readonly request: string | null
  readonly gaps: readonly InstructionGap[]
} {
  const chosen = instructions.filter(
    (instruction) =>
      instruction.template !== null &&
      (jobInstructionTemplates as readonly string[]).includes(instruction.template),
  )
  const { contents, gaps } = documentInstructions(
    chosen,
    {
      variant: 'service',
      switchedOn: chosen.map((instruction) => instruction.id),
      switchedOff: [],
    },
    { kind: 'order_confirmation', documentDate: on, recipientIsBusiness: false },
    issuer,
    wordings,
  )
  const sheets = contents.flatMap((content) =>
    content.model
      ? [{ template: content.model.template, title: content.title, text: content.text }]
      : [],
  )
  const early = contents.find((content) => content.model?.template === 'early_start')

  return {
    sheets,
    request: early
      ? requestOnDevice(early.text, early.model?.changed ?? false, on, issuer, wordings)
      : null,
    gaps,
  }
}

/**
 * The words a customer signs on the device. For the shipped sheet the
 * package's own words for that (`onDevice`); for one the business changed its
 * words without the lines to write on and what labels them, which only paper
 * needs.
 */
function requestOnDevice(
  text: string,
  changed: boolean,
  on: IsoDate,
  issuer: IssuerContent,
  wordings: readonly ShippedWording[],
): string {
  const model = wordings.find(
    (wording) =>
      wording.template === 'early_start' &&
      wording.validFrom <= on &&
      (wording.validUntil === null || on <= wording.validUntil),
  )

  if (!changed && model?.onDevice) {
    return model.onDevice.replaceAll('{name}', issuer.name)
  }

  return withoutWritingLines(text)
}

/** A text without its lines to write on ("___") and the line that labels each of them. */
export function withoutWritingLines(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const kept = lines.filter(
    (line, index) => line.trim() !== '___' && lines[index + 1]?.trim() !== '___',
  )

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A short mark of what the customer was shown and signed under, worked out the
 * same way on the device and on the server, like the one of a report
 * (`signedContentFingerprint`). A wording changed in the office while the
 * customer was reading refuses the signature as a conflict.
 */
export function instructionSheetsFingerprint(
  sheets: readonly InstructionSheet[],
  request: string | null,
): string {
  return textFingerprint(
    JSON.stringify([sheets.map((sheet) => [sheet.template, sheet.title, sheet.text]), request]),
  )
}

/**
 * The request for an early start, signed on the device at the door (#292):
 * the customer asks that the work begin within the fourteen days and confirms
 * knowing that the right of withdrawal ends once it is done (§ 356 (5) no. 2,
 * § 357a (2) BGB). Signed on the device, a durable medium once it is mailed.
 *
 * Written once and never changed, like a signature under a report: it travels
 * through the outbox, and the server sends the instructions with it to the
 * customer's mail.
 */
export interface EarlyStartRequest extends Synced {
  readonly id: EarlyStartRequestId
  readonly jobId: JobId
  /** Typed on the device: whoever signs at the door. */
  readonly signerName: string
  /** The device's clock at the moment the signature was confirmed. */
  readonly signedAt: Date
  /** What the browser says about itself, as at a report. */
  readonly deviceInfo: string | null
  /** The picture, as a path in the units of `signatureBox`. */
  readonly path: string
  /** What was signed under, see `instructionSheetsFingerprint`. */
  readonly contentFingerprint: string
}

/** What is wrong with the name and the signature of a request, or null when nothing is. */
export function earlyStartSignatureProblem(name: unknown, path: unknown): string | null {
  return (
    signerNameProblem(name) ??
    (typeof path === 'string' && signaturePathIsValid(path)
      ? null
      : 'Das Verlangen braucht die Unterschrift des Kunden.')
  )
}
