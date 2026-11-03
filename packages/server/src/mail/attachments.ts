import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { berlinClock, RuleError } from '@opengewerk/domain'
import { type Database, type MailAttachment, MailDeliveryError } from '@opengewerk/platform-server'

import type { DocumentFiles, MailedFile } from '../api/document-files.js'
import { CallInstructionsRefused, callPrintFacts } from '../service-calls/instructions.js'
import type { OutboxRow } from './outbox.js'

/** Where the files a message carries come from. Handed to the job, so a test can bring its own. */
export type AttachmentSource = (row: OutboxRow) => Promise<readonly MailAttachment[]>

/** A number as it may stand in a file name. A number pattern may well contain a slash. */
function safe(number: string): string {
  return number.replaceAll(/[\\/:*?"<>|]+/g, '-')
}

function fileNameOf(file: MailedFile, attachment: 'pdf' | 'zugferd' | 'xrechnung'): string {
  if (file.number === null) {
    // A report signed on site, before the office gave it a number. Named the
    // way its PDF is named when somebody opens it.
    return `${file.heading} unterschrieben.pdf`
  }

  return attachment === 'xrechnung'
    ? `XRechnung ${safe(file.number)}.xml`
    : `${file.heading} ${safe(file.number)}.pdf`
}

/**
 * The files of issued documents, from the same place the routes hand them out
 * from.
 *
 * A document keeps one PDF, one XRechnung and one ZUGFeRD PDF, each made the
 * first time somebody asks and read from then on. The message asks the same
 * way, so a customer who later downloads the invoice gets the bytes the mail
 * carried, and a document whose PDF nobody opened yet has it printed now.
 *
 * What stands in the way sorts into two. A renderer that is not running, a
 * file store that does not answer: those pass, and the message waits for the
 * next attempt like it waits for a mail server. A document that has no file
 * to give, because it lost its number or lacks what its e-invoice needs, will
 * not have one an hour later either, and the message is given up on with the
 * reason.
 */
export function documentAttachments(files: DocumentFiles): AttachmentSource {
  return async (row) => {
    if (row.documentId === null || row.attachment === null) {
      throw new MailDeliveryError(
        'Der Nachricht fehlt der Beleg, den sie tragen soll.',
        'EDOCUMENT',
        null,
        { permanent: true },
      )
    }

    try {
      const file = await files.forMail(
        { tenantId: row.tenantId, reason: 'mail' },
        row.documentId,
        row.attachment,
      )

      return [
        {
          filename: fileNameOf(file, row.attachment),
          content: file.bytes,
          contentType: row.attachment === 'xrechnung' ? 'application/xml' : 'application/pdf',
        },
      ]
    } catch (error) {
      const final =
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException ||
        error instanceof RuleError

      throw new MailDeliveryError(
        `Der Anhang ließ sich nicht erzeugen: ${error instanceof Error ? error.message : String(error)}`,
        final ? 'EDOCUMENT' : 'EATTACHMENT',
        null,
        { permanent: final },
      )
    }
  }
}

/**
 * The files of a message, with the instructions of a service call (#292)
 * beside those of a document: the PDF of the instructions, printed when the
 * message goes out, in the words of the day of the request signed at the door
 * or of the day the office asked. A call that gets none any more, or whose
 * letterhead lacks what the words need, will not print an hour later either,
 * and the message is given up on with the reason.
 */
export function withCallInstructions(
  files: DocumentFiles,
  database: Database,
  others: AttachmentSource,
): AttachmentSource {
  return async (row) => {
    if (row.kind !== 'job_instructions') {
      return others(row)
    }

    if (row.jobId === null) {
      throw new MailDeliveryError('Der Nachricht fehlt der Auftrag, um den es geht.', 'EDOCUMENT', null, {
        permanent: true,
      })
    }

    const jobId = row.jobId
    const printedFor = { tenantId: row.tenantId }

    try {
      const facts = await database.forTenant({ tenantId: row.tenantId, reason: 'mail' }, (tx) =>
        callPrintFacts(tx, jobId, row.earlyStartRequestId, berlinClock(row.createdAt).day),
      )

      return [
        {
          filename: 'Belehrungen.pdf',
          content: await files.printCallInstructions(facts, printedFor),
          contentType: 'application/pdf',
        },
      ]
    } catch (error) {
      const final = error instanceof CallInstructionsRefused

      throw new MailDeliveryError(
        `Der Anhang ließ sich nicht erzeugen: ${error instanceof Error ? error.message : String(error)}`,
        final ? 'EDOCUMENT' : 'EATTACHMENT',
        null,
        { permanent: final },
      )
    }
  }
}
