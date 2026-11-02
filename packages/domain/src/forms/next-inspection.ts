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
 * a change, after DIN VDE 0100-600. The deadline of the last test of the
 * whole stands after such a protocol, unless it names an interval that ends
 * sooner (#822); one that names no occasion tests the whole.
 */
export const occasionKey = 'occasion'

const partialOccasions: readonly string[] = ['extension', 'change']

/** What the screens and the paper say in place of the day, for a test of a part that names no interval. */
export const partialTestSentence =
  'Nach einer Erweiterung oder Änderung bleibt die Frist der letzten Prüfung der Anlage stehen.'

/** What they say after the day a test of a part names: it counts only where it is the sooner (#822). */
export const partialDueCondition =
  'wenn die Frist der letzten Prüfung der Anlage nicht früher endet'

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
 * Whether a protocol tests only a part of its installation: by its occasion
 * (#814), or because its form never tests more, as the DC side of a PV system (#305).
 */
export function testsPart(definition: FormDefinition, values: FormValues): boolean {
  if (definition.partOfInstallation === true) {
    return true
  }

  const occasion = values[occasionKey]

  return (
    typeof occasion === 'string' &&
    partialOccasions.includes(occasion) &&
    fieldsOf(definition).some((field) => field.key === occasionKey && field.kind === 'choice')
  )
}

/**
 * The day the next inspection of a protocol is due, or null where its
 * definition names none and where its interval is not one to count with. A
 * test of a part of the installation names the day of that part, which
 * counts for the installation only where it is the sooner (`installationDueOn`).
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

/** A signed protocol of an installation, as its next inspection is read out of it. */
export interface SignedTest {
  readonly definition: FormDefinition
  readonly values: FormValues
  readonly performedOn: IsoDate
}

/**
 * The day the next inspection of an installation is due, out of its signed
 * protocols with the newest first, and the protocol that names it, or null
 * (#822). The last test of the whole counts, and a test of a part after it
 * where the extended or changed part is to be tested sooner: the earlier day
 * holds. A test of a part never moves the day back, one before the last test
 * of the whole no longer counts, and where that test names no day or there
 * is none, a test of a part makes no deadline of its own (#814). A protocol
 * whose form names no next inspection, as the first inspection before its
 * third version, is passed over.
 */
export function installationDueOn<T extends SignedTest>(
  tests: readonly T[],
): { readonly on: IsoDate; readonly test: T } | null {
  let sooner: { readonly on: IsoDate; readonly test: T } | null = null

  for (const test of tests) {
    if (nextInspectionField(test.definition) === null) {
      continue
    }

    const on = nextInspectionOn(test.definition, test.values, test.performedOn)

    if (!testsPart(test.definition, test.values)) {
      return on === null ? null : sooner !== null && sooner.on < on ? sooner : { on, test }
    }

    if (on !== null && (sooner === null || on < sooner.on)) {
      sooner = { on, test }
    }
  }

  return null
}

/**
 * What the field of the next inspection lacks before a protocol is signed, as
 * the sentence the engine says of a required field, or null (#814). A field
 * the definition does not mark as required, as in the first inspection after
 * DIN VDE 0100-600, is needed where the protocol tests the whole installation,
 * a new one, and may stay empty after an extension or a change (#822).
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
