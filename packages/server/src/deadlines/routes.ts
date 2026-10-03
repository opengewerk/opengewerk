import type {
  CustomerId,
  DeadlineKind,
  DocumentId,
  InstallationId,
  JobId,
  SiteId,
  TaskId,
  TenantId,
} from '@opengewerk/domain'
import {
  type DeadlineEntry,
  type DeadlineKindEntry,
  type DeadlineRules,
  deadlineSettingsOf,
  responsibleFor,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, inArray } from 'drizzle-orm'

import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import { customers, deadlines, tasks } from '../database/schema/index.js'
import type { DeadlineRow } from './engine.js'
import { deadlineKinds } from './registry.js'

/** One deadline as the office of a business reads it in the list "Fristen". */
export interface BusinessDeadlineEntry extends Omit<DeadlineEntry, 'source'> {
  /** The trade package the kind comes from, or null for the core. */
  readonly trade: string | null
  readonly source: {
    readonly label: string
    readonly documentId: DocumentId | null
    readonly installationId: InstallationId | null
  }
  readonly customer: { readonly id: CustomerId; readonly name: string } | null
  readonly siteId: SiteId | null
  readonly jobId: JobId | null
  readonly taskId: TaskId | null
}

/** A kind of deadline as the office of a business reads it, with its trade. */
export interface BusinessDeadlineKindEntry extends DeadlineKindEntry {
  readonly trade: string | null
}

/**
 * The task the reminder of a deadline made for the due day it has now. An
 * older one was for an older day and is left as it is.
 */
function taskOfTheDay(row: DeadlineRow): DeadlineRow['taskId'] {
  return row.taskId !== null && row.remindedFor === row.dueOn ? row.taskId : null
}

/** Hands the open task of a deadline to whoever answers for it now. */
async function handTaskOn(
  tx: TenantTransaction,
  tenantId: TenantId,
  row: DeadlineRow,
): Promise<void> {
  const task = taskOfTheDay(row)
  const kind = deadlineKinds.kind(row.kind)

  if (task === null || !kind) {
    return
  }

  const setting = (await deadlineSettingsOf(tx)).get(kind.key) ?? null
  const responsible = await responsibleFor(tx, tenantId, kind, setting, row)

  if (responsible !== null) {
    await tx
      .update(tasks)
      .set({ assigneeUserId: responsible })
      .where(and(eq(tasks.id, task), eq(tasks.status, 'open')))
  }
}

/**
 * The deadlines of a business as the routes of the foundation show them
 * (ADR 0010, opengewerk-haustechnik#24), with what this application adds.
 *
 * An entry of the list names the trade of its kind, what its source is, a
 * document or an installation, and the customer, site, job and task it hangs
 * on; the customer by name, read in one query for the whole list. The task
 * its reminder made goes with the deadline: it changes hands with a new
 * person, is done when the deadline is marked done, and opens again with it.
 * Left done, the next pass of the engine would find the task done and close
 * the deadline again within the minute.
 */
export const deadlineRules: DeadlineRules<DeadlineKind, ApplicationDeadlineColumns> = {
  table: deadlines,
  registry: deadlineKinds,
  describe: async (tx, rows) => {
    const customerIds = [
      ...new Set(rows.flatMap((row) => (row.customerId === null ? [] : [row.customerId]))),
    ]
    const names =
      customerIds.length === 0
        ? []
        : await tx
            .select({ id: customers.id, name: customers.name })
            .from(customers)
            .where(inArray(customers.id, customerIds as CustomerId[]))
    const nameOf = new Map<string, string>(names.map((row) => [row.id, row.name]))

    return (row) => {
      const name = row.customerId === null ? undefined : nameOf.get(row.customerId)

      return {
        trade: deadlineKinds.kind(row.kind)?.trade ?? null,
        source: {
          label: row.sourceLabel,
          documentId: row.documentId,
          installationId: row.installationId,
        },
        customer:
          row.customerId !== null && name !== undefined ? { id: row.customerId, name } : null,
        siteId: row.siteId,
        jobId: row.jobId,
        taskId: row.taskId,
      }
    }
  },
  kindFields: (kind) => ({ trade: kind.trade }),
  afterResponsible: handTaskOn,
  afterDone: async (tx, row) => {
    const task = taskOfTheDay(row)

    if (task !== null) {
      await tx
        .update(tasks)
        .set({ status: 'done' })
        .where(and(eq(tasks.id, task), eq(tasks.status, 'open')))
    }
  },
  afterReopen: async (tx, row) => {
    const task = taskOfTheDay(row)

    if (task !== null) {
      await tx
        .update(tasks)
        .set({ status: 'open' })
        .where(and(eq(tasks.id, task), eq(tasks.status, 'done')))
    }
  },
  sentences: {
    notAColleague:
      'Die Person aus responsibleUserId arbeitet nicht in diesem Betrieb oder ist gesperrt.',
  },
}
