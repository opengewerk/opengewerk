import type { InvitationId, TenantIdentity } from '@opengewerk/platform-domain'

import type { TenantTransaction } from '../database/database.js'

/**
 * An invitation that goes out by mail instead of being handed over as a link.
 *
 * The administration of a tenant knows that this exists and nothing about
 * how: which mail server a tenant sends through, what the message says and
 * where it waits until it is sent is for whoever sends mail in the application
 * to know. What is here is the moments that part is asked. Without it an
 * invitation is still made and handed over as a link, which is the way that
 * always works.
 */

/** Where the message with an invitation stands. */
export interface InvitationMail {
  readonly status: 'pending' | 'sent' | 'failed'
  readonly sentAt: Date | null
  readonly lastError: string | null
}

/** What sends an invitation, on an instance that sends mail. */
export interface InvitationSender {
  /**
   * Refuses, with the sentence saying why, where this tenant cannot send an
   * invitation by mail. Asked before the invitation is made: one written
   * anyway would wait for a mail server nobody set up, and whoever invited
   * would take it for sent.
   */
  ready(identity: TenantIdentity): Promise<void>
  /**
   * Takes an invitation that was just made. Its token is not handed over with
   * it and does not exist yet: the sender makes one at the moment the message
   * leaves (`mintToken`), so that it stands in the message and nowhere else.
   */
  send(identity: TenantIdentity, invitationId: InvitationId): Promise<void>
}

export interface InvitationMailing {
  /**
   * Null on an instance that sends no mail at all. A wish for a mail is then
   * refused with the sentence saying so; the link to pass on works as ever.
   */
  readonly sender: InvitationSender | null
  /**
   * The message each of these invitations went out with, where one did. Read
   * in the transaction that lists the invitations, inside the tenant, and
   * whether or not the instance sends right now: an invitation that went out
   * earlier still shows how its message stands.
   */
  mailsOf(
    tx: TenantTransaction,
    invitationIds: readonly InvitationId[],
  ): Promise<ReadonlyMap<string, InvitationMail>>
}

/**
 * How an application sends an invitation by mail, for the controller of the
 * administration; null for an application that only hands out links.
 */
export const INVITATION_MAILING = Symbol('InvitationMailing')
