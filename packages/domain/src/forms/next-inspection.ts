import { addMonths, type IsoDate, longestIntervalMonths } from '@opengewerk/platform-domain'

import { fieldsOf, type FormDefinition, type FormField, type NumberField } from './definition.js'
import type { FormValue, FormValues } from './values.js'

/**
 * The next inspection a protocol names (#301): the field in which it says,
 * in months, when the installation is to be tested again, and the day that
 * comes to.
 *
 * A convention of this application and not a kind of field of the
 * foundation: a protocol at an installation that has a number field of this
 * key, counted in months, names its next inspection, whichever trade package
 * it comes from. The deadline engine takes the day from the last signed one
 * of an installation (the source `inspection`), and the screens and the
 * paper say it beside the field.
 */
export const nextInspectionKey = 'next_inspection_months'

/** Whether a field is the one in which a protocol names its next inspection. */
export function isNextInspection(field: FormField): field is NumberField {
  return field.key === nextInspectionKey && field.kind === 'number' && field.unit === 'month'
}

/** The field of a definition that names the next inspection, or null where it names none. */
export function nextInspectionField(definition: FormDefinition): NumberField | null {
  return fieldsOf(definition).find(isNextInspection) ?? null
}

/**
 * The day an interval in months ends, counted from the day of the test, the
 * way a period in months ends. Null where nothing is filled in, and where the
 * interval is not a whole number of months between one and the longest a
 * deadline takes, fifty years.
 */
export function inspectionDueAfter(
  performedOn: IsoDate,
  value: FormValue | undefined,
): IsoDate | null {
  // A number is kept in thousandths of its unit, as every figure of a form.
  if (typeof value !== 'number' || !Number.isInteger(value) || value % 1000 !== 0) {
    return null
  }

  const months = value / 1000

  return months < 1 || months > longestIntervalMonths ? null : addMonths(performedOn, months)
}

/**
 * The day the next inspection of a protocol is due, or null where its
 * definition names none or its interval is not one to count with.
 */
export function nextInspectionOn(
  definition: FormDefinition,
  values: FormValues,
  performedOn: IsoDate,
): IsoDate | null {
  return nextInspectionField(definition) === null
    ? null
    : inspectionDueAfter(performedOn, values[nextInspectionKey])
}
