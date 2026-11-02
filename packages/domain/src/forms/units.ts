import type { FormUnit, RuleUnit } from '@opengewerk/platform-domain'

/**
 * What a figure in a form of this application is counted in. Stored as whole
 * thousandths of it. The first five are what a test protocol measures; the
 * others are for the fields a business gives its report (#78), a distance
 * driven or the temperature on site, and the month for the interval a
 * protocol names to the next inspection (#301). Then the power of a PV
 * system on its commissioning protocol (#304), a thousandth of a kilowatt
 * being a watt, as the PV structure counts it; and the current and the
 * irradiance the test of its DC side measures with (#305).
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
  'month',
  'kilowatt',
  'kilovoltampere',
  'kilowatt_peak',
  'ampere',
  'watt_per_square_metre',
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
  // Short, because a field reads "Prüffrist in Mon." and its value "48 Mon.".
  month: 'Mon.',
  kilowatt: 'kW',
  kilovoltampere: 'kVA',
  kilowatt_peak: 'kWp',
  ampere: 'A',
  watt_per_square_metre: 'W/m²',
}

/**
 * How many thousandths of a field's unit one unit of a rule is. A rule in
 * kiloohms against a field in megaohms: one kiloohm is one thousandth of a
 * megaohm, as a milliohm of an ohm and a microampere of a milliampere (#303). A pair that is not here is a definition that asks the wrong rule,
 * and the tests of a trade package find it.
 */
const fromRule: Readonly<Partial<Record<MeasurementUnit, Partial<Record<RuleUnit, number>>>>> = {
  ohm: { milliohms: 1 },
  megaohm: { kiloohms: 1 },
  milliampere: { microamperes: 1 },
  millisecond: { milliseconds: 1000 },
  volt: { volts: 1000 },
  // A basis point is a hundredth of a percent, ten thousandths of it (#304).
  percent: { basis_points: 10 },
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
