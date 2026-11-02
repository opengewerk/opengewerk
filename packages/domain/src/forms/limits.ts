import type { CircuitFacts, IsoDate, LimitVerdict, RuleSet } from '@opengewerk/platform-domain'

import type { ApplianceFacts } from '../model/appliance.js'
import type { MeasurementField, MeasurementUnit } from './definition.js'
import { tradeForms } from './engine.js'
import { isRuleLimit } from '@opengewerk/platform-domain'

export { type CircuitFacts, type LimitVerdict, measuredNumber } from '@opengewerk/platform-domain'

/** A value in thousandths, as it is written: `0,85 Ω`. */
export function formatMeasured(milli: number, unit: MeasurementUnit, decimals: number): string {
  return tradeForms.formatMeasured(milli, unit, decimals)
}

/**
 * The limits a measured value has to reach rather than stay under. A rule
 * says so itself (`at_least`); of the limits worked out, only the insulation
 * of an appliance does (#303), the loop impedance, the tripping current and
 * the protective conductor of an appliance are limits to stay under.
 */
const workedOutMinimums: ReadonlySet<string> = new Set(['appliance_insulation'])

/** Whether the limit of a field is one to reach, "mindestens", rather than one to stay under. */
export function limitIsMinimum(field: MeasurementField): boolean {
  const limit = field.limit

  if (limit === undefined) {
    return false
  }

  return isRuleLimit(limit) ? limit.kind === 'at_least' : workedOutMinimums.has(limit.kind)
}

/**
 * Judges a measured value against the limit its field names (#79), on the day
 * of the test, with the rules of the trade package, and for the loop
 * impedance and the tripping current with the circuit it was measured on; for
 * the test of an appliance (#303) with the appliance, its protection class and lead.
 *
 * A value outside its limit is said so, with the limit and its source, and is
 * kept: what was measured goes on the paper, and a protocol that refused it
 * would only make somebody write a different number.
 */
export function limitVerdict(
  field: MeasurementField,
  measuredMilli: number | null,
  context: {
    readonly rules: RuleSet
    readonly on: IsoDate
    readonly circuit: CircuitFacts | null
    readonly appliance?: ApplianceFacts | null
  },
): LimitVerdict {
  return tradeForms.limitVerdict(field, measuredMilli, {
    rules: context.rules,
    on: context.on,
    item: context.circuit ?? context.appliance ?? null,
  })
}
