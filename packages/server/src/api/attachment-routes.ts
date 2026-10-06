import type { Permission } from '@opengewerk/domain'
import type { AttachmentRights, AttachmentRoutes } from '@opengewerk/platform-server'

import type { AttachmentHomeColumns } from '../database/schema/attachments.js'
import { attachments, attachmentVersions } from '../database/schema/index.js'

/** The right of the routes of the files, which is the one of the records. */
export const attachmentRights: AttachmentRights<Permission> = {
  read: 'attachment.read',
}

/**
 * The files of a business's records, handed out by version (#77), on the
 * routes of the foundation (opengewerk-haustechnik#97).
 *
 * Asked by the id of a version and never by hash, in the business of whoever
 * asks, and only while the file has not been removed from the records. What a
 * file hangs on, a customer, a site, an installation or a job, is said in the
 * schema; whoever may read the records may read every file in them, so
 * nothing is looked at here before one is handed out.
 */
export const attachmentRoutes: AttachmentRoutes<AttachmentHomeColumns> = {
  tables: { attachments, attachmentVersions },
}
