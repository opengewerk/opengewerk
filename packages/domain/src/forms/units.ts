import type { FormUnit, RuleUnit } from '@opengewerk/platform-domain'

/**
 * What a figure in a form of this application is counted in. Stored as whole
 * thousandths of it. The first five are what a test protocol measures; the
 * others are for the fields a business gives its report (#78), a distance
 * driven or the temperature on site.
 */
export const measurementUnits = [
  'ohm',
  'megaohm',
  'milliampere',
  'millisecond',
  'volt',
  'kilometre',
  'metre',
  'hour',
  'minute',
  'degree_celsius',
  'piece',
  'percent',
] as const

export type MeasurementUnit = (typeof measurementUnits)[number]

/** The sign a unit is written with, on screen and on paper. */
export const measurementUnitSign: Readonly<Record<MeasurementUnit, string>> = {
  ohm: 'Ω',
  megaohm: 'MΩ',
  milliampere: 'mA',
  millisecond: 'ms',
  volt: 'V',
  kilometre: 'km',
  metre: 'm',
  hour: 'Std.',
  minute: 'min',
  degree_celsius: '°C',
  piece: 'Stk.',
  percent: '%',
}

/**
 * How many thousandths of a field's unit one unit of a rule is. A rule in
 * kiloohms against a field in megaohms: one kiloohm is one thousandth of a
 * megaohm. A pair that is not here is a definition that asks the wrong rule,
 * and the tests of a trade package find it.
 */
const fromRule: Readonly<Partial<Record<MeasurementUnit, Partial<Record<RuleUnit, number>>>>> = {
  megaohm: { kiloohms: 1 },
  millisecond: { milliseconds: 1000 },
  volt: { volts: 1000 },
}

/** The units as the form engine of the foundation takes them. */
export const formUnits = Object.fromEntries(
  measurementUnits.map((unit) => {
    const conversions = fromRule[unit]
    const entry: FormUnit =
      conversions === undefined
        ? { sign: measurementUnitSign[unit] }
        : { sign: measurementUnitSign[unit], fromRule: conversions }

    return [unit, entry]
  }),
) as Readonly<Record<MeasurementUnit, FormUnit>>
