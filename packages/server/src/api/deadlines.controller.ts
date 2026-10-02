import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type DeadlineId,
  type DeadlineKind,
  type DeadlineSetting,
  type DeadlineStatus,
  deadlineStatuses,
  intervalProblem,
  type IsoDate,
  leadOf,
  leadProblem,
  remindOn,
  type TenantId,
} from '@opengewerk/domain'
import { accountsOf, Database, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, sql } from 'drizzle-orm'

import {
  customers,
  deadlines,
  deadlineSettings,
  memberships,
  tasks,
} from '../database/schema/index.js'
import type { DeadlineRow } from '../deadlines/engine.js'
import { deadlineKinds } from '../deadlines/registry.js'
import { responsibleFor } from '../deadlines/responsible.js'
import { settingsOf } from '../deadlines/settings.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** One person as the list names them. */
interface Person {
  readonly userId: string
  readonly name: string
}

/** One deadline as the office reads it in the list "Fristen". */
export interface DeadlineEntry {
  readonly id: DeadlineId
  readonly kind: string
  readonly kindTitle: string
  /** The trade package the kind comes from, or null for the core. */
  readonly trade: string | null
  readonly status: DeadlineStatus
  readonly anchorOn: IsoDate
  readonly dueOn: IsoDate
  /** The day it reminds, from the lead that applies. */
  readonly remindOn: IsoDate
  /** The lead that applies, and the one the deadline has of its own. */
  readonly leadDays: number
  readonly ownLeadDays: number | null
  /** Who answers for it now, and the person it has of its own. */
  readonly responsible: Person | null
  readonly ownResponsibleUserId: string | null
  readonly source: {
    readonly label: string
    readonly documentId: string | null
    readonly installationId: string | null
  }
  readonly customer: { readonly id: string; readonly name: string } | null
  readonly siteId: string | null
  readonly jobId: string | null
  readonly remindedFor: IsoDate | null
  readonly remindedAt: Date | null
  readonly taskId: string | null
  readonly closedAt: Date | null
  readonly closedBy: Person | null
}

/** A kind with what the business has set for it, for the settings and the filter of the list. */
export interface DeadlineKindEntry {
  readonly key: string
  readonly title: string
  readonly about: string
  readonly trade: string | null
  readonly source: string
  readonly actions: readonly string[]
  readonly responsible: DeadlineKind['responsible']
  readonly intervalDays: number | null
  readonly leadDays: number
  readonly setting: {
    readonly intervalDays: number | null
    readonly leadDays: number | null
    readonly responsibleUserId: string | null
  }
}

function kindEntries(settings: ReadonlyMap<string, DeadlineSetting>): DeadlineKindEntry[] {
  return deadlineKinds.kinds.map((kind) => {
    const setting = settings.get(kind.key)

    return {
      key: kind.key,
      title: kind.title,
      about: kind.about,
      trade: kind.trade,
      source: kind.source,
      actions: kind.actions,
      responsible: kind.responsible,
      intervalDays: kind.intervalDays,
      leadDays: kind.leadDays,
      setting: {
        intervalDays: setting?.intervalDays ?? null,
        leadDays: setting?.leadDays ?? null,
        responsibleUserId: setting?.responsibleUserId ?? null,
      },
    }
  })
}

function asStatus(value: unknown): DeadlineStatus | 'all' {
  if (value === undefined || value === '') {
    return 'open'
  }

  if (value === 'all' || (deadlineStatuses as readonly unknown[]).includes(value)) {
    return value as DeadlineStatus | 'all'
  }

  throw new BadRequestException(`Unbekannter Stand einer Frist: ${String(value)}`)
}

/** A number of days, or null for "the kind's own"; anything else is refused with the sentence of the form. */
function daysOrNull(
  value: unknown,
  problem: (days: number) => string | null,
  field: string,
): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number') {
    throw new BadRequestException(`${field} ist eine Zahl von Tagen oder leer.`)
  }

  const found = problem(value)

  if (found !== null) {
    throw new BadRequestException(found)
  }

  return value
}

/**
 * Refuses a person who does not work in this business or is blocked, the way
 * a task refuses one (#80): a deadline for somebody who cannot sign in waits
 * with nobody.
 */
async function requireColleague(
  tx: TenantTransaction,
  tenantId: TenantId,
  value: unknown,
): Promise<string | null> {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException('Die verantwortliche Person fehlt.')
  }

  const [member] = await tx
    .select({ blockedAt: memberships.blockedAt })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, value)))

  if (!member || member.blockedAt !== null) {
    throw new UnprocessableEntityException(
      'Die Person aus responsibleUserId arbeitet nicht in diesem Betrieb oder ist gesperrt.',
    )
  }

  return value
}

/**
 * The deadlines of this business (#283), for the list "Fristen".
 *
 * Nobody creates one here: the engine in `deadlines/` follows the sources and
 * writes them. What the office decides is done or not, a lead of its own and
 * a person of its own; everything else a deadline says comes from its source
 * and changes there.
 */
@Controller('deadlines')
export class DeadlinesController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('deadline.read')
  async list(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('status') status: unknown,
  ): Promise<DeadlineEntry[]> {
    const wanted = asStatus(status)

    const { rows, settings, responsibles } = await this.database.forTenant(identity, async (tx) => {
      const rows = await tx
        .select({ deadline: deadlines, customer: customers.name })
        .from(deadlines)
        .leftJoin(customers, eq(customers.id, deadlines.customerId))
        .where(wanted === 'all' ? sql`true` : eq(deadlines.status, wanted))
        .orderBy(asc(deadlines.dueOn), asc(deadlines.sourceLabel))
      const settings = await settingsOf(tx)
      const responsibles = new Map<string, string | null>()

      for (const { deadline } of rows) {
        const kind = deadlineKinds.kind(deadline.kind)

        responsibles.set(
          deadline.id,
          kind
            ? await responsibleFor(
                tx,
                identity.tenantId,
                kind,
                settings.get(kind.key) ?? null,
                deadline,
              )
            : null,
        )
      }

      return { rows, settings, responsibles }
    })

    const people = new Set<string>()

    for (const { deadline } of rows) {
      const responsible = responsibles.get(deadline.id)

      if (responsible) {
        people.add(responsible)
      }

      if (deadline.closedBy) {
        people.add(deadline.closedBy)
      }
    }

    // The names come from the instance, asked for exactly the people this
    // business named, as the list of tasks does.
    const accounts = await accountsOf(this.database, [...people], identity.userId)
    const person = (userId: string | null): Person | null =>
      userId === null ? null : { userId, name: accounts.get(userId)?.name ?? 'Unbekanntes Konto' }

    return rows.map(({ deadline, customer }) => {
      const kind = deadlineKinds.kind(deadline.kind)
      const setting = kind ? (settings.get(kind.key) ?? null) : null
      const lead = kind ? leadOf(kind, setting, deadline.leadDays) : (deadline.leadDays ?? 0)

      return {
        id: deadline.id,
        kind: deadline.kind,
        kindTitle: kind?.title ?? deadline.kind,
        trade: kind?.trade ?? null,
        status: deadline.status,
        anchorOn: deadline.anchorOn as IsoDate,
        dueOn: deadline.dueOn as IsoDate,
        remindOn: remindOn(deadline.dueOn as IsoDate, lead),
        leadDays: lead,
        ownLeadDays: deadline.leadDays,
        responsible: person(responsibles.get(deadline.id) ?? null),
        ownResponsibleUserId: deadline.responsibleUserId,
        source: {
          label: deadline.sourceLabel,
          documentId: deadline.documentId,
          installationId: deadline.installationId,
        },
        customer:
          deadline.customerId !== null && customer !== null
            ? { id: deadline.customerId, name: customer }
            : null,
        siteId: deadline.siteId,
        jobId: deadline.jobId,
        remindedFor: deadline.remindedFor as IsoDate | null,
        remindedAt: deadline.remindedAt,
        taskId: deadline.taskId,
        closedAt: deadline.closedAt,
        closedBy: person(deadline.closedBy),
      }
    })
  }

  /** The kinds this instance knows, with what the business has set, for the filter of the list. */
  @Get('kinds')
  @RequiresPermission('deadline.read')
  async kinds(@CurrentIdentity() identity: RequestIdentity): Promise<DeadlineKindEntry[]> {
    return kindEntries(await this.database.forTenant(identity, (tx) => settingsOf(tx)))
  }

  /**
   * A lead or a person of its own, or back to the kind's with null. A new
   * person takes over the task the reminder made, if it is still open.
   */
  @Patch(':id')
  @RequiresPermission('deadline.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ readonly id: DeadlineId }> {
    const fields = (body ?? {}) as Record<string, unknown>
    const changes: { leadDays?: number | null; responsibleUserId?: string | null } = {}

    if ('leadDays' in fields) {
      changes.leadDays = daysOrNull(fields['leadDays'], leadProblem, 'Der Vorlauf')
    }

    if (!('leadDays' in fields) && !('responsibleUserId' in fields)) {
      throw new BadRequestException('Es fehlt, was geändert werden soll: Vorlauf oder Person.')
    }

    return this.database.forTenant(identity, async (tx) => {
      if ('responsibleUserId' in fields) {
        changes.responsibleUserId = await requireColleague(
          tx,
          identity.tenantId,
          fields['responsibleUserId'],
        )
      }

      const [updated] = await tx
        .update(deadlines)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(deadlines.id, id as DeadlineId))
        .returning()

      if (!updated) {
        throw new NotFoundException()
      }

      if ('responsibleUserId' in changes) {
        await handTaskOn(tx, identity.tenantId, updated)
      }

      return { id: updated.id }
    })
  }

  /** Done, by whoever says so; the task its reminder made is done with it. */
  @Post(':id/done')
  @RequiresPermission('deadline.write')
  async done(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<{ readonly id: DeadlineId }> {
    return this.database.forTenant(identity, async (tx) => {
      const now = new Date()
      const [updated] = await tx
        .update(deadlines)
        .set({ status: 'done', closedAt: now, closedBy: identity.userId, updatedAt: now })
        .where(and(eq(deadlines.id, id as DeadlineId), eq(deadlines.status, 'open')))
        .returning()

      if (!updated) {
        await refuseClosed(tx, id, 'Diese Frist ist nicht mehr offen.')
      } else if (updated.taskId !== null && updated.remindedFor === updated.dueOn) {
        await tx
          .update(tasks)
          .set({ status: 'done' })
          .where(and(eq(tasks.id, updated.taskId), eq(tasks.status, 'open')))
      }

      return { id: id as DeadlineId }
    })
  }

  /**
   * Open again, for one marked done by mistake. A deadline that dropped out
   * comes back by itself when its source asks again, so only a done one
   * reopens here.
   *
   * The task its reminder made opens with it, as it was done with it. Left
   * done, the next pass of the engine would find the task done and close the
   * deadline again within the minute, which is what the engine does for a
   * task somebody finishes in the list of tasks.
   */
  @Post(':id/reopen')
  @RequiresPermission('deadline.write')
  async reopen(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<{ readonly id: DeadlineId }> {
    return this.database.forTenant(identity, async (tx) => {
      const [updated] = await tx
        .update(deadlines)
        .set({ status: 'open', closedAt: null, closedBy: null, updatedAt: new Date() })
        .where(and(eq(deadlines.id, id as DeadlineId), eq(deadlines.status, 'done')))
        .returning()

      if (!updated) {
        await refuseClosed(
          tx,
          id,
          'Nur eine erledigte Frist lässt sich wieder öffnen. Eine entfallene kommt von selbst zurück, sobald ihre Quelle sie wieder verlangt.',
        )
      } else if (updated.taskId !== null && updated.remindedFor === updated.dueOn) {
        await tx
          .update(tasks)
          .set({ status: 'open' })
          .where(and(eq(tasks.id, updated.taskId), eq(tasks.status, 'done')))
      }

      return { id: id as DeadlineId }
    })
  }
}

/** Not found when there is no such deadline in this business, a conflict when it is there in another state. */
async function refuseClosed(tx: TenantTransaction, id: string, message: string): Promise<never> {
  const [exists] = await tx
    .select({ id: deadlines.id })
    .from(deadlines)
    .where(eq(deadlines.id, id as DeadlineId))

  if (!exists) {
    throw new NotFoundException()
  }

  throw new ConflictException(message)
}

/**
 * Hands the open task of a deadline to whoever answers for it now. Only the
 * task of the current due day: an older one was for an older day.
 */
async function handTaskOn(
  tx: TenantTransaction,
  tenantId: TenantId,
  deadline: DeadlineRow,
): Promise<void> {
  if (deadline.taskId === null || deadline.remindedFor !== deadline.dueOn) {
    return
  }

  const kind = deadlineKinds.kind(deadline.kind)

  if (!kind) {
    return
  }

  const setting = (await settingsOf(tx)).get(kind.key) ?? null
  const responsible = await responsibleFor(tx, tenantId, kind, setting, deadline)

  if (responsible !== null) {
    await tx
      .update(tasks)
      .set({ assigneeUserId: responsible })
      .where(and(eq(tasks.id, deadline.taskId), eq(tasks.status, 'open')))
  }
}

/**
 * What the business sets for each kind of deadline, under "Einstellungen",
 * "Fristen": the lead, the interval where the kind has one, and who answers
 * for it. Null is the kind's own value.
 */
@Controller('settings/deadlines')
export class DeadlineSettingsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  async list(@CurrentIdentity() identity: RequestIdentity): Promise<DeadlineKindEntry[]> {
    return kindEntries(await this.database.forTenant(identity, (tx) => settingsOf(tx)))
  }

  @Put(':kind')
  @RequiresPermission('settings.write')
  async set(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('kind') key: string,
    @Body() body: unknown,
  ): Promise<DeadlineKindEntry> {
    const kind = deadlineKinds.kind(key)

    if (!kind) {
      throw new NotFoundException()
    }

    const fields = (body ?? {}) as Record<string, unknown>
    const leadDays = daysOrNull(fields['leadDays'] ?? null, leadProblem, 'Der Vorlauf')
    const intervalDays = daysOrNull(fields['intervalDays'] ?? null, intervalProblem, 'Die Frist')

    if (intervalDays !== null && kind.intervalDays === null) {
      throw new BadRequestException(
        'Bei dieser Art nennt die Quelle den Tag, eine eigene Frist gibt es nicht.',
      )
    }

    return this.database.forTenant(identity, async (tx) => {
      const responsibleUserId = await requireColleague(
        tx,
        identity.tenantId,
        fields['responsibleUserId'] ?? null,
      )
      const now = new Date()

      await tx
        .insert(deadlineSettings)
        .values({
          tenantId: identity.tenantId,
          kind: kind.key,
          leadDays,
          intervalDays,
          responsibleUserId,
        })
        .onConflictDoUpdate({
          target: [deadlineSettings.tenantId, deadlineSettings.kind],
          set: { leadDays, intervalDays, responsibleUserId, updatedAt: now },
        })

      const entry = kindEntries(await settingsOf(tx)).find(
        (candidate) => candidate.key === kind.key,
      )

      if (!entry) {
        throw new Error(`The kind ${kind.key} did not come back`)
      }

      return entry
    })
  }
}
