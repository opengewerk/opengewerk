import {
  acceptanceFormKey,
  acceptanceOf,
  formValuesText,
  type InstallationStructure,
  type IsoDate,
  type JobKind,
  type RecordState,
  shippedRules,
  suggestedBuildingWork,
  warrantyTerms,
} from '@opengewerk/domain'
import { today } from '@opengewerk/platform-web/format'
import {
  type EditResult,
  maybeText,
  type SyncClient,
  text,
  useRecord,
  useRecords,
  useRelated,
} from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

import { addressLine } from './format.js'
import { definitionOf, protocolRegistry, startingValues, valuesOf } from './protocols.js'

/**
 * The acceptance of a job after § 640 BGB (#310) on screen and on site: the
 * form of the core at the job alone, started from the customer and the job,
 * and the warranty that runs from its last signed protocol.
 */

/** Whether the work of a job is a building, as the job says it, or as it suggests where it does not. */
export function buildingWorkOf(job: RecordState): boolean {
  const said = job['buildingWork']

  return typeof said === 'boolean' ? said : suggestedBuildingWork(text(job, 'kind') as JobKind)
}

/** What an acceptance starts from (#310): the customer of the job, and the job with its terms. */
export function useJobStructure(jobId: string | undefined): InstallationStructure | null {
  const job = useRecord('jobs', jobId)
  const customer = useRecord('customers', job ? text(job, 'customerId') : undefined)

  return useMemo(
    () =>
      job
        ? {
            operator: customer
              ? { name: text(customer, 'name'), address: addressLine(customer) }
              : null,
            inverters: [],
            modules: [],
            batteries: [],
            meters: [],
            job: {
              designation: text(job, 'designation'),
              number: maybeText(job, 'number'),
              building: buildingWorkOf(job),
              vob: job['vobAgreed'] === true,
            },
          }
        : null,
    [job, customer],
  )
}

/** A new acceptance at a job alone, through the outbox like every protocol. */
export async function startAcceptance(
  client: SyncClient,
  input: { readonly jobId: string; readonly structure: InstallationStructure | null },
): Promise<EditResult> {
  const definition = protocolRegistry.current().find((entry) => entry.key === acceptanceFormKey)

  if (!definition) {
    throw new Error('The acceptance is not among the forms of this build.')
  }

  return client.create('form_records', {
    definitionKey: definition.key,
    definitionVersion: definition.version,
    installationId: null,
    applianceId: null,
    jobId: input.jobId,
    performedOn: today(),
    status: 'draft',
    values: formValuesText(startingValues(definition, [], null, input.structure)),
  })
}

/** The acceptances of a job, the newest day first. */
export function useAcceptances(jobId: string | undefined): readonly RecordState[] {
  const records = useRelated('form_records', 'jobId', jobId)

  return useMemo(
    () =>
      records
        .filter(
          (record) =>
            text(record, 'definitionKey') === acceptanceFormKey &&
            !maybeText(record, 'installationId') &&
            !maybeText(record, 'applianceId'),
        )
        .sort((left, right) => text(right, 'performedOn').localeCompare(text(left, 'performedOn'))),
    [records],
  )
}

/**
 * The warranty out of the last signed acceptance of a job, as the deadline
 * reads it, or null where there is none yet, it is refused, or the rules say
 * nothing for its day.
 */
export function warrantyOf(acceptances: readonly RecordState[]) {
  const signed = acceptances.find((record) => text(record, 'status') === 'signed')

  if (!signed || !definitionOf(signed)) {
    return null
  }

  const acceptance = acceptanceOf(valuesOf(signed))

  return acceptance
    ? {
        acceptance,
        acceptedOn: text(signed, 'performedOn') as IsoDate,
        terms: warrantyTerms(text(signed, 'performedOn') as IsoDate, acceptance, shippedRules),
      }
    : null
}

/**
 * The warranty of an installation out of the last signed acceptance of a job
 * at it (#310), or null where no job at it has one: then the screens show the
 * end typed in at the installation.
 */
export function useInstallationWarranty(installationId: string | undefined) {
  const jobs = useRelated('jobs', 'installationId', installationId)
  const records = useRecords('form_records')

  return useMemo(() => {
    const jobIds = new Set(jobs.map((job) => String(job['id'])))
    const acceptances = records
      .filter(
        (record) =>
          text(record, 'definitionKey') === acceptanceFormKey &&
          jobIds.has(text(record, 'jobId')) &&
          !maybeText(record, 'installationId') &&
          !maybeText(record, 'applianceId'),
      )
      .sort((left, right) => text(right, 'performedOn').localeCompare(text(left, 'performedOn')))

    return warrantyOf(acceptances)
  }, [jobs, records])
}
