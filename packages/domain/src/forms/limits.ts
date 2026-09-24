import type { TripCharacteristic } from '../model/electrical.js'
import type { IsoDate } from '../model/identifier.js'
import { RuleError, type RuleRecord, type RuleSet, type RuleUnit } from '../rules/rule.js'
import type { MeasurementField, MeasurementUnit } from './definition.js'
import { measurementUnitSign } from './definition.js'

/** What a limit worked out of a circuit needs to know about it. */
export interface CircuitFacts {
  readonly tripCharacteristic: TripCharacteristic | null
  /** In, in milliamperes, as the circuit chart holds it. */
  readonly ratedCurrentMilli: number | null
  /** IΔn, in milliamperes. */
  readonly ratedResidualCurrentMilli: number | null
}

/**
 * How a measured value stands against its limit.
 *
 * `within` is null when there is nothing to judge: no value yet, no limit in
 * the definition, or one that cannot be worked out, a loop impedance behind a
 * fuse for instance, whose limit is not a factor of its rating. The text says
 * which, and the source says where the limit comes from, so that whoever
 * reads the protocol can check it.
 */
export interface LimitVerdict {
  readonly within: boolean | null
  /** The limit in thousandths of the field's unit, null when there is none. */
  readonly limitMilli: number | null
  readonly text: string
  readonly source: string | null
}

/**
 * How many thousandths of a field's unit one unit of a rule is. A rule in
 * kiloohms against a field in megaohms: one kiloohm is one thousandth of a
 * megaohm. A pair that is not here is a definition that asks the wrong rule,
 * and the tests of a trade package find it.
 */
const inField: Readonly<Partial<Record<MeasurementUnit, Partial<Record<RuleUnit, number>>>>> = {
  megaohm: { kiloohms: 1 },
  millisecond: { milliseconds: 1000 },
  volt: { volts: 1000 },
}

function thousandthsOf(unit: MeasurementUnit, record: RuleRecord): number {
  const factor = inField[unit]?.[record.unit]

  if (factor === undefined) {
    throw new RuleError(
      `Die Regel ${record.key} in ${record.unit} passt nicht zu einem Messwert in ${unit}.`,
    )
  }

  return record.value * factor
}

const numberFormats = new Map<number, Intl.NumberFormat>()

/** A value in thousandths, as it is written: `0,85 Ω`. */
export function formatMeasured(milli: number, unit: MeasurementUnit, decimals: number): string {
  const format =
    numberFormats.get(decimals) ??
    new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })

  numberFormats.set(decimals, format)

  return `${format.format(milli / 1000)} ${measurementUnitSign[unit]}`
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

function none(text: string): LimitVerdict {
  return { within: null, limitMilli: null, text, source: null }
}

/**
 * Judges a measured value against the limit its field names (#79), on the day
 * of the test, with the rules of the trade package.
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
  const limit = field.limit

  if (!limit) {
    return none('Kein Grenzwert.')
  }

  const { rules, on, circuit } = context
  let limitMilli: number
  let atLeast: boolean
  let source: string

  switch (limit.kind) {
    case 'at_least':
    case 'at_most': {
      const record = rules.at(limit.rule, on)

      if (!record) {
        return none('Für diesen Tag ist kein Grenzwert hinterlegt.')
      }

      limitMilli = thousandthsOf(field.unit, record)
      atLeast = limit.kind === 'at_least'
      source = record.source
      break
    }
    case 'loop_impedance': {
      const rule = circuit?.tripCharacteristic ? loopFactorRule[circuit.tripCharacteristic] : null
      const factor = rule ? rules.at(rule, on) : null
      const voltage = rules.at('elektro.loop.nominal_voltage', on)

      if (!factor || !voltage || !circuit?.ratedCurrentMilli) {
        return none(
          'Der Grenzwert der Schleifenimpedanz lässt sich nur für einen Leitungsschutzschalter ' +
            'B, C oder D mit Nennstrom berechnen.',
        )
      }

      // Zs × Ia ≤ U0: the largest impedance at which the breaker still trips
      // instantaneously, in thousandths of an ohm, rounded down so that the
      // limit is never looser than the rule.
      limitMilli = Math.floor(
        (voltage.value * 1_000_000) / (factor.value * circuit.ratedCurrentMilli),
      )
      atLeast = false
      source = `${voltage.source}; ${factor.source}`
      break
    }
    case 'rcd_trip_current': {
      const share = rules.at('elektro.rcd.trip_current_maximum', on)

      if (!share || !circuit?.ratedResidualCurrentMilli) {
        return none('Ohne Bemessungsdifferenzstrom am Stromkreis gibt es keinen Grenzwert.')
      }

      limitMilli = Math.floor((circuit.ratedResidualCurrentMilli * 1000 * share.value) / 10_000)
      atLeast = false
      source = share.source
      break
    }
  }

  // Written with the places of the field and rounded towards the strict side:
  // 2,875 Ω as "höchstens 2,87 Ω", never 2,88, or a measured 2,88 Ω would be
  // outside a limit that reads like it.
  const step = 10 ** Math.max(0, 3 - field.decimals)
  const shown = atLeast ? Math.ceil(limitMilli / step) * step : Math.floor(limitMilli / step) * step
  const stated = `${atLeast ? 'mindestens' : 'höchstens'} ${formatMeasured(
    shown,
    field.unit,
    field.decimals,
  )}`

  if (measuredMilli === null) {
    return { within: null, limitMilli, text: `Grenzwert: ${stated}.`, source }
  }

  const within = atLeast ? measuredMilli >= limitMilli : measuredMilli <= limitMilli

  return {
    within,
    limitMilli,
    text: within ? `Innerhalb des Grenzwerts, ${stated}.` : `Außerhalb des Grenzwerts, ${stated}.`,
    source,
  }
}
