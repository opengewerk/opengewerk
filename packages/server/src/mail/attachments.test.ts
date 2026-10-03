import { NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { MailDeliveryError } from '@opengewerk/platform-server'
import { describe, expect, it } from 'vitest'

import type { DocumentFiles } from '../api/document-files.js'
import { documentAttachments } from './attachments.js'
import type { OutboxRow } from './outbox.js'

/**
 * The file a message about a document carries, and what becomes of the
 * message when there is none. Two kinds of trouble: one that waiting cures, a
 * renderer that is not running, and one it does not, a document that has no
 * file to give. The second says itself that it is for good: the transport of
 * the foundation knows no document (#23).
 */

const row = {
  tenantId: 'a3f1c2d4-0000-7000-8000-000000000001',
  documentId: 'a3f1c2d4-0000-7000-8000-000000000002',
  attachment: 'pdf',
} as unknown as OutboxRow

function filesThat(trouble: Error): DocumentFiles {
  return {
    forMail: () => Promise.reject(trouble),
  } as unknown as DocumentFiles
}

async function refusalOf(work: Promise<unknown>): Promise<MailDeliveryError> {
  try {
    await work
  } catch (error) {
    if (error instanceof MailDeliveryError) {
      return error
    }

    throw error
  }

  throw new Error('A file was given, and none was expected.')
}

describe('the file of a message about a document', () => {
  it('is refused for good when the message names no document', async () => {
    const refused = await refusalOf(
      documentAttachments(filesThat(new Error('never asked')))({
        ...row,
        documentId: null,
      } as unknown as OutboxRow),
    )

    expect(refused.code).toBe('EDOCUMENT')
    expect(refused.permanent).toBe(true)
  })

  it('is refused for good when the document has no file to give', async () => {
    for (const trouble of [
      new NotFoundException('Den Beleg gibt es nicht.'),
      new UnprocessableEntityException('Der Rechnung fehlt die Käuferreferenz.'),
    ]) {
      const refused = await refusalOf(documentAttachments(filesThat(trouble))(row))

      expect(refused.code).toBe('EDOCUMENT')
      expect(refused.permanent).toBe(true)
    }
  })

  it('waits when the file cannot be made right now', async () => {
    const refused = await refusalOf(
      documentAttachments(filesThat(new Error('Der Renderer antwortet nicht.')))(row),
    )

    expect(refused.code).toBe('EATTACHMENT')
    expect(refused.permanent).toBe(false)
  })
})
