import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  type Provider,
  type Type,
} from '@nestjs/common'
import { type ContactRules, contactTextFields } from '@opengewerk/platform-domain'
import { and, eq, getTableColumns, isNull } from 'drizzle-orm'

import { AUTHORIZATION, type Authorization, RequiresPermission } from '../api/authorization.js'
import { pick, requireSomething } from '../api/body.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import type { ContactRow, ContactsTable, OwnContactColumns } from '../database/schema/contacts.js'

/** What the routes of the contacts are told by the application, under which a module hands it in. */
export const CONTACT_ROUTES = Symbol('ContactRoutes')

const missing = 'Diesen Ansprechpartner gibt es nicht oder nicht mehr.'
const notText = 'Die Angaben zu einem Ansprechpartner sind Text.'

/** What a route is shown of a contact before it writes one. */
export interface ContactPlacing<Parent extends string = string> {
  readonly tx: TenantTransaction
  readonly identity: RequestIdentity
  /**
   * The parents the request names, by field: all of them for a new contact,
   * for a change only those it sets.
   */
  readonly parents: Readonly<Partial<Record<Parent, unknown>>>
  readonly creating: boolean
}

/** What the routes of the contacts are told by the application. */
export interface ContactRoutes<
  Right extends string = string,
  Parent extends string = string,
  Own extends OwnContactColumns = Record<never, never>,
> {
  /** The contacts of the application, made with `contactsSchema`. */
  readonly table: ContactsTable<Own>
  /** Its rules: what a contact hangs on, and what is wrong with one. */
  readonly rules: ContactRules<Parent>
  /**
   * A right a route asks for beyond its own, by what a contact hangs on: the
   * people of one kind of record may be somebody else's to keep. Asked for the
   * parent a contact has, and for the one a change would give it.
   */
  readonly parentRight?: (field: Parent) => Right | null
  /**
   * What the application looks at before a contact is written, in the
   * transaction that writes it: whether what the contact points at is there
   * for whoever asks, and the columns of its own it works out from that.
   * It refuses by throwing; what it returns is written with the row.
   */
  readonly place?: (
    placing: ContactPlacing<Parent>,
  ) => Promise<Readonly<Record<string, unknown>> | undefined>
}

/** The rights the routes of the contacts ask for, the application's. */
export interface ContactRights<Right extends string> {
  /** Reading the contacts. */
  readonly read: Right
  /** Adding a contact. */
  readonly create: Right
  /** Correcting a contact and taking one away. */
  readonly write: Right
}

type AnyRoutes = ContactRoutes<string, string>

/**
 * The texts of a body as they are kept: trimmed, and an optional one left
 * empty is no text. The family name stays what was typed, so that the rule
 * says of an empty one that it is missing.
 */
function textsOf(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const texts: Record<string, unknown> = {}

  for (const field of contactTextFields) {
    if (!(field in values)) {
      continue
    }

    const value = values[field]

    if (value === null) {
      texts[field] = null
      continue
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(notText)
    }

    const trimmed = value.trim()

    texts[field] = trimmed === '' && field !== 'familyName' ? null : trimmed
  }

  return texts
}

/** Refuses what the rules find wrong, with their first sentence. */
function refuse(problems: Readonly<Record<string, string>>): void {
  const [problem] = Object.values(problems)

  if (problem !== undefined) {
    throw new BadRequestException(problem)
  }
}

/** The table, read as every table of contacts: its own columns are reached by name. */
function contactsOf(routes: AnyRoutes): ContactsTable {
  return routes.table as unknown as ContactsTable
}

/** The parents among these values, by field. */
function parentsOf(
  rules: ContactRules,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    rules.parents.filter((field) => field in values).map((field) => [field, values[field]]),
  )
}

function requireOneParent(rules: ContactRules, standing: Readonly<Record<string, unknown>>): void {
  const problem = rules.parentProblem(standing)

  if (problem) {
    throw new BadRequestException(rules.parentText[problem])
  }
}

/** Refuses whoever lacks a right the parents named here ask for beyond the route's own. */
function requireParentRight(
  routes: AnyRoutes,
  authorization: Authorization,
  identity: RequestIdentity,
  named: Readonly<Record<string, unknown>>,
): void {
  for (const field of routes.rules.parents) {
    const value = named[field]

    if (value === null || value === undefined || value === '') {
      continue
    }

    const right = routes.parentRight?.(field) ?? null

    if (right !== null && !identity.rights.includes(right)) {
      throw new ForbiddenException(authorization.missingPermission(right))
    }
  }
}

/**
 * The contact that is there for whoever asks, held until the transaction
 * ends. One that is marked as deleted, one of another tenant and an id that
 * is no id at all are answered alike, so that the answer says nothing about
 * what is elsewhere.
 */
async function held(
  tx: TenantTransaction,
  contacts: ContactsTable,
  id: string,
): Promise<Readonly<Record<string, unknown>>> {
  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  const [current] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id as ContactRow['id']), isNull(contacts.deletedAt)))
    .for('no key update')

  if (!current) {
    throw new NotFoundException(missing)
  }

  return current
}

/**
 * The people to talk to at the records of an application
 * (opengewerk-haustechnik#85): listed, added, corrected and taken away.
 *
 * What a contact hangs on is the application's, and so is who may keep one:
 * the three rights are named by the application, and the people of one kind
 * of record can ask for a right beyond them (`parentRight`). A contact hangs
 * on exactly one of its parents, judged as it would stand afterwards, and the
 * refusal is the sentence a form shows; the sync asks the same rule
 * (`contactRecordRules`), and the check the application puts on its table
 * holds it for every other way in.
 *
 * The texts are kept as a form hands them over: trimmed, and an optional one
 * left empty is no text.
 *
 * A contact is taken away by marking it as deleted. A row that is gone is a
 * row a device that was offline never hears about, because a delta pull
 * delivers what changed and a row that is no longer there is not among it.
 *
 * Made by a function because the rights are the application's. Nothing but
 * its routes is on the class: whoever walks the routes of a module reads every
 * property of it.
 */
function contactsController(rights: ContactRights<string>): Type<unknown> {
  @Controller('contacts')
  class ContactsController {
    constructor(
      readonly database: Database,
      @Inject(CONTACT_ROUTES) readonly routes: AnyRoutes,
      @Inject(AUTHORIZATION) readonly authorization: Authorization,
    ) {}

    @Get()
    @RequiresPermission(rights.read)
    list(@CurrentIdentity() identity: RequestIdentity) {
      const contacts = contactsOf(this.routes)

      return this.database.forTenant(identity, (tx) =>
        tx.select().from(contacts).where(isNull(contacts.deletedAt)),
      )
    }

    @Post()
    @RequiresPermission(rights.create)
    create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
      const { rules } = this.routes
      const contacts = contactsOf(this.routes)
      const picked = pick(body, [...rules.parents, ...contactTextFields])
      const texts = textsOf(picked)
      const parents = parentsOf(rules, picked)

      refuse(rules.personProblems({ familyName: null, ...texts }))
      requireOneParent(rules, parents)
      requireParentRight(this.routes, this.authorization, identity, parents)

      return this.database.forTenant(identity, async (tx) => {
        const placed = await this.routes.place?.({ tx, identity, parents, creating: true })
        const [created] = await tx
          .insert(contacts)
          .values({
            ...parents,
            ...texts,
            ...placed,
            tenantId: identity.tenantId,
          } as typeof contacts.$inferInsert)
          .returning()

        return created
      })
    }

    @Patch(':id')
    @RequiresPermission(rights.write)
    update(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('id') id: string,
      @Body() body: unknown,
    ) {
      const { rules } = this.routes
      const contacts = contactsOf(this.routes)
      const picked = pick(body, [...rules.parents, ...contactTextFields])

      requireSomething(picked)

      const texts = textsOf(picked)
      const parents = parentsOf(rules, picked)

      refuse(rules.personProblems(texts))

      return this.database.forTenant(identity, async (tx) => {
        const current = await held(tx, contacts, id)

        // Moving a contact from one parent to another takes both fields in one
        // request, one set and one emptied. Judged field by field, the first
        // would already be refused as several.
        requireOneParent(
          rules,
          Object.fromEntries(
            rules.parents.map((field) => [
              field,
              field in parents ? parents[field] : current[field],
            ]),
          ),
        )
        requireParentRight(this.routes, this.authorization, identity, current)
        requireParentRight(this.routes, this.authorization, identity, parents)

        const placed = await this.routes.place?.({ tx, identity, parents, creating: false })
        const [updated] = await tx
          .update(contacts)
          .set({ ...parents, ...texts, ...placed } as Partial<typeof contacts.$inferInsert>)
          .where(and(eq(contacts.id, id as ContactRow['id']), isNull(contacts.deletedAt)))
          .returning()

        return updated
      })
    }

    @Delete(':id')
    @RequiresPermission(rights.write)
    remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
      const contacts = contactsOf(this.routes)

      return this.database.forTenant(identity, async (tx) => {
        const current = await held(tx, contacts, id)

        requireParentRight(this.routes, this.authorization, identity, current)

        const [removed] = await tx
          .update(contacts)
          .set({ deletedAt: new Date() })
          .where(and(eq(contacts.id, id as ContactRow['id']), isNull(contacts.deletedAt)))
          .returning()

        return removed
      })
    }
  }

  return ContactsController
}

/** What the routes of the contacts are put together from. */
export interface ContactParts<
  Right extends string,
  Parent extends string,
  Own extends OwnContactColumns,
> {
  /** The rights of the application, which have to hold the ones named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  readonly rights: ContactRights<Right>
  readonly routes: ContactRoutes<Right, Parent, Own>
}

/**
 * The routes of the contacts and what they are handed, for the module of an
 * application. A function and not a module of its own, for the reason
 * `authenticationParts` is one: the guard, the database and the identity
 * source are the application's to register, once.
 *
 * Refuses an application whose catalogue lacks a right it names, and one
 * whose table has no column for a parent of its rules: both would only show
 * with the first request.
 */
export function contactParts<
  Right extends string,
  Parent extends string,
  Own extends OwnContactColumns,
>(
  parts: ContactParts<Right, Parent, Own>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  const { read, create, write } = parts.rights
  const { rules, table, parentRight } = parts.routes
  const beyond = rules.parents.map((field) => parentRight?.(field) ?? null)

  for (const right of [read, create, write, ...beyond]) {
    if (right !== null && !parts.access.catalogue.isRight(right)) {
      throw new Error(`The catalogue lacks a right of the contacts: ${right}`)
    }
  }

  const columns = getTableColumns(table) as Readonly<Record<string, unknown>>

  for (const field of rules.parents) {
    if (!(field in columns)) {
      throw new Error(`The contacts have no column for what a contact hangs on: ${field}`)
    }
  }

  return {
    controllers: [contactsController({ read, create, write })],
    providers: [{ provide: CONTACT_ROUTES, useValue: parts.routes as unknown as AnyRoutes }],
  }
}
