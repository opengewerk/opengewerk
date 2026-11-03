import type { FormRecordStatus, Id, IsoDate, Synced } from '@opengewerk/platform-domain'

import type { ApplianceId, InstallationId, JobId } from '../model/identifier.js'
import type { FormDefinition, FormRegistry } from './definition.js'
import { tradeForms } from './engine.js'
import { nextInspectionMissing } from './next-inspection.js'
import { readFormValues } from './values.js'

export { formRecordStatuses, type FormRecordStatus } from '@opengewerk/platform-domain'

/**
 * A filled form (#78): a test protocol at an installation, or at an appliance of
 * the register (#303), in the version of its definition it was filled in.
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
  /** The installation it was tested at, or null for the test of an appliance. */
  readonly installationId: InstallationId | null
  /** The appliance it was tested at (#303); a protocol hangs on the one or the other. */
  readonly applianceId: ApplianceId | null
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
 * and refused with the sentence. What signing needs includes the next
 * inspection where the protocol has to name it (#814).
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
  const problem = tradeForms.formRecordProblem(registry, record)

  if (problem !== null || record.status !== 'signed') {
    return problem
  }

  // Known and of the right kinds, or the engine would have said so.
  const definition = registry.definitionFor(
    record.definitionKey as string,
    record.definitionVersion as number,
  )
  const values = readFormValues(record.values ?? '{}')
  const missing =
    definition === null || values === null ? null : nextInspectionMissing(definition, values)

  return missing === null ? null : `Unterschrieben wird ein vollständiges Protokoll: ${missing}`
}

/**
 * Whether a filled form hangs on what its definition names (#303): a test
 * protocol of an installation at an installation, the test of an appliance at a
 * appliance. The database holds that it hangs on exactly one of them; which one
 * fits is the definition's to say. Null for a definition this version does
 * not know, which `formRecordProblem` refuses on its own.
 */
export function formSubjectProblem(
  definition: FormDefinition | null,
  subject: {
    readonly installationId: unknown
    readonly applianceId: unknown
    readonly jobId?: unknown
  },
): string | null {
  // A form of a job hangs on the job alone (#310), as `form_records_one_subject` holds.
  if (
    definition?.attachesTo === 'job' &&
    (typeof subject.jobId !== 'string' ||
      typeof subject.installationId === 'string' ||
      typeof subject.applianceId === 'string')
  ) {
    return 'Dieses Formular gehört an einen Auftrag.'
  }

  if (definition?.attachesTo === 'appliance' && typeof subject.applianceId !== 'string') {
    return 'Dieses Formular gehört an ein Gerät.'
  }

  if (definition?.attachesTo === 'installation' && typeof subject.installationId !== 'string') {
    return 'Dieses Formular gehört an eine Anlage.'
  }

  return null
}
