import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  type Provider,
  Put,
  Query,
  type Type,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  berlinClock,
  type DeadlineKind,
  type DeadlineRegistry,
  type DeadlineSetting,
  type DeadlineStatus,
  deadlineStatuses,
  intervalMonthsProblem,
  intervalProblem,
  type IsoDate,
  leadOf,
  leadProblem,
  remindOn,
  type TenantId,
} from '@opengewerk/platform-domain'
import { and, asc, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm'

import { RequiresPermission } from '../api/authorization.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { accountsOf } from '../authentication/administration.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { deadlineSettings } from '../database/schema/deadline-settings.js'
import type { DeadlinesTable, OwnDeadlineColumns } from '../database/schema/deadlines.js'
import { memberships } from '../database/schema/memberships.js'
import { tenants } from '../database/schema/tenants.js'
import type { KeptDeadline } from './engine.js'
import { responsibleForAll } from './responsible.js'
import { deadlineRunOf } from './runs.js'
import { deadlineSettingsOf } from './settings.js'

/** The rules of the application, under which a module hands them in. */
export const DEADLINE_RULES = Symbol('DeadlineRules')

/** One person as a list of deadlines names them. */
export interface DeadlinePerson {
  readonly userId: string
  readonly name: string
}

/**
 * One deadline as a list reads it: what every deadline says. An application
 * adds what its own deadlines hang on (`describe`), beside this, or in place
 * of `source` when it says more about the source.
 */
export interface DeadlineEntry {
  readonly id: string
  readonly kind: string
  readonly kindTitle: string
  readonly status: DeadlineStatus
  readonly anchorOn: IsoDate
  readonly dueOn: IsoDate
  /** The day it reminds, from the lead that applies. */
  readonly remindOn: IsoDate
  /** The lead that applies, and the one the deadline has of its own. */
  readonly leadDays: number
  readonly ownLeadDays: number | null
  /** Who answers for it now, and the person it has of its own. */
  readonly responsible: DeadlinePerson | null
  readonly ownResponsibleUserId: string | null
  readonly source: { readonly label: string }
  readonly remindedFor: IsoDate | null
  readonly remindedAt: Date | null
  readonly closedAt: Date | null
  readonly closedBy: DeadlinePerson | null
}

/** A kind with what the tenant has set for it, for the settings and the filter of the list. */
export interface DeadlineKindEntry {
  readonly key: string
  readonly title: string
  readonly about: string
  readonly source: string
  readonly actions: readonly string[]
  readonly responsible: DeadlineKind['responsible']
  readonly intervalDays: number | null
  readonly intervalMonths: number | null
  readonly leadDays: number
  readonly setting: {
    readonly intervalDays: number | null
    readonly intervalMonths: number | null
    readonly leadDays: number | null
    readonly responsibleUserId: string | null
  }
}

/** How the engine last went through the deadlines of a tenant, for the office. */
export interface DeadlineRunEntry {
  readonly succeededAt: Date | null
  readonly failedAt: Date | null
  /**
   * Whether the office should be told: the last pass failed, or none went
   * through for longer than ten passes take to come round.
   */
  readonly behind: boolean
}

/** How long without a pass that went through counts as behind: ten passes of a minute. */
export const deadlineRunBehindMs = 10 * 60_000

/**
 * One page of the list of deadlines (opengewerk-haustechnik#104): a tenant
 * has a few thousand open from its first day, so the list is narrowed and
 * paged on the server.
 */
export interface DeadlinePage<Entry = DeadlineEntry> {
  readonly rows: readonly Entry[]
  /**
   * How many deadlines the question finds, or null when it is narrowed to
   * one person: the list names no number for a person, how many deadlines
   * somebody has or how many of them are late (opengewerk-haustechnik#104).
   */
  readonly total: number | null
  /** Whether a further page follows. */
  readonly more: boolean
}

/** How many deadlines a page holds when the question does not say, and at most. */
export const deadlinePageSize = 50
export const deadlinePageMost = 200

/** The names in the address of the list that are the foundation's, and no filter of an application. */
export const deadlineQuestionNames = [
  'status',
  'kind',
  'person',
  'search',
  'late',
  'offset',
  'limit',
] as const

/** What the list is asked: a state, what it is narrowed by and which page. */
interface DeadlineQuestion {
  readonly status: DeadlineStatus | 'all'
  readonly kind: string | null
  readonly person: string | null
  readonly search: string | null
  /** Only the deadlines past their day, by the calendar in Germany: the late ones the office counts. */
  readonly late: boolean
  readonly narrowedBy: readonly SQL[]
  readonly offset: number
  readonly limit: number
}

/** A value of the address as one string, or null when it is not there or empty. */
function oneValue(value: unknown, name: string): string | null {
  if (value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`Der Wert „${name}“ steht mehr als einmal in der Anfrage.`)
  }

  return value
}

/** A whole number of the address within its bounds, or the one given when it is not there. */
function wholeNumber(value: unknown, name: string, least: number, most: number, otherwise: number) {
  const said = oneValue(value, name)

  if (said === null) {
    return otherwise
  }

  const number = /^\d+$/.test(said) ? Number(said) : Number.NaN

  if (!Number.isSafeInteger(number) || number < least || number > most) {
    throw new BadRequestException(
      `„${name}“ ist eine ganze Zahl von ${least.toLocaleString('de-DE')} bis ${most.toLocaleString('de-DE')}.`,
    )
  }

  return number
}

/** The search as a pattern for ILIKE: what it says anywhere in the text, taken literally. */
function containing(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/** Reads what the list is asked, and refuses what it cannot read. */
function deadlineQuestionOf(query: Readonly<Record<string, unknown>>, rules: AnyRules) {
  const narrowedBy: SQL[] = []

  for (const [name, condition] of Object.entries(rules.filters ?? {})) {
    const value = oneValue(query[name], name)

    if (value !== null) {
      const where = condition(value)

      if (where === null) {
        throw new BadRequestException(`Diesen Wert kennt der Filter „${name}“ nicht: ${value}`)
      }

      narrowedBy.push(where)
    }
  }

  const search = oneValue(query['search'], 'search')?.trim() ?? ''
  const late = oneValue(query['late'], 'late')

  if (late !== null && late !== 'true') {
    throw new BadRequestException('„late“ steht für die überfälligen Fristen und heißt „true“.')
  }

  return {
    status: asStatus(query['status']),
    kind: oneValue(query['kind'], 'kind'),
    person: oneValue(query['person'], 'person'),
    search: search === '' ? null : search,
    late: late === 'true',
    narrowedBy,
    offset: wholeNumber(query['offset'], 'offset', 0, Number.MAX_SAFE_INTEGER, 0),
    limit: wholeNumber(query['limit'], 'limit', 1, deadlinePageMost, deadlinePageSize),
  } satisfies DeadlineQuestion
}

/** What an application says about its deadlines, for the routes. */
export interface DeadlineRules<
  Kind extends DeadlineKind = DeadlineKind,
  Own extends OwnDeadlineColumns = Record<never, never>,
  Row = DeadlinesTable<Own>['$inferSelect'],
> {
  readonly table: DeadlinesTable<Own>
  readonly registry: DeadlineRegistry<Kind>
  /**
   * What an entry says beside what every one says, for the rows of one list:
   * asked once, with all of them, so that the application reads what it adds
   * in one query and not one per row.
   */
  readonly describe?: (
    tx: TenantTransaction,
    rows: readonly Row[],
  ) => Promise<(row: Row) => Readonly<Record<string, unknown>>>
  /**
   * What else the search looks in, beside the name of the source and the
   * title of the kind: the name of the record a deadline hangs on, for one.
   * Handed the pattern ready for ILIKE, it gives a condition on a row of the
   * table, which may ask a table of the application.
   */
  readonly searchIn?: (pattern: string) => SQL
  /**
   * The filters of the application beside state, kind and person, by their
   * name in the address of the list: the place a deadline hangs on, for
   * one. Each gives the condition for a value, or null for a value it cannot
   * read, which the route refuses.
   */
  readonly filters?: Readonly<Record<string, (value: string) => SQL | null>>
  /** What a kind says beside what every one says: the package it comes from, for one. */
  readonly kindFields?: (kind: Kind) => Readonly<Record<string, unknown>>
  /** What follows a new person for a deadline: a task it made changes hands. */
  readonly afterResponsible?: (tx: TenantTransaction, tenantId: TenantId, row: Row) => Promise<void>
  /** What follows a deadline marked done: a task it made is done with it. */
  readonly afterDone?: (tx: TenantTransaction, row: Row) => Promise<void>
  /** What follows a deadline opened again: a task it made opens with it. */
  readonly afterReopen?: (tx: TenantTransaction, row: Row) => Promise<void>
  /** The sentences that name a tenant. */
  readonly sentences: {
    /** For a person who does not work for the tenant or is blocked. */
    readonly notAColleague: string
  }
}

/**
 * The rules as the controllers read them, whatever the kinds and columns of
 * the application: a row is read back from the table the application handed
 * in, so it is one of the application's rows.
 */
type AnyRules = DeadlineRules<DeadlineKind, OwnDeadlineColumns, KeptDeadline>

/** The key of a deadline as the table types it. */
type DeadlineRowId = DeadlinesTable['$inferSelect']['id']

function asStatus(value: unknown): DeadlineStatus | 'all' {
  if (value === undefined || value === '') {
    return 'open'
  }

  if (value === 'all' || (deadlineStatuses as readonly unknown[]).includes(value)) {
    return value as DeadlineStatus | 'all'
  }

  throw new BadRequestException(`Unbekannter Stand einer Frist: ${String(value)}`)
}

/** A whole number, or null for "the kind's own"; anything else is refused with the sentence of the form. */
function numberOrNull(
  value: unknown,
  problem: (count: number) => string | null,
  refusal: string,
): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number') {
    throw new BadRequestException(refusal)
  }

  const found = problem(value)

  if (found !== null) {
    throw new BadRequestException(found)
  }

  return value
}

/**
 * Refuses a person who does not work for this tenant or is blocked: a
 * deadline for somebody who cannot sign in waits with nobody.
 */
async function requireColleague(
  tx: TenantTransaction,
  tenantId: TenantId,
  value: unknown,
  refusal: string,
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
    throw new UnprocessableEntityException(refusal)
  }

  return value
}

function kindEntries(
  rules: AnyRules,
  settings: ReadonlyMap<string, DeadlineSetting>,
): DeadlineKindEntry[] {
  return rules.registry.kinds.map((kind) => {
    const setting = settings.get(kind.key)

    return {
      ...(rules.kindFields?.(kind) ?? {}),
      key: kind.key,
      title: kind.title,
      about: kind.about,
      source: kind.source,
      actions: kind.actions,
      responsible: kind.responsible,
      intervalDays: kind.intervalDays,
      intervalMonths: kind.intervalMonths ?? null,
      leadDays: kind.leadDays,
      setting: {
        intervalDays: setting?.intervalDays ?? null,
        intervalMonths: setting?.intervalMonths ?? null,
        leadDays: setting?.leadDays ?? null,
        responsibleUserId: setting?.responsibleUserId ?? null,
      },
    }
  })
}

/** Not found when there is no such deadline for this tenant, a conflict when it is there in another state. */
async function refuseClosed(
  tx: TenantTransaction,
  table: DeadlinesTable,
  id: string,
  message: string,
): Promise<never> {
  const [exists] = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id as DeadlineRowId))

  if (!exists) {
    throw new NotFoundException()
  }

  throw new ConflictException(message)
}

/** The rights of the deadline routes, the application's. */
export interface DeadlineRights<Right extends string> {
  /** The list, the kinds and how the engine last went through it. */
  readonly read: Right
  /** Done or not, a lead or a person of its own. */
  readonly write: Right
  /** What the tenant set for each kind. */
  readonly settingsRead: Right
  readonly settingsWrite: Right
}

/**
 * The deadlines of a tenant, for the list of deadlines
 * (opengewerk-haustechnik#24).
 *
 * Nobody creates one here: the engine follows the sources and writes them.
 * What a person decides is done or not, a lead of its own and a person of its
 * own; everything else a deadline says comes from its source and changes
 * there.
 *
 * Made by a function because the rights are the application's.
 */
function deadlinesController(
  rights: Pick<DeadlineRights<string>, 'read' | 'write'>,
): Type<unknown> {
  @Controller('deadlines')
  class DeadlinesController {
    constructor(
      readonly database: Database,
      @Inject(DEADLINE_RULES) readonly rules: AnyRules,
    ) {}

    /** The deadlines of the application, as every table of deadlines has them. */
    private deadlines(): DeadlinesTable {
      return this.rules.table as unknown as DeadlinesTable
    }

    /**
     * One page of the deadlines, narrowed on the server
     * (opengewerk-haustechnik#104): by state, kind, person, the search and
     * the filters of the application, in the order of their day.
     *
     * Who answers for a deadline is worked out and not kept (the settings
     * can name somebody else tomorrow), so a question for one person reads
     * every deadline the rest of it finds, works out who answers for each,
     * and pages through those of the person; it says whether more follow
     * and never how many there are.
     */
    @Get()
    @RequiresPermission(rights.read)
    async list(
      @CurrentIdentity() identity: RequestIdentity,
      @Query() query: Readonly<Record<string, unknown>>,
    ): Promise<DeadlinePage> {
      const question = deadlineQuestionOf(query, this.rules)
      const table = this.deadlines()
      const where = and(
        question.status === 'all' ? undefined : eq(table.status, question.status),
        question.kind === null ? undefined : eq(table.kind, question.kind),
        question.search === null ? undefined : this.searching(question.search),
        question.late ? lt(table.dueOn, berlinClock(new Date()).day) : undefined,
        ...question.narrowedBy,
      )
      const order = [asc(table.dueOn), asc(table.sourceLabel), asc(table.id)]

      const { rows, total, more, settings, responsibles, describe } = await this.database.forTenant(
        identity,
        async (tx) => {
          const settings = await deadlineSettingsOf(tx)
          // Asked for all of them together: one deadline at a time went to
          // the database up to four times a row. A deadline of a kind this
          // instance no longer knows has nobody.
          const responsiblesOf = (rows: readonly KeptDeadline[]) =>
            responsibleForAll(
              tx,
              identity.tenantId,
              rows.flatMap((row) => {
                const kind = this.rules.registry.kind(row.kind)

                return kind
                  ? [{ key: row.id, kind, setting: settings.get(kind.key) ?? null, deadline: row }]
                  : []
              }),
            )
          let rows: KeptDeadline[]
          let total: number | null = null
          let more: boolean
          let responsibles: Map<string, string | null>

          if (question.person === null) {
            const found = (await tx
              .select()
              .from(table)
              .where(where)
              .orderBy(...order)
              .offset(question.offset)
              .limit(question.limit + 1)) as KeptDeadline[]
            const [counted] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(table)
              .where(where)

            rows = found.slice(0, question.limit)
            more = found.length > question.limit
            total = counted?.count ?? 0
            responsibles = await responsiblesOf(rows)
          } else {
            const found = (await tx
              .select()
              .from(table)
              .where(where)
              .orderBy(...order)) as KeptDeadline[]
            const everybody = await responsiblesOf(found)
            const theirs = found.filter((row) => everybody.get(row.id) === question.person)

            rows = theirs.slice(question.offset, question.offset + question.limit)
            more = theirs.length > question.offset + question.limit
            responsibles = everybody
          }

          const describe = this.rules.describe ? await this.rules.describe(tx, rows) : () => ({})

          return { rows, total, more, settings, responsibles, describe }
        },
      )

      const people = new Set<string>()

      for (const row of rows) {
        const responsible = responsibles.get(row.id)

        if (responsible) {
          people.add(responsible)
        }

        if (row.closedBy) {
          people.add(row.closedBy)
        }
      }

      // The names come from the instance, asked for exactly the people this
      // tenant named.
      const accounts = await accountsOf(this.database, [...people], identity.userId)
      const person = (userId: string | null): DeadlinePerson | null =>
        userId === null ? null : { userId, name: accounts.get(userId)?.name ?? 'Unbekanntes Konto' }

      const entries = rows.map((row): DeadlineEntry => {
        const kind = this.rules.registry.kind(row.kind)
        const setting = kind ? (settings.get(kind.key) ?? null) : null
        const lead = kind ? leadOf(kind, setting, row.leadDays) : (row.leadDays ?? 0)

        return {
          id: row.id,
          kind: row.kind,
          kindTitle: kind?.title ?? row.kind,
          status: row.status,
          anchorOn: row.anchorOn as IsoDate,
          dueOn: row.dueOn as IsoDate,
          remindOn: remindOn(row.dueOn as IsoDate, lead),
          leadDays: lead,
          ownLeadDays: row.leadDays,
          responsible: person(responsibles.get(row.id) ?? null),
          ownResponsibleUserId: row.responsibleUserId,
          source: { label: row.sourceLabel },
          remindedFor: row.remindedFor as IsoDate | null,
          remindedAt: row.remindedAt,
          closedAt: row.closedAt,
          closedBy: person(row.closedBy),
          ...describe(row),
        }
      })

      return { rows: entries, total, more }
    }

    /**
     * Where the search looks: the name of the source, the title of the kind
     * and whatever the application adds. The titles are this instance's and
     * not in the table, so they are looked through here and asked for by
     * their keys.
     */
    private searching(search: string): SQL | undefined {
      const table = this.deadlines()
      const pattern = containing(search)
      const wanted = search.toLocaleLowerCase('de')
      const kinds = this.rules.registry.kinds
        .filter((kind) => kind.title.toLocaleLowerCase('de').includes(wanted))
        .map((kind) => kind.key)

      return or(
        ilike(table.sourceLabel, pattern),
        kinds.length === 0 ? undefined : inArray(table.kind, kinds),
        this.rules.searchIn?.(pattern),
      )
    }

    /** The kinds this instance knows, with what the tenant has set, for the filter of the list. */
    @Get('kinds')
    @RequiresPermission(rights.read)
    async kinds(@CurrentIdentity() identity: RequestIdentity): Promise<DeadlineKindEntry[]> {
      return kindEntries(
        this.rules,
        await this.database.forTenant(identity, (tx) => deadlineSettingsOf(tx)),
      )
    }

    /**
     * How the engine last went through the deadlines of this tenant, and
     * whether that is too long ago: a reminder that never came looks exactly
     * like one that was not due, so a pass that did not happen is said where
     * people work. A tenant without any pass counts from the day it came into
     * being.
     */
    @Get('run')
    @RequiresPermission(rights.read)
    async run(@CurrentIdentity() identity: RequestIdentity): Promise<DeadlineRunEntry> {
      return this.database.forTenant(identity, async (tx) => {
        const run = await deadlineRunOf(tx)
        const [tenant] = await tx.select({ createdAt: tenants.createdAt }).from(tenants)
        const since = run.succeededAt ?? tenant?.createdAt ?? null
        const failedLast =
          run.failedAt !== null && (run.succeededAt === null || run.failedAt > run.succeededAt)

        return {
          ...run,
          behind:
            failedLast || (since !== null && Date.now() - since.getTime() > deadlineRunBehindMs),
        }
      })
    }

    /**
     * A lead or a person of its own, or back to the kind's with null. What
     * follows a new person is the application's (`afterResponsible`).
     */
    @Patch(':id')
    @RequiresPermission(rights.write)
    async update(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ): Promise<{ readonly id: string }> {
      const fields = (body ?? {}) as Record<string, unknown>
      const changes: { leadDays?: number | null; responsibleUserId?: string | null } = {}
      const table = this.deadlines()

      if ('leadDays' in fields) {
        changes.leadDays = numberOrNull(
          fields['leadDays'],
          leadProblem,
          'Der Vorlauf ist eine Zahl von Tagen oder leer.',
        )
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
            this.rules.sentences.notAColleague,
          )
        }

        const [updated] = (await tx
          .update(table)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(table.id, id as DeadlineRowId))
          .returning()) as KeptDeadline[]

        if (!updated) {
          throw new NotFoundException()
        }

        if ('responsibleUserId' in changes) {
          await this.rules.afterResponsible?.(tx, identity.tenantId, updated)
        }

        return { id: updated.id }
      })
    }

    /** Done, by whoever says so; what follows is the application's (`afterDone`). */
    @Post(':id/done')
    @RequiresPermission(rights.write)
    async done(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
    ): Promise<{ readonly id: string }> {
      const table = this.deadlines()

      return this.database.forTenant(identity, async (tx) => {
        const now = new Date()
        const [updated] = (await tx
          .update(table)
          .set({ status: 'done', closedAt: now, closedBy: identity.userId, updatedAt: now })
          .where(and(eq(table.id, id as DeadlineRowId), eq(table.status, 'open')))
          .returning()) as KeptDeadline[]

        if (!updated) {
          await refuseClosed(tx, table, id, 'Diese Frist ist nicht mehr offen.')
        } else {
          await this.rules.afterDone?.(tx, updated)
        }

        return { id }
      })
    }

    /**
     * Open again, for one marked done by mistake. A deadline that dropped
     * out comes back by itself when its source asks again, so only a done one
     * reopens here.
     */
    @Post(':id/reopen')
    @RequiresPermission(rights.write)
    async reopen(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
    ): Promise<{ readonly id: string }> {
      const table = this.deadlines()

      return this.database.forTenant(identity, async (tx) => {
        const [updated] = (await tx
          .update(table)
          .set({ status: 'open', closedAt: null, closedBy: null, updatedAt: new Date() })
          .where(and(eq(table.id, id as DeadlineRowId), eq(table.status, 'done')))
          .returning()) as KeptDeadline[]

        if (!updated) {
          await refuseClosed(
            tx,
            table,
            id,
            'Nur eine erledigte Frist lässt sich wieder öffnen. Eine entfallene kommt von selbst zurück, sobald ihre Quelle sie wieder verlangt.',
          )
        } else {
          await this.rules.afterReopen?.(tx, updated)
        }

        return { id }
      })
    }
  }

  return DeadlinesController
}

/**
 * What a tenant sets for each kind of deadline: the lead, the interval where
 * the kind has one, in the unit the kind counts in, and who answers for it.
 * Null is the kind's own value.
 */
function deadlineSettingsController(
  rights: Pick<DeadlineRights<string>, 'settingsRead' | 'settingsWrite'>,
): Type<unknown> {
  @Controller('settings/deadlines')
  class DeadlineSettingsController {
    constructor(
      readonly database: Database,
      @Inject(DEADLINE_RULES) readonly rules: AnyRules,
    ) {}

    @Get()
    @RequiresPermission(rights.settingsRead)
    async list(@CurrentIdentity() identity: RequestIdentity): Promise<DeadlineKindEntry[]> {
      return kindEntries(
        this.rules,
        await this.database.forTenant(identity, (tx) => deadlineSettingsOf(tx)),
      )
    }

    @Put(':kind')
    @RequiresPermission(rights.settingsWrite)
    async set(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('kind') key: string,
      @Body() body: unknown,
    ): Promise<DeadlineKindEntry> {
      const kind = this.rules.registry.kind(key)

      if (!kind) {
        throw new NotFoundException()
      }

      const fields = (body ?? {}) as Record<string, unknown>
      const leadDays = numberOrNull(
        fields['leadDays'] ?? null,
        leadProblem,
        'Der Vorlauf ist eine Zahl von Tagen oder leer.',
      )
      const intervalDays = numberOrNull(
        fields['intervalDays'] ?? null,
        intervalProblem,
        'Die Frist ist eine Zahl von Tagen oder leer.',
      )
      const intervalMonths = numberOrNull(
        fields['intervalMonths'] ?? null,
        intervalMonthsProblem,
        'Die Frist ist eine Zahl von Monaten oder leer.',
      )
      const kindMonths = kind.intervalMonths ?? null

      if (intervalDays !== null && kind.intervalDays === null) {
        throw new BadRequestException(
          kindMonths !== null
            ? 'Diese Art zählt ihre Frist in Monaten.'
            : 'Bei dieser Art nennt die Quelle den Tag, eine eigene Frist gibt es nicht.',
        )
      }

      if (intervalMonths !== null && kindMonths === null) {
        throw new BadRequestException(
          kind.intervalDays !== null
            ? 'Diese Art zählt ihre Frist in Tagen.'
            : 'Bei dieser Art nennt die Quelle den Tag, eine eigene Frist gibt es nicht.',
        )
      }

      return this.database.forTenant(identity, async (tx) => {
        const responsibleUserId = await requireColleague(
          tx,
          identity.tenantId,
          fields['responsibleUserId'] ?? null,
          this.rules.sentences.notAColleague,
        )
        const now = new Date()

        await tx
          .insert(deadlineSettings)
          .values({
            tenantId: identity.tenantId,
            kind: kind.key,
            leadDays,
            intervalDays,
            intervalMonths,
            responsibleUserId,
          })
          .onConflictDoUpdate({
            target: [deadlineSettings.tenantId, deadlineSettings.kind],
            set: { leadDays, intervalDays, intervalMonths, responsibleUserId, updatedAt: now },
          })

        const entry = kindEntries(this.rules, await deadlineSettingsOf(tx)).find(
          (candidate) => candidate.key === kind.key,
        )

        if (!entry) {
          throw new Error(`The kind ${kind.key} did not come back`)
        }

        return entry
      })
    }
  }

  return DeadlineSettingsController
}

/** What an application hands in for its deadline routes. */
export interface DeadlineParts<
  Right extends string,
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns,
> {
  readonly access: AccessRules<Right>
  readonly rights: DeadlineRights<Right>
  readonly rules: DeadlineRules<Kind, Own>
}

/**
 * The routes of the deadlines, `/deadlines` and `/settings/deadlines`, with
 * the rights and rules of the application. A catalogue without one of the
 * rights refuses them here, before any route is registered.
 */
export function deadlineParts<
  Right extends string,
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns,
>(
  parts: DeadlineParts<Right, Kind, Own>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  const { read, write, settingsRead, settingsWrite } = parts.rights

  for (const right of [read, write, settingsRead, settingsWrite]) {
    if (!parts.access.catalogue.isRight(right)) {
      throw new Error(`The catalogue lacks a right of the deadlines: ${right}`)
    }
  }

  for (const name of Object.keys(parts.rules.filters ?? {})) {
    if ((deadlineQuestionNames as readonly string[]).includes(name)) {
      throw new Error(`A filter of the application takes a name of the list: ${name}`)
    }
  }

  return {
    controllers: [
      deadlinesController({ read, write }),
      deadlineSettingsController({ settingsRead, settingsWrite }),
    ],
    providers: [{ provide: DEADLINE_RULES, useValue: parts.rules as unknown as AnyRules }],
  }
}
