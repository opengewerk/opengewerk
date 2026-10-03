import { mailOutboxStore } from '@opengewerk/platform-server'

import { mailOutbox } from '../database/schema/index.js'

export type OutboxRow = typeof mailOutbox.$inferSelect

/**
 * The outbox of this application, kept by the foundation (ADR 0010): when a
 * message is due, how often it is tried and when it is given up on is the
 * same for every application. The rows are this application's, with the
 * task, the document and the deadline its messages are about.
 */
export const outbox = mailOutboxStore(mailOutbox)

export const { giveUpPending } = outbox

export { maximumAttempts } from '@opengewerk/platform-server'
