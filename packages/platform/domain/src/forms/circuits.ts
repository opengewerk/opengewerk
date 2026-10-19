import { type TripCharacteristic, tripCharacteristics } from '../model/electrical.js'
import type { LimitCalculator, RepeatList } from './engine.js'

/**
 * What a form knows about the circuits of an electrical installation: the
 * list a group repeats over, what a block keeps of its circuit, and the two
 * limits worked out of it. The engine knows no circuit; an application whose
 * forms are measured on circuits hands these to it (`formEngine`) under the
 * names its terms give them. They take the rules by their keys, so that a
 * rule package of an application answers them: `elektro.loop.factor_b`,
 * `_c` and `_d`, `elektro.loop.nominal_voltage` and
 * `elektro.rcd.trip_current_maximum`.
 */

/** What a limit worked out of a circuit needs to know about it. */
export interface CircuitFacts {
  readonly tripCharacteristic: TripCharacteristic | null
  /** In, in milliamperes, as the circuit chart holds it. */
  readonly ratedCurrentMilli: number | null
  /** IΔn, in milliamperes. */
  readonly ratedResidualCurrentMilli: number | null
}

/**
 * The circuit a block is about, as it stood when the block was filled: how it
 * is named on paper, and what its limits are worked out from. Kept in the
 * block, so that a signed form shows the circuit and the verdict it was
 * signed with even after the chart has changed.
 */
export interface BlockCircuit extends CircuitFacts {
  readonly designation: string
  readonly consumer: string | null
}

/** Whether a value is a circuit as a block keeps it. */
export function isBlockCircuit(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const circuit = value as Record<string, unknown>
  const count = (entry: unknown) =>
    entry === null || (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0)

  return (
    typeof circuit['designation'] === 'string' &&
    circuit['designation'].length <= 200 &&
    (circuit['consumer'] === null ||
      (typeof circuit['consumer'] === 'string' && circuit['consumer'].length <= 200)) &&
    (circuit['tripCharacteristic'] === null ||
      tripCharacteristics.some((entry) => entry === circuit['tripCharacteristic'])) &&
    count(circuit['ratedCurrentMilli']) &&
    count(circuit['ratedResidualCurrentMilli'])
  )
}

/** One block for each circuit of the installation, taken from its circuit chart and not typed again. */
export const circuitList: RepeatList = {
  itemIsValid: isBlockCircuit,
  sentences: {
    blockWithoutItem: (label) => `${label}: jeder Block gehört zu einem Stromkreis.`,
    itemTwice: (label) => `${label}: ein Stromkreis hat zwei Blöcke.`,
  },
}

/**
 * The instantaneous tripping of a breaker as a multiple of its rating, the
 * upper end of its range, which is the one that has to be reached: B at five
 * times In, C at ten, D at twenty. Fuses and the other curves have no such
 * factor, and their limit comes from a table the engine does not hold.
 */
const loopFactorRule: Readonly<Partial<Record<TripCharacteristic, string>>> = {
  b: 'elektro.loop.factor_b',
  c: 'elektro.loop.factor_c',
  d: 'elektro.loop.factor_d',
}

/**
 * The limit of the loop impedance, worked out from the protective device of
 * the circuit: Zs × Ia ≤ U0, the largest impedance at which the breaker still
 * trips instantaneously, in thousandths of an ohm, rounded down so that the
 * limit is never looser than the rule.
 *
 * Written for the terms of no application in particular: it reads nothing of
 * the field, so it is a calculator for the terms of any.
 */
export const loopImpedance: LimitCalculator = (_field, { rules, on, item }) => {
  const circuit = item as CircuitFacts | null
  const rule = circuit?.tripCharacteristic ? loopFactorRule[circuit.tripCharacteristic] : null
  const factor = rule ? rules.at(rule, on) : null
  const voltage = rules.at('elektro.loop.nominal_voltage', on)

  if (!factor || !voltage || !circuit?.ratedCurrentMilli) {
    return {
      none:
        'Der Grenzwert der Schleifenimpedanz lässt sich nur für einen Leitungsschutzschalter ' +
        'B, C oder D mit Nennstrom berechnen.',
    }
  }

  return {
    limitMilli: Math.floor(
      (voltage.value * 1_000_000) / (factor.value * circuit.ratedCurrentMilli),
    ),
    atLeast: false,
    source: `${voltage.source}; ${factor.source}`,
  }
}

/**
 * The limit of the tripping current, a share of the rated residual current of
 * the circuit's device, for the terms of any application as well.
 */
export const residualTripCurrent: LimitCalculator = (_field, { rules, on, item }) => {
  const circuit = item as CircuitFacts | null
  const share = rules.at('elektro.rcd.trip_current_maximum', on)

  if (!share || !circuit?.ratedResidualCurrentMilli) {
    return { none: 'Ohne Bemessungsdifferenzstrom am Stromkreis gibt es keinen Grenzwert.' }
  }

  return {
    limitMilli: Math.floor((circuit.ratedResidualCurrentMilli * 1000 * share.value) / 10_000),
    atLeast: false,
    source: share.source,
  }
}
