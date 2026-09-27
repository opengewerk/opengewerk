import core from './core.json' with { type: 'json' }
import type { DeadlineKind } from './deadline.js'

/**
 * The kinds of deadline the core brings: the ones that belong to no trade.
 *
 * JSON like the rule packages, so that a kind is read and checked as data,
 * and so that a trade package brings its own in the same shape. The follow-up
 * of an open quote is the first (3.3), because it needs nothing but the
 * documents that are there already.
 */
export const coreDeadlineKinds: readonly DeadlineKind[] = core.kinds as readonly DeadlineKind[]
