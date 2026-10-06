import { type AttachmentRecord, attachmentRules } from '@opengewerk/platform-domain'
import type { CustomerId, InstallationId, JobId, SiteId } from './identifier.js'

/**
 * A file in the business's records, hung on what it is about (#77, 4.10).
 *
 * A customer, a site, an installation and a job, any of them and at least one.
 * The links are independent, like a task's: a wiring diagram taken at a job
 * carries the job and, with it, the installation, the site and the customer,
 * so it turns up wherever somebody looks for it later. One hung on a customer
 * carries only the customer.
 *
 * What a file is, its versions and how a photo is made smaller are the
 * foundation's (opengewerk-haustechnik#97); what one hangs on here is this
 * application's. The bytes are not here and not on this row's versions
 * either. They lie in the content addressed store from ADR 0007, and a
 * version names them by their SHA-256.
 */
export interface Attachment extends AttachmentRecord {
  readonly customerId: CustomerId | null
  readonly siteId: SiteId | null
  readonly installationId: InstallationId | null
  readonly jobId: JobId | null
}

/**
 * The rules of the files of this application, as the foundation makes them
 * from its four places and its two sentences: one object for the screens and
 * the sync, so that both read the rule the check `attachments_have_a_home`
 * holds in the database the same way.
 */
export const tradeAttachments = attachmentRules({
  homes: ['customerId', 'siteId', 'installationId', 'jobId'],
  text: {
    noHome: 'Eine Datei hängt an einem Kunden, einem Objekt, einer Anlage oder einem Auftrag.',
    mediaType: 'Der Typ der Datei ist nicht so angegeben, wie OpenGewerk ihn festhält.',
  },
})

/** Why a type is not the one `fileMediaType` records, or null when it is. */
export function attachmentMediaTypeProblem(mediaType: unknown): string | null {
  return tradeAttachments.mediaTypeProblem(mediaType)
}

/** The four places a file can hang on. */
export const attachmentHomes = tradeAttachments.homes

/**
 * Why an attachment has nowhere to hang, or null when it has somewhere. A form
 * takes its places from the screen it stands on, so only a broken client sends
 * none; the check in the database holds the same rule.
 */
export function attachmentHomeProblem(attachment: {
  readonly customerId?: unknown
  readonly siteId?: unknown
  readonly installationId?: unknown
  readonly jobId?: unknown
}): string | null {
  return tradeAttachments.homeProblem(attachment)
}
