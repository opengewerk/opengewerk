import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  type Provider,
  type Type,
} from '@nestjs/common'
import {
  berlinClock,
  type IsoDate,
  type PersonId,
  personProblems,
  personStanding,
  type QualificationId,
  type QualificationKind,
  type QualificationKindId,
  qualificationKindProblems,
  qualificationProblems,
  qualificationStanding,
  weekdayMinutes,
  weekdays,
  weekMinutes,
  type WorkingTimeId,
  workingTimeHasBegun,
  workingTimeOn,
  workingTimeProblems,
} from '@opengewerk/platform-domain'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { RequiresMembership, RequiresPermission } from '../api/authorization.js'
import { pick, requireSomething } from '../api/body.js'
import { isUniqueViolation } from '../api/database-errors.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { accountsOf } from '../authentication/administration.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { memberships } from '../database/schema/memberships.js'
import type { PeopleTables } from '../database/schema/people.js'
import type { qualificationSchema } from '../database/schema/qualifications.js'

export const PEOPLE_ROUTES = Symbol('PeopleRoutes')

const noPerson = 'Diese Akte gibt es nicht oder nicht mehr.'
const noTime = 'Diese Arbeitszeit gibt es nicht oder nicht mehr.'
const noQualification = 'Diese Qualifikation gibt es nicht oder nicht mehr.'
const noKind = 'Diese Art gibt es nicht oder nicht mehr.'
const accountTaken = 'Dieser Zugang gehört schon zu einer Akte.'
const sameDay = 'Ab diesem Tag gibt es schon eine Arbeitszeit.'
const hasBegun =
  'Diese Arbeitszeit gilt schon und bleibt, wie sie ist. Eine Änderung ist eine neue Arbeitszeit ab einem späteren Tag.'
const notBefore = 'Eine Arbeitszeit gilt ab heute oder später.'
const kindHeld = 'Diese Art hält noch jemand. Erst die Qualifikationen ändern.'

/** The tables of the people and their qualifications, as an application binds them. */
export type PeopleRouteTables = PeopleTables & ReturnType<typeof qualificationSchema>

export interface PeopleRoutes {
  /** The people of the application, made with `peopleSchema` and `qualificationSchema`. */
  readonly tables: PeopleRouteTables
  /** The kinds of qualification of the application's catalogue; a tenant adds its own. */
  readonly kinds: readonly QualificationKind[]
  /**
   * How many days before its last day a qualification counts as running out:
   * the lead of the application's deadline for it, as the tenant has set it.
   */
  readonly leadDays: (tx: TenantTransaction) => Promise<number>
}

export interface PeopleRights<Right extends string> {
  /** Reading the files of everybody. */
  readonly read: Right
  /** Keeping the files: people, working times, qualifications and own kinds. */
  readonly write: Right
}

function refuse(problems: Readonly<Record<string, string>>): void {
  const problem = Object.values(problems)[0]

  if (problem !== undefined) {
    throw new BadRequestException(problem)
  }
}

/** A text as a form hands it over: trimmed, and an empty one is none. */
function tidied(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}

function tidiedAll(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, tidied(value)]))
}

const today = (): IsoDate => berlinClock(new Date()).day

const personFields = ['name', 'userId', 'joinedOn', 'leftOn'] as const
const timeFields = ['validFrom', ...weekdays.map((day) => weekdayMinutes[day])] as const
const qualificationFields = ['kindKey', 'ownKindId', 'validUntil', 'note'] as const

/** A conflict the database found, in words, or the error as it was. */
function conflictOf(error: unknown): unknown {
  if (isUniqueViolation(error, 'people_one_per_account')) {
    return new ConflictException(accountTaken)
  }

  if (isUniqueViolation(error, 'working_times_one_from_a_day')) {
    return new ConflictException(sameDay)
  }

  return error
}

async function personOf(tx: TenantTransaction, tables: PeopleRouteTables, id: string) {
  const { people } = tables
  const [person] = isUuid(id)
    ? await tx
        .select()
        .from(people)
        .where(and(eq(people.id, id as PersonId), isNull(people.deletedAt)))
    : []

  if (!person) {
    throw new NotFoundException(noPerson)
  }

  return person
}

/** The roles of the people named in this tenant, by user. */
async function rolesOf(tx: TenantTransaction, userIds: readonly string[]) {
  if (userIds.length === 0) {
    return new Map<string, readonly string[]>()
  }

  const rows = await tx
    .select({ userId: memberships.userId, roles: memberships.roles })
    .from(memberships)
    .where(inArray(memberships.userId, [...userIds]))

  return new Map(rows.map((row) => [row.userId, row.roles]))
}

interface Account {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly roles: readonly string[]
}

/**
 * The accounts behind the people of a tenant, with name and address. Those
 * are read outside the tenant (`accountsOf`), for the user ids its
 * memberships named a moment before.
 */
async function accountsBehind(
  database: Database,
  identity: RequestIdentity,
  roles: ReadonlyMap<string, readonly string[]>,
): Promise<ReadonlyMap<string, Account>> {
  const accounts = await accountsOf(database, [...roles.keys()], identity.userId)

  return new Map(
    [...roles].flatMap(([userId, held]): [string, Account][] => {
      const account = accounts.get(userId)

      return account
        ? [[userId, { userId, name: account.name, email: account.email, roles: held }]]
        : []
    }),
  )
}

/** A file with its account put in, where the person has one. */
async function withAccount<
  File extends { readonly userId: string | null; readonly roles: readonly string[] | null },
>(database: Database, identity: RequestIdentity, file: File) {
  const { roles, ...rest } = file
  const accounts =
    file.userId === null || roles === null
      ? new Map<string, Account>()
      : await accountsBehind(database, identity, new Map([[file.userId, roles]]))

  return { ...rest, account: file.userId === null ? null : (accounts.get(file.userId) ?? null) }
}

/**
 * The file of a person as a screen shows it: the person, their account, the
 * working times from the latest down and the qualifications with the label
 * and level of their kind and how each stands today.
 */
async function fileOf(
  tx: TenantTransaction,
  routes: PeopleRoutes,
  person: Awaited<ReturnType<typeof personOf>>,
) {
  const { workingTimes, qualifications, qualificationKinds } = routes.tables
  const day = today()
  const lead = await routes.leadDays(tx)
  const times = await tx
    .select()
    .from(workingTimes)
    .where(and(eq(workingTimes.personId, person.id), isNull(workingTimes.deletedAt)))
    .orderBy(desc(workingTimes.validFrom))
  const held = await tx
    .select({
      qualification: qualifications,
      ownLabel: qualificationKinds.label,
      ownLevel: qualificationKinds.level,
    })
    .from(qualifications)
    .leftJoin(qualificationKinds, eq(qualificationKinds.id, qualifications.ownKindId))
    .where(and(eq(qualifications.personId, person.id), isNull(qualifications.deletedAt)))
    .orderBy(asc(qualifications.validUntil))
  const catalogue = new Map(routes.kinds.map((kind) => [kind.key, kind]))
  const roles =
    person.userId === null
      ? null
      : ((await rolesOf(tx, [person.userId])).get(person.userId) ?? null)
  const current = workingTimeOn(times, day)

  return {
    ...person,
    standing: personStanding(person, day),
    roles,
    leadDays: lead,
    workingTimes: times.map((time) => ({
      ...time,
      weekMinutes: weekMinutes(time),
      holdsToday: current?.id === time.id,
      begun: workingTimeHasBegun(time, day),
    })),
    qualifications: held.map(({ qualification, ownLabel, ownLevel }) => {
      const kind =
        qualification.kindKey === null ? null : (catalogue.get(qualification.kindKey) ?? null)

      return {
        ...qualification,
        kindLabel: kind?.label ?? ownLabel ?? qualification.kindKey,
        kindLevel: kind?.level ?? ownLevel ?? null,
        standing: qualificationStanding(qualification, day, lead),
      }
    }),
  }
}

async function requireKind(
  tx: TenantTransaction,
  routes: PeopleRoutes,
  values: Readonly<Record<string, unknown>>,
): Promise<void> {
  const { kindKey, ownKindId } = values

  if (typeof kindKey === 'string' && !routes.kinds.some((kind) => kind.key === kindKey)) {
    throw new BadRequestException(noKind)
  }

  if (typeof ownKindId === 'string') {
    const { qualificationKinds } = routes.tables
    const [found] = isUuid(ownKindId)
      ? await tx
          .select({ id: qualificationKinds.id })
          .from(qualificationKinds)
          .where(
            and(
              eq(qualificationKinds.id, ownKindId as QualificationKindId),
              isNull(qualificationKinds.deletedAt),
            ),
          )
      : []

    if (!found) {
      throw new BadRequestException(noKind)
    }
  }
}

/** The minutes of a working time as the body names them, with none for a day it leaves out. */
function timeValues(body: unknown): Record<string, unknown> {
  const values: Record<string, unknown> = { ...tidiedAll(pick(body, [...timeFields])) }

  for (const day of weekdays) {
    values[weekdayMinutes[day]] ??= 0
  }

  return values
}

/**
 * The files of the people who work for a tenant (ADR 0016, opengewerk#287):
 * listed with what runs out, kept with their working time from a day on and
 * their qualifications, and read by each person as their own. A working time
 * whose day has begun stays as it is; a change is a new one from a later
 * day. Nothing is removed: a person, a working time, a qualification and an
 * own kind are marked.
 *
 * Who may is the application's to say, with two rights; the own file needs
 * none but the membership. Made by a function because the rights are the
 * application's. Nothing but its routes is on the class.
 */
function peopleController(rights: PeopleRights<string>): Type<unknown> {
  @Controller('people')
  class PeopleController {
    constructor(
      readonly database: Database,
      @Inject(PEOPLE_ROUTES) readonly routes: PeopleRoutes,
    ) {}

    /** Everybody with a file, with their account, the hours of this week's working time and what runs out. */
    @Get()
    @RequiresPermission(rights.read)
    list(@CurrentIdentity() identity: RequestIdentity) {
      const { people, workingTimes, qualifications } = this.routes.tables

      return this.database
        .forTenant(identity, async (tx) => {
          const lead = await this.routes.leadDays(tx)
          const rows = await tx
            .select()
            .from(people)
            .where(isNull(people.deletedAt))
            .orderBy(sql`lower(${people.name})`)
          const times = await tx.select().from(workingTimes).where(isNull(workingTimes.deletedAt))
          const held = await tx
            .select({ personId: qualifications.personId, validUntil: qualifications.validUntil })
            .from(qualifications)
            .where(isNull(qualifications.deletedAt))
          const roles = await rolesOf(
            tx,
            rows.flatMap((row) => (row.userId === null ? [] : [row.userId])),
          )

          return { lead, rows, times, held, roles }
        })
        .then(async ({ lead, rows, times, held, roles }) => {
          const day = today()
          const accounts = await accountsBehind(this.database, identity, roles)

          return rows.map((person) => {
            const current = workingTimeOn(
              times.filter((time) => time.personId === person.id),
              day,
            )
            const standings = held
              .filter((each) => each.personId === person.id)
              .map((each) => qualificationStanding(each, day, lead))

            return {
              ...person,
              standing: personStanding(person, day),
              account: person.userId === null ? null : (accounts.get(person.userId) ?? null),
              weekMinutes: current === null ? null : weekMinutes(current),
              qualifications: {
                valid: standings.filter((each) => each === 'valid').length,
                expiring: standings.filter((each) => each === 'expiring').length,
                expired: standings.filter((each) => each === 'expired').length,
              },
            }
          })
        })
    }

    /** The accounts of this tenant that belong to no file yet, to choose one for a person. */
    @Get('accounts')
    @RequiresPermission(rights.write)
    accounts(@CurrentIdentity() identity: RequestIdentity) {
      const { people } = this.routes.tables

      return this.database
        .forTenant(identity, async (tx) =>
          tx
            .select({ userId: memberships.userId, roles: memberships.roles })
            .from(memberships)
            .where(
              sql`not exists (select 1 from ${people} where ${people.userId} = ${memberships.userId}
                   and ${people.deletedAt} is null)`,
            ),
        )
        .then(async (rows) => {
          const accounts = await accountsBehind(
            this.database,
            identity,
            new Map(rows.map((row) => [row.userId, row.roles])),
          )

          return [...accounts.values()].sort((one, two) => one.name.localeCompare(two.name, 'de'))
        })
    }

    /** The file of whoever asks, read only; none where they have no file here. */
    @Get('mine')
    @RequiresMembership()
    mine(@CurrentIdentity() identity: RequestIdentity) {
      const { people } = this.routes.tables

      return this.database
        .forTenant(identity, async (tx) => {
          const [person] = await tx
            .select()
            .from(people)
            .where(and(eq(people.userId, identity.userId), isNull(people.deletedAt)))

          return person ? fileOf(tx, this.routes, person) : null
        })
        .then((file) => (file === null ? null : withAccount(this.database, identity, file)))
    }

    @Get(':id')
    @RequiresPermission(rights.read)
    read(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
      return this.database
        .forTenant(identity, async (tx) =>
          fileOf(tx, this.routes, await personOf(tx, this.routes.tables, id)),
        )
        .then((file) => withAccount(this.database, identity, file))
    }

    /**
     * A new file, with the first working time where the form names one. That
     * one may begin on any day: a file brought in for somebody who works here
     * already carries the time agreed since they joined. Every later one
     * begins today at the earliest.
     */
    @Post()
    @RequiresPermission(rights.write)
    create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
      const values = tidiedAll(pick(body, [...personFields]))
      const first = (body as { workingTime?: unknown } | null)?.workingTime
      const time = first === undefined || first === null ? null : timeValues(first)

      refuse(personProblems(values))

      if (time !== null) {
        refuse(workingTimeProblems(time))
      }

      return this.database.forTenant(identity, async (tx) => {
        try {
          const { people, workingTimes } = this.routes.tables
          const [created] = await tx
            .insert(people)
            .values({ ...values, tenantId: identity.tenantId } as never)
            .returning()

          if (created && time !== null) {
            await tx
              .insert(workingTimes)
              .values({ ...time, personId: created.id, tenantId: identity.tenantId } as never)
          }

          return created
        } catch (error) {
          throw conflictOf(error)
        }
      })
    }

    @Patch(':id')
    @RequiresPermission(rights.write)
    change(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, [...personFields]))

      requireSomething(values)

      return this.database.forTenant(identity, async (tx) => {
        const current = await personOf(tx, this.routes.tables, id)

        refuse(personProblems({ ...current, ...values }))

        try {
          const { people } = this.routes.tables
          const [changed] = await tx
            .update(people)
            .set({ ...values, updatedAt: new Date() } as never)
            .where(eq(people.id, current.id))
            .returning()

          return changed
        } catch (error) {
          throw conflictOf(error)
        }
      })
    }

    /** A working time from today or a later day; the one before holds until the day before. */
    @Post(':id/working-times')
    @RequiresPermission(rights.write)
    addTime(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = timeValues(body)

      refuse(workingTimeProblems(values))

      if ((values['validFrom'] as string) < today()) {
        throw new BadRequestException(notBefore)
      }

      return this.database.forTenant(identity, async (tx) => {
        const person = await personOf(tx, this.routes.tables, id)

        try {
          const [added] = await tx
            .insert(this.routes.tables.workingTimes)
            .values({ ...values, personId: person.id, tenantId: identity.tenantId } as never)
            .returning()

          return added
        } catch (error) {
          throw conflictOf(error)
        }
      })
    }

    /** A working time whose day has not begun, changed; one that holds already stays. */
    @Patch(':id/working-times/:timeId')
    @RequiresPermission(rights.write)
    changeTime(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Param('timeId') timeId: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, [...timeFields]))

      requireSomething(values)

      return this.database.forTenant(identity, async (tx) => {
        const time = await this.timeOf(tx, id, timeId)
        const after = { ...time, ...values }

        refuse(workingTimeProblems(after))

        if (after.validFrom < today()) {
          throw new BadRequestException(notBefore)
        }

        try {
          const { workingTimes } = this.routes.tables
          const [changed] = await tx
            .update(workingTimes)
            .set({ ...values, updatedAt: new Date() } as never)
            .where(eq(workingTimes.id, time.id))
            .returning()

          return changed
        } catch (error) {
          throw conflictOf(error)
        }
      })
    }

    /** A working time whose day has not begun, taken out; one that holds already stays. */
    @Delete(':id/working-times/:timeId')
    @RequiresPermission(rights.write)
    removeTime(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Param('timeId') timeId: string,
    ) {
      return this.database.forTenant(identity, async (tx) => {
        const time = await this.timeOf(tx, id, timeId)
        const { workingTimes } = this.routes.tables

        await tx
          .update(workingTimes)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(workingTimes.id, time.id))
      })
    }

    @Post(':id/qualifications')
    @RequiresPermission(rights.write)
    addQualification(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, [...qualificationFields]))

      return this.database.forTenant(identity, async (tx) => {
        const person = await personOf(tx, this.routes.tables, id)

        refuse(qualificationProblems({ ...values, personId: person.id }))
        await requireKind(tx, this.routes, values)

        const [added] = await tx
          .insert(this.routes.tables.qualifications)
          .values({ ...values, personId: person.id, tenantId: identity.tenantId } as never)
          .returning()

        return added
      })
    }

    @Patch(':id/qualifications/:qualificationId')
    @RequiresPermission(rights.write)
    changeQualification(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Param('qualificationId') qualificationId: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, [...qualificationFields]))

      requireSomething(values)

      return this.database.forTenant(identity, async (tx) => {
        const current = await this.qualificationOf(tx, id, qualificationId)
        // Naming one kind leaves the other: a qualification is of exactly one.
        const kind =
          'kindKey' in values || 'ownKindId' in values
            ? { kindKey: values['kindKey'] ?? null, ownKindId: values['ownKindId'] ?? null }
            : {}
        const after = { ...current, ...values, ...kind }

        refuse(qualificationProblems(after))
        await requireKind(tx, this.routes, kind)

        const { qualifications } = this.routes.tables
        const [changed] = await tx
          .update(qualifications)
          .set({ ...values, ...kind, updatedAt: new Date() } as never)
          .where(eq(qualifications.id, current.id))
          .returning()

        return changed
      })
    }

    @Delete(':id/qualifications/:qualificationId')
    @RequiresPermission(rights.write)
    removeQualification(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Param('qualificationId') qualificationId: string,
    ) {
      return this.database.forTenant(identity, async (tx) => {
        const current = await this.qualificationOf(tx, id, qualificationId)
        const { qualifications } = this.routes.tables

        await tx
          .update(qualifications)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(qualifications.id, current.id))
      })
    }

    /** A working time of a person whose day has not begun. */
    async timeOf(tx: TenantTransaction, id: string, timeId: string) {
      const person = await personOf(tx, this.routes.tables, id)
      const { workingTimes } = this.routes.tables
      const [time] = isUuid(timeId)
        ? await tx
            .select()
            .from(workingTimes)
            .where(
              and(
                eq(workingTimes.id, timeId as WorkingTimeId),
                eq(workingTimes.personId, person.id),
                isNull(workingTimes.deletedAt),
              ),
            )
        : []

      if (!time) {
        throw new NotFoundException(noTime)
      }

      if (workingTimeHasBegun(time, today())) {
        throw new ConflictException(hasBegun)
      }

      return time
    }

    async qualificationOf(tx: TenantTransaction, id: string, qualificationId: string) {
      const person = await personOf(tx, this.routes.tables, id)
      const { qualifications } = this.routes.tables
      const [found] = isUuid(qualificationId)
        ? await tx
            .select()
            .from(qualifications)
            .where(
              and(
                eq(qualifications.id, qualificationId as QualificationId),
                eq(qualifications.personId, person.id),
                isNull(qualifications.deletedAt),
              ),
            )
        : []

      if (!found) {
        throw new NotFoundException(noQualification)
      }

      return found
    }
  }

  return PeopleController
}

/**
 * The kinds of qualification a tenant can choose from: those of the
 * application's catalogue and its own, which it adds, changes and takes out
 * while nobody holds one of them.
 */
function qualificationKindsController(rights: PeopleRights<string>): Type<unknown> {
  @Controller('qualification-kinds')
  class QualificationKindsController {
    constructor(
      readonly database: Database,
      @Inject(PEOPLE_ROUTES) readonly routes: PeopleRoutes,
    ) {}

    @Get()
    @RequiresPermission(rights.read)
    list(@CurrentIdentity() identity: RequestIdentity) {
      const { qualificationKinds } = this.routes.tables

      return this.database.forTenant(identity, async (tx) => ({
        catalogue: this.routes.kinds,
        own: await tx
          .select()
          .from(qualificationKinds)
          .where(isNull(qualificationKinds.deletedAt))
          .orderBy(sql`lower(${qualificationKinds.label})`),
      }))
    }

    @Post()
    @RequiresPermission(rights.write)
    create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
      const values = tidiedAll(pick(body, ['label', 'level']))

      refuse(qualificationKindProblems(values))

      return this.database.forTenant(identity, async (tx) => {
        const [created] = await tx
          .insert(this.routes.tables.qualificationKinds)
          .values({ ...values, tenantId: identity.tenantId } as never)
          .returning()

        return created
      })
    }

    @Patch(':id')
    @RequiresPermission(rights.write)
    change(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const values = tidiedAll(pick(body, ['label', 'level']))

      requireSomething(values)

      return this.database.forTenant(identity, async (tx) => {
        const current = await this.kindOf(tx, id)

        refuse(qualificationKindProblems({ ...current, ...values }))

        const { qualificationKinds } = this.routes.tables
        const [changed] = await tx
          .update(qualificationKinds)
          .set({ ...values, updatedAt: new Date() } as never)
          .where(eq(qualificationKinds.id, current.id))
          .returning()

        return changed
      })
    }

    @Delete(':id')
    @RequiresPermission(rights.write)
    remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
      return this.database.forTenant(identity, async (tx) => {
        const current = await this.kindOf(tx, id)
        const { qualifications, qualificationKinds } = this.routes.tables
        const [held] = await tx
          .select({ id: qualifications.id })
          .from(qualifications)
          .where(and(eq(qualifications.ownKindId, current.id), isNull(qualifications.deletedAt)))
          .limit(1)

        if (held) {
          throw new ConflictException(kindHeld)
        }

        await tx
          .update(qualificationKinds)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(qualificationKinds.id, current.id))
      })
    }

    async kindOf(tx: TenantTransaction, id: string) {
      const { qualificationKinds } = this.routes.tables
      const [kind] = isUuid(id)
        ? await tx
            .select()
            .from(qualificationKinds)
            .where(
              and(
                eq(qualificationKinds.id, id as QualificationKindId),
                isNull(qualificationKinds.deletedAt),
              ),
            )
        : []

      if (!kind) {
        throw new NotFoundException(noKind)
      }

      return kind
    }
  }

  return QualificationKindsController
}

/** What the routes of the people are put together from. */
export interface PeopleParts<Right extends string> {
  /** The rights of the application, which have to hold the ones named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  readonly rights: PeopleRights<Right>
  readonly routes: PeopleRoutes
}

/**
 * The routes of the people and what they are handed, for the module of an
 * application, the way `stockParts` puts the stock together. Refuses an
 * application whose catalogue lacks a right it names: that would only show
 * with the first request.
 */
export function peopleParts<Right extends string>(
  parts: PeopleParts<Right>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  for (const right of [parts.rights.read, parts.rights.write]) {
    if (!parts.access.catalogue.isRight(right)) {
      throw new Error(`The catalogue lacks a right of the people: ${right}`)
    }
  }

  return {
    controllers: [peopleController(parts.rights), qualificationKindsController(parts.rights)],
    providers: [{ provide: PEOPLE_ROUTES, useValue: parts.routes }],
  }
}
