import type { Id, InstallationId, IsoDate, JobId, Synced } from '../model/identifier.js'
import type { FormRegistry } from './definition.js'
import { longestFormValues, readFormValues, sealProblems, valuesProblem } from './values.js'

export const formRecordStatuses = ['draft', 'signed'] as const

export type FormRecordStatus = (typeof formRecordStatuses)[number]

/**
 * A filled form (#78): a test protocol at an installation, in the version of
 * its definition it was filled in.
 *
 * Filled on site without a network and sent through the outbox like a
 * report, the values as one field of JSON text (`formValuesText`), whole
 * thousandths for every figure. While
 * it is a draft anybody with the right may change it; once the signature that
 * seals it is given, it is `signed` and changes no more, which the gate of
 * the sync policy and a trigger in the database both hold. What it says then
 * is what the tester signed, circuits and limits included, because every
 * block keeps the circuit it was measured on.
 */
export interface FormRecord extends Synced {
  readonly id: Id<'form-record'>
  readonly definitionKey: string
  readonly definitionVersion: number
  readonly installationId: InstallationId
  /** The job the test was done for, when there was one. */
  readonly jobId: JobId | null
  /** The day of the test, and the day the limits are taken from. */
  readonly performedOn: IsoDate
  readonly status: FormRecordStatus
  /** The values as JSON text, read with `readFormValues`. */
  readonly values: string
}

/**
 * What is wrong with a filled form as it would stand, or null. Asked by the
 * form before anything is queued and by the server when it lands, with the
 * same registry on both sides: a definition this version does not know,
 * values that are not the text of an object, a value of the wrong kind, and a
 * form marked signed that lacks what signing needs are mistakes of the client
 * and refused with the sentence.
 */
export function formRecordProblem(
  registry: FormRegistry,
  record: {
    readonly definitionKey: unknown
    readonly definitionVersion: unknown
    readonly status: unknown
    readonly values: unknown
  },
): string | null {
  const definition =
    typeof record.definitionKey === 'string' && typeof record.definitionVersion === 'number'
      ? registry.definitionFor(record.definitionKey, record.definitionVersion)
      : null

  if (!definition) {
    return 'Dieses Formular kennt diese Fassung von OpenGewerk nicht.'
  }

  if (typeof record.values === 'string' && record.values.length > longestFormValues) {
    return `Die Werte eines Formulars sind höchstens ${String(longestFormValues)} Zeichen lang.`
  }

  const values = readFormValues(record.values ?? '{}')

  if (values === null) {
    return 'Die Werte eines Formulars kommen als JSON-Text eines Objekts.'
  }

  const problem = valuesProblem(definition, values)

  if (problem !== null) {
    return problem
  }

  if (record.status === 'signed') {
    const [missing] = sealProblems(definition, values)

    if (missing !== undefined) {
      return `Unterschrieben wird ein vollständiges Protokoll: ${missing}`
    }
  }

  return null
}
