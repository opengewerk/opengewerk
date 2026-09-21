import baseRate from './data/base-rate.json' with { type: 'json' }
import invoice from './data/invoice.json' with { type: 'json' }
import payment from './data/payment.json' with { type: 'json' }
import { type RuleRecord, ruleSet, type RuleSet } from './rule.js'
import smallBusiness from './data/small-business.json' with { type: 'json' }
import vat from './data/vat.json' with { type: 'json' }

/**
 * One package as it sits in the repository.
 *
 * The note is part of the data on purpose. A package that stops at a certain
 * date says so in the file itself, where whoever maintains it is already
 * looking, rather than in a comment somewhere in the code.
 */
export interface RulePackage {
  readonly package: string
  readonly note: string
  readonly records: readonly RuleRecord[]
}

/**
 * The packages that ship with this version.
 *
 * They are JSON and not TypeScript, and that is the whole point of section
 * 1.7: a new tax rate is an entry in a data file that anybody can read and
 * check against the law it cites, not a change to a piece of logic. Nothing
 * here is read from disk at runtime, so `domain` keeps its promise of having
 * no I/O; the packages are part of the bundle.
 */
export const rulePackages: readonly RulePackage[] = [
  vat as RulePackage,
  smallBusiness as RulePackage,
  invoice as RulePackage,
  payment as RulePackage,
  baseRate as RulePackage,
]

/**
 * Everything that shipped, in one set.
 *
 * Callers pass it in rather than the functions reaching for it themselves. It
 * costs a word at each call and it buys the thing that matters for a legal
 * engine: which rules an answer came out of is visible where the answer is
 * asked for, and a test can hand over a different set without touching a
 * global.
 */
export const shippedRules: RuleSet = ruleSet(rulePackages.flatMap((entry) => entry.records))
