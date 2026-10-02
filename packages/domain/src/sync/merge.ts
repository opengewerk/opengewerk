import { offlineRules } from './policy.js'

export type { MergeResult, RecordState } from '@opengewerk/platform-domain'

/**
 * What the server does with one operation, given what it currently holds,
 * under the policies of this application.
 *
 * How it is decided is the foundation's (ADR 0010) and the same for every
 * application. It is decided in a package without a network rather than in
 * the server, because the device has to be able to work out the same answer
 * before it sends anything, so that it can show a conflict rather than
 * discover one.
 */
export const { decideMerge } = offlineRules
