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

/**
 * The field in which a protocol says why the test was made, and the answers
 * with which it tests only a part of the installation (#814): an extension or
 * a change, after DIN VDE 0100-600. Such a protocol names no next inspection,
 * whatever stands in its field, and the deadline of the last test of the
 * whole stands; one that names no occasion tests the whole.
 */
export const occasionKey = 'occasion'

const partialOccasions: readonly string[] = ['extension', 'change']

/** What the screens and the paper say in place of the day, for a test of a part. */
export const partialTestSentence =
  'Nach einer Erweiterung oder Änderung bleibt die Frist der letzten Prüfung der Anlage stehen.'

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

/** Whether a protocol tests only a part of its installation, by its occasion (#814). */
export function testsPart(definition: FormDefinition, values: FormValues): boolean {
  const occasion = values[occasionKey]

  return (
    typeof occasion === 'string' &&
    partialOccasions.includes(occasion) &&
    fieldsOf(definition).some((field) => field.key === occasionKey && field.kind === 'choice')
  )
}

/**
 * The day the next inspection of a protocol is due, or null where its
 * definition names none, where it tests only a part of the installation and
 * where its interval is not one to count with.
 */
export function nextInspectionOn(
  definition: FormDefinition,
  values: FormValues,
  performedOn: IsoDate,
): IsoDate | null {
  return nextInspectionField(definition) === null || testsPart(definition, values)
    ? null
    : inspectionDueAfter(performedOn, values[nextInspectionKey])
}

/**
 * What the field of the next inspection lacks before a protocol is signed, as
 * the sentence the engine says of a required field, or null (#814). A field
 * the definition does not mark as required, as in the first inspection after
 * DIN VDE 0100-600, is needed where the protocol tests the whole installation,
 * a new one, and stays empty after an extension or a change.
 */
export function nextInspectionMissing(
  definition: FormDefinition,
  values: FormValues,
): string | null {
  const field = nextInspectionField(definition)

  return field === null ||
    field.required === true ||
    testsPart(definition, values) ||
    values[nextInspectionKey] !== undefined
    ? null
    : `${field.label} fehlt.`
}
