import { BadRequestException } from '@nestjs/common'
import {
  checkedInstanceMeasures,
  type InstanceMeasures,
  type InstanceMeasuresRecord,
  type InstanceMeasuresView,
  type Subprocessor,
} from '@opengewerk/platform-domain'
import { eq, sql } from 'drizzle-orm'

import { accountsOf } from '../authentication/administration.js'
import type { Database } from '../database/database.js'
import { instanceSettings } from '../schema.js'

/**
 * Part B of the technical and organisational measures and the subprocessors
 * of the instance (opengewerk-haustechnik#358): what whoever runs it ensures
 * while running it, and who works for them doing so. Kept on a screen of the
 * area of the instance, read by the application into the measures of each
 * tenant on it, which changes nothing of them. Two columns of the settings of
 * the instance, so that a change stands in its log like every other change of
 * the instance.
 */

const missing =
  'The settings of the instance are missing; the migration that creates the table writes them.'

async function keptOf(
  database: Database,
  asUser?: string,
): Promise<{ readonly measures: InstanceMeasures; readonly subprocessors: Subprocessor[] }> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .select({
          measures: instanceSettings.measures,
          subprocessors: instanceSettings.subprocessors,
        })
        .from(instanceSettings)
        .where(eq(instanceSettings.id, 1)),
    asUser,
  )

  if (!row) {
    throw new Error(missing)
  }

  return {
    measures: row.measures as InstanceMeasures,
    subprocessors: row.subprocessors as Subprocessor[],
  }
}

/**
 * The newest change of either column, out of the log of the instance. Only an
 * update counts: the one row of settings stands in the log as it was written,
 * with an empty part B and no subprocessor, and that is no change by anybody.
 */
async function lastChange(
  database: Database,
  asUser?: string,
): Promise<{ readonly at: string; readonly userId: string | null } | null> {
  const found = await database.forInstance(async (tx) => {
    const rows = await tx.execute(sql`
      select changed_at, user_id
        from instance_changes
       where table_name = 'instance_settings' and operation = 'update'
         and field in ('measures', 'subprocessors')
       order by id desc
       limit 1`)

    return rows.rows as { changed_at: string; user_id: string | null }[]
  }, asUser)
  const [change] = found

  return change ? { at: new Date(change.changed_at).toISOString(), userId: change.user_id } : null
}

/**
 * Part B and annex 2 for the documents of a tenant, with when they were last
 * changed. Who changed them stays in the area of the instance: a tenant learns
 * nothing about the people who run it but what part B itself says.
 */
export async function readMeasures(database: Database): Promise<InstanceMeasuresRecord> {
  const kept = await keptOf(database)
  const change = await lastChange(database)

  return { ...kept, changedAt: change?.at ?? null }
}

/** Part B and annex 2 for their screen, with when and by whom they were last changed. */
export async function readInstanceMeasures(
  database: Database,
  asUser: string,
): Promise<InstanceMeasuresView> {
  const kept = await keptOf(database, asUser)
  const change = await lastChange(database, asUser)
  const accounts = change?.userId ? await accountsOf(database, [change.userId], asUser) : null
  const person = change?.userId ? accounts?.get(change.userId) : undefined

  return { ...kept, changedAt: change?.at ?? null, changedBy: person?.name ?? null }
}

/** What a request may keep, or a 400 with the sentence that says why not. */
export function checkedMeasures(body: unknown): {
  readonly measures: InstanceMeasures
  readonly subprocessors: readonly Subprocessor[]
} {
  const checked = checkedInstanceMeasures(body)

  if ('problem' in checked) {
    throw new BadRequestException(checked.problem)
  }

  return checked
}

/** Keeps both, on the way the log of the instance names "Maßnahmen ändern". */
export async function saveMeasures(
  database: Database,
  userId: string,
  change: {
    readonly measures: InstanceMeasures
    readonly subprocessors: readonly Subprocessor[]
  },
): Promise<InstanceMeasuresView> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .update(instanceSettings)
        .set({
          measures: change.measures,
          subprocessors: change.subprocessors,
          updatedAt: new Date(),
        })
        .where(eq(instanceSettings.id, 1))
        .returning({ id: instanceSettings.id }),
    userId,
    'instance.measures',
  )

  if (!row) {
    throw new Error(missing)
  }

  return readInstanceMeasures(database, userId)
}
