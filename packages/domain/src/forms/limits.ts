import type { IsoDate, LimitVerdict, RuleSet } from '@opengewerk/platform-domain'

import type { CircuitFacts } from './circuits.js'
import type { MeasurementField, MeasurementUnit } from './definition.js'
import { tradeForms } from './engine.js'

export { type LimitVerdict, measuredNumber } from '@opengewerk/platform-domain'
export type { CircuitFacts } from './circuits.js'

/** A value in thousandths, as it is written: `0,85 Ω`. */
export function formatMeasured(milli: number, unit: MeasurementUnit, decimals: number): string {
  return tradeForms.formatMeasured(milli, unit, decimals)
}

/**
 * Judges a measured value against the limit its field names (#79), on the day
 * of the test, with the rules of the trade package, and for the loop
 * impedance and the tripping current with the circuit it was measured on.
 *
 * A value outside its limit is said so, with the limit and its source, and is
 * kept: what was measured goes on the paper, and a protocol that refused it
 * would only make somebody write a different number.
 */
export function limitVerdict(
  field: MeasurementField,
  measuredMilli: number | null,
  context: { readonly rules: RuleSet; readonly on: IsoDate; readonly circuit: CircuitFacts | null },
): LimitVerdict {
  return tradeForms.limitVerdict(field, measuredMilli, {
    rules: context.rules,
    on: context.on,
    item: context.circuit,
  })
}
