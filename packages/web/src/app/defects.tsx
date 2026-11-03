import {
  berlinClock,
  type DefectStatus,
  defectStatusLabel,
  defectStatusOf,
  type DefectStep,
  defectWarranty,
  type IsoDate,
  type RecordState,
  type WarrantyWindow,
} from '@opengewerk/domain'
import { Status, type StatusTone, useEntry } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { useWho } from '@opengewerk/platform-web/session'
import { NotSent } from '@opengewerk/platform-web/site'
import {
  type EditResult,
  maybeText,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
  type SyncClient,
} from '@opengewerk/platform-web/sync'
import clsx from 'clsx'
import { Check, Clock, type LucideIcon, Signature, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'

import { useAcceptances, useInstallationWarranty, warrantyOf } from './acceptance.js'
import { addAttachment, type AttachmentHome } from './attachments.js'
import { noteMoment } from './job-notes.js'
import { usePeople } from './tasks.js'

/**
 * Defects and complaints on screen and on site (#311): where each stands out
 * of its steps, the steps with who took them and when, whether the day one was
 * reported lies within the warranty, and recording one with its photos.
 */

const tones: Readonly<Record<DefectStatus, StatusTone>> = {
  reported: 'conflict',
  in_progress: 'waiting',
  resolved: 'neutral',
  accepted: 'done',
}

const icons: Readonly<Record<DefectStatus, LucideIcon>> = {
  reported: TriangleAlert,
  in_progress: Clock,
  resolved: Check,
  accepted: Signature,
}

/** Where a defect stands, as the boards draw it: its own colour and symbol for each step. */
export function DefectStatusMark({ status }: { readonly status: DefectStatus }) {
  return (
    <Status tone={tones[status]} icon={icons[status]}>
      {defectStatusLabel[status]}
    </Status>
  )
}

function byTaken(left: RecordState, right: RecordState): number {
  return (
    text(left, 'takenAt').localeCompare(text(right, 'takenAt')) ||
    String(left['id']).localeCompare(String(right['id']))
  )
}

/** The steps of a defect, the first one first. */
export function useDefectSteps(defectId: string | undefined): readonly RecordState[] {
  const steps = useRelated('defect_steps', 'defectId', defectId)

  return useMemo(() => [...steps].sort(byTaken), [steps])
}

/** Where a defect stands out of its steps, as the device holds them. */
export function statusOf(steps: readonly RecordState[]): DefectStatus {
  return defectStatusOf(
    steps.map((step) => ({
      id: String(step['id']),
      step: text(step, 'step'),
      takenAt: text(step, 'takenAt'),
    })),
  )
}

/** Where each of these defects stands, by its id. */
export function useStatuses(defects: readonly RecordState[]): ReadonlyMap<string, DefectStatus> {
  const steps = useRecords('defect_steps')

  return useMemo(() => {
    const ids = new Set(defects.map((defect) => String(defect['id'])))
    const grouped = new Map<string, RecordState[]>()

    for (const step of steps) {
      const defectId = text(step, 'defectId')

      if (ids.has(defectId)) {
        grouped.set(defectId, [...(grouped.get(defectId) ?? []), step])
      }
    }

    return new Map(
      defects.map((defect) => [
        String(defect['id']),
        statusOf(grouped.get(String(defect['id'])) ?? []),
      ]),
    )
  }, [defects, steps])
}

function newestFirst(records: readonly RecordState[]): readonly RecordState[] {
  return [...records].sort(
    (left, right) =>
      text(right, 'reportedAt').localeCompare(text(left, 'reportedAt')) ||
      String(right['id']).localeCompare(String(left['id'])),
  )
}

/** The defects of a job, the newest first. */
export function useJobDefects(jobId: string | undefined): readonly RecordState[] {
  const defects = useRelated('defects', 'jobId', jobId)

  return useMemo(() => newestFirst(defects), [defects])
}

/** The defects and complaints at an installation, the newest first. */
export function useInstallationDefects(installationId: string | undefined): readonly RecordState[] {
  const defects = useRelated('defects', 'installationId', installationId)

  return useMemo(() => newestFirst(defects), [defects])
}

/** The photos of a defect: the files that name it. */
export function useDefectPhotos(defectId: string | undefined): readonly RecordState[] {
  return useRelated('attachments', 'defectId', defectId)
}

/** "Vorbehalt der Abnahme vom 05.11.2026" for a defect out of an acceptance, or null. */
export function useOrigin(defect: RecordState | null): string | null {
  const record = useRecord('form_records', maybeText(defect, 'acceptanceRecordId') ?? undefined)

  return record ? `Vorbehalt der Abnahme vom ${date(text(record, 'performedOn'))}` : null
}

/**
 * The warranty a defect is measured against (#311), as the report reads it:
 * the job's, out of its last signed acceptance; else the installation's, out
 * of the last signed acceptance of a job there or the end typed in.
 */
export function useWarrantyWindow(
  jobId: string | undefined,
  installationId: string | undefined,
): WarrantyWindow | null {
  const ofJob = warrantyOf(useAcceptances(jobId))
  const ofInstallation = useInstallationWarranty(installationId)
  const installation = useRecord('installations', installationId)

  for (const found of [ofJob, ofInstallation]) {
    if (found?.terms) {
      return { acceptedOn: found.acceptedOn, endsOn: found.terms.whole.endsOn }
    }
  }

  const typedIn = maybeText(installation, 'warrantyEndsOn')

  return typedIn ? { acceptedOn: null, endsOn: typedIn as IsoDate } : null
}

/** Whether the day a defect was reported lies within the warranty. */
export function useDefectWarranty(defect: RecordState | null) {
  const window = useWarrantyWindow(
    maybeText(defect, 'jobId') ?? undefined,
    maybeText(defect, 'installationId') ?? undefined,
  )

  if (!defect) {
    return null
  }

  return defectWarranty(
    berlinClock(new Date(text(defect, 'reportedAt'))).day,
    maybeText(defect, 'acceptanceRecordId') !== null,
    window,
  )
}

/** What a new defect is, as the forms hand it in. */
export interface NewDefect {
  readonly jobId: string | null
  readonly installationId: string | null
  readonly description: string
  readonly remedyDueOn: string | null
}

/**
 * A new defect through the outbox, with the moment it was reported by the
 * clock of this device, and its photos after it among the files of its job or
 * installation: `home` names the places a file of the job hangs on. The
 * sentence of the first photo that could not be added, or null.
 */
export async function recordDefect(
  client: SyncClient,
  defect: NewDefect,
  home: AttachmentHome,
  photos: readonly File[],
): Promise<{ readonly made: EditResult; readonly problem: string | null }> {
  const made = await client.create('defects', {
    jobId: defect.jobId,
    installationId: defect.installationId,
    description: defect.description,
    remedyDueOn: defect.remedyDueOn,
    reportedAt: new Date().toISOString(),
  })

  if (made.outcome === 'refused') {
    return { made, problem: null }
  }

  let problem: string | null = null

  for (const photo of photos) {
    const added = await addAttachment(client, { ...home, defectId: made.id }, photo, false)

    problem ??= added
  }

  return { made, problem }
}

/** A step of a defect through the outbox, with the moment it was taken; the acceptance with its signer. */
export function takeStep(
  client: SyncClient,
  defectId: string,
  step: DefectStep,
  signer: { readonly name: string; readonly path: string } | null = null,
): Promise<EditResult> {
  return client.create('defect_steps', {
    defectId,
    step,
    takenAt: new Date().toISOString(),
    ...(signer ? { signerName: signer.name.trim(), signaturePath: signer.path } : {}),
  })
}

/**
 * Where the photos of a defect lie: among the files of its job, with the
 * job's customer and site, or of its installation, with the installation's
 * site and its customer, so that they turn up on all of those screens.
 */
export function useDefectHome(jobId: string | null, installationId: string | null): AttachmentHome {
  const job = useRecord('jobs', jobId ?? undefined)
  const installation = useRecord('installations', installationId ?? undefined)
  const site = useRecord('sites', maybeText(installation, 'siteId') ?? undefined)

  if (job) {
    return {
      jobId: String(job['id']),
      customerId: maybeText(job, 'customerId'),
      siteId: maybeText(job, 'siteId'),
      installationId: installationId ?? maybeText(job, 'installationId'),
    }
  }

  return {
    installationId,
    siteId: maybeText(installation, 'siteId'),
    customerId: maybeText(site, 'customerId'),
  }
}

/** Where the report of the defects of a job is printed (#311). */
export function defectReportAddress(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}/defect-report`
}

/** Who a person of the business is, by the id the server wrote; the person looking for one not sent yet. */
export function useAuthorName(): (userId: unknown) => string {
  const { me, people } = usePeople()
  const who = useWho()

  return (userId) =>
    typeof userId !== 'string' || userId === me
      ? who.name || 'Sie'
      : (people.find((person) => person.userId === userId)?.name ?? 'Jemand aus dem Betrieb')
}

/**
 * The steps of a defect, the newest first and reported last, as the boards
 * "Mangel" draw them: the step, who took it and when; for the acceptance the
 * customer who signed.
 */
export function DefectHistory({
  defect,
  steps,
  origin,
}: {
  readonly defect: RecordState
  readonly steps: readonly RecordState[]
  readonly origin: string | null
}) {
  const client = useSync()
  const site = useEntry() === 'site'
  const author = useAuthorName()
  const entries = [
    ...[...steps].reverse().map((step) => ({
      id: String(step['id']),
      label: defectStatusLabel[text(step, 'step') as DefectStep],
      who:
        text(step, 'step') === 'accepted' && maybeText(step, 'signerName')
          ? `${text(step, 'signerName')}, Unterschrift`
          : author(step['createdBy']),
      when: noteMoment(text(step, 'takenAt')),
      accepted: text(step, 'step') === 'accepted',
      pending: client.isPending('defect_steps', String(step['id'])),
    })),
    {
      id: String(defect['id']),
      label: defectStatusLabel.reported,
      who: origin ? 'Aus der Abnahme' : author(defect['createdBy']),
      when: origin
        ? date(berlinClock(new Date(text(defect, 'reportedAt'))).day)
        : noteMoment(text(defect, 'reportedAt')),
      accepted: false,
      pending: client.isPending('defects', String(defect['id'])),
    },
  ]

  return (
    <ul aria-label="Verlauf" className="flex flex-col">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className={clsx(
            'flex gap-2.5 border-b border-row last:border-b-0',
            site ? 'py-[9px]' : 'py-2',
          )}
        >
          <span
            aria-hidden="true"
            className={clsx(
              'size-2.5 shrink-0 rounded-full',
              site ? 'mt-[7px]' : 'mt-[5px]',
              entry.accepted ? 'bg-done' : 'bg-copper',
            )}
          />
          <div className="min-w-0">
            <p className={clsx('font-semibold', site ? 'text-[17px]' : 'text-[14px]')}>
              {entry.label}
            </p>
            <p
              className={clsx(
                'numeric text-ink-muted',
                site ? 'mt-0.5 text-[15px]' : 'mt-0.5 text-[13px]',
              )}
            >
              {`${entry.who}, ${entry.when}`}
              {entry.pending ? (
                <>
                  {', '}
                  <NotSent />
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
