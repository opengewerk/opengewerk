import { coreDeadlineKinds, type DeadlineRegistry, deadlineRegistry } from '@opengewerk/domain'

/**
 * The kinds of deadline this instance knows: the core's, and those of the
 * trade packages it is built with (ADR 0008). Checked once, when the server
 * starts, so that a kind with a problem stops the start instead of reminding
 * of the wrong thing later.
 *
 * The trade package Elektro brings its first kind with the recurring
 * inspection (#301), whose protocol names the day of the next one; the
 * registry takes it in beside these.
 */
export const deadlineKinds: DeadlineRegistry = deadlineRegistry(coreDeadlineKinds)
