import {
  berlinClock,
  type ConflictReason,
  defaultNight,
  emergencyKindAt,
  type EmergencyKind,
  emergencySurchargeLine,
  holidaysIn,
  type JobId,
  type LineUnit,
  shippedRules,
  type SurchargeLine,
} from '@opengewerk/domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, gt, isNull, lte } from 'drizzle-orm'

import { holidaySettingOf } from '../absences/absences.js'
import { parameterAt } from '../database/parameters.js'
import { jobs, onCallShifts } from '../database/schema/index.js'

/**
 * How far ahead of the server's clock a device may put the moment of a call:
 * five minutes of a clock that runs fast, and no more.
 */
const clockSlackMs = 5 * 60_000

/** Why a service call made on call may not land, in the shape a sync conflict records. */
export interface OnCallRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

function momentOf(value: unknown): Date | null {
  const moment = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null

  return moment && !Number.isNaN(moment.getTime()) ? moment : null
}

/**
 * Whether a job made by somebody with `job.on_call` and without `job.write`
 * may land (#293, decided on 27.09.2026): a service call, running, standing
 * on its own, whose moment of the call lies in a time of that person's
 * on-call plan and not ahead of the server's clock. A time taken back since,
 * or a call outside every time, is refused as a conflict about this one
 * operation; the office takes the call over from there.
 */
export async function onCallRefusal(
  tx: TenantTransaction,
  userId: string,
  values: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<OnCallRefusal | null> {
  if (values['kind'] !== 'service' || (values['status'] !== undefined && values['status'] !== 'active')) {
    return { reason: 'record_is_fixed', fields: ['kind', 'status'] }
  }

  if (
    (values['parentJobId'] !== undefined && values['parentJobId'] !== null) ||
    (values['predecessorJobId'] !== undefined && values['predecessorJobId'] !== null)
  ) {
    return { reason: 'record_is_fixed', fields: ['parentJobId', 'predecessorJobId'] }
  }

  const moment = momentOf(values['emergencyAt'])

  if (moment === null || moment.getTime() > now.getTime() + clockSlackMs) {
    return { reason: 'record_is_fixed', fields: ['emergencyAt'] }
  }

  const [covering] = await tx
    .select({ id: onCallShifts.id })
    .from(onCallShifts)
    .where(
      and(
        eq(onCallShifts.userId, userId),
        isNull(onCallShifts.deletedAt),
        lte(onCallShifts.startsAt, moment),
        gt(onCallShifts.endsAt, moment),
      ),
    )
    .limit(1)

  return covering ? null : { reason: 'record_is_fixed', fields: ['emergencyAt'] }
}

/** The units of the lines the percentage of a surcharge comes on: the working time. */
const hourUnits: readonly LineUnit[] = ['hour']

/**
 * The line for the surcharge of an emergency call (#293) on the invoice out
 * of its reports, or null: for a job without a moment of a call, for a call
 * in ordinary hours, and for a kind the business set no surcharge for on the
 * day of the call. The public holidays are those of the business on that day.
 */
export async function surchargeLineFor(
  tx: TenantTransaction,
  jobId: string | null,
  lines: readonly { readonly unit: LineUnit; readonly netCents: number }[],
): Promise<SurchargeLine | null> {
  if (jobId === null || !isUuid(jobId)) {
    return null
  }

  const [job] = await tx
    .select({ emergencyAt: jobs.emergencyAt })
    .from(jobs)
    .where(eq(jobs.id, jobId as JobId))

  if (!job?.emergencyAt) {
    return null
  }

  const day = berlinClock(job.emergencyAt).day
  const setting = await holidaySettingOf(tx)
  const year = Number(day.slice(0, 4))
  const holidays = new Set(
    setting === null ? [] : holidaysIn(shippedRules, setting, year).map((holiday) => holiday.on),
  )
  const number = async (key: Parameters<typeof parameterAt>[1]) =>
    (await parameterAt(tx, key, day))?.value ?? null
  const night = {
    fromMinute: (await number('emergency.night_from_minute')) ?? defaultNight.fromMinute,
    untilMinute: (await number('emergency.night_until_minute')) ?? defaultNight.untilMinute,
  }
  const kind: EmergencyKind | null = emergencyKindAt(job.emergencyAt, holidays, night)

  if (kind === null) {
    return null
  }

  const flatCents = (await number(`emergency.${kind}_flat_cents`)) ?? 0
  const basisPoints = (await number(`emergency.${kind}_basis_points`)) ?? 0
  const hourNetCents = lines
    .filter((line) => hourUnits.includes(line.unit))
    .reduce((sum, line) => sum + line.netCents, 0)

  return emergencySurchargeLine(kind, { flatCents, basisPoints }, hourNetCents)
}
