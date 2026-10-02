import { offlineRules } from '@opengewerk/domain'
import { SyncClient as Mechanism, type SyncStart } from '@opengewerk/platform-web/sync'

/**
 * The sync client of this application.
 *
 * The client itself is the foundation's (ADR 0010) and knows no record of
 * this application. What makes it this application's is what it is started
 * with: the rules made from its policies, so that a device judges a change as
 * the server will, and the name of what a device keeps for itself.
 *
 * Bound here once, so that every screen and every test that starts a client
 * starts this one, and none can start one that decides by other rules.
 */
export type SyncClient = Mechanism

/**
 * What a device keeps for itself in this application: the running stopwatch
 * of #76, which becomes a time entry only when it stops. The name is the one
 * it has been stored under since then; a device finds a stopwatch that was
 * running when it was updated.
 */
export const stopwatchName = 'stopwatch'

export const SyncClient = {
  start(options: Omit<SyncStart, 'rules' | 'keeps'>): Promise<SyncClient> {
    return Mechanism.start({ ...options, rules: offlineRules, keeps: [stopwatchName] })
  },
}
