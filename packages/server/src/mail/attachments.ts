import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'

import type { DocumentFiles, IssuedFile } from '../api/document-files.js'
import { documentTitle } from '../documents/template.js'
import type { OutboxRow } from './outbox.js'
import { type MailAttachment, MailDeliveryError } from './transport.js'

/** Where the files a message carries come from. Handed to the job, so a test can bring its own. */
export type AttachmentSource = (row: OutboxRow) => Promise<readonly MailAttachment[]>

/** A number as it may stand in a file name. A number pattern may well contain a slash. */
function safe(number: string): string {
  return number.replaceAll(/[\\/:*?"<>|]+/g, '-')
}

function fileNameOf(file: IssuedFile, attachment: 'pdf' | 'zugferd' | 'xrechnung'): string {
  return attachment === 'xrechnung'
    ? `XRechnung ${safe(file.number)}.xml`
    : `${documentTitle(file.kind)} ${safe(file.number)}.pdf`
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
      )
    }

    try {
      const file = await files.issued(
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
        error instanceof UnprocessableEntityException

      throw new MailDeliveryError(
        `Der Anhang ließ sich nicht erzeugen: ${error instanceof Error ? error.message : String(error)}`,
        final ? 'EDOCUMENT' : 'EATTACHMENT',
        null,
      )
    }
  }
}
