import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  type Provider,
  Query,
  StreamableFile,
  type Type,
} from '@nestjs/common'
import {
  type AuditChainReport,
  auditDayProblem,
  type AuditLanguage,
  auditLanguage,
  type AuditPage,
  type AuditPerson,
  auditRedactionProblem,
  type AuditRedactionNote,
  type AuditRedactionSide,
  auditRights,
  auditTableNamesPeople,
  type AuditValueWords,
  type AuditVocabulary,
  berlinClock,
  tableNamesPeople,
} from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'

import { RequiresPermission } from '../api/authorization.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { accountsOf } from '../authentication/administration.js'
import { leadsItsTenant } from '../authentication/roles.js'
import { Database } from '../database/database.js'
import { auditRedactions } from '../database/schema/audit.js'
import { memberships } from '../database/schema/memberships.js'
import { tableAnswer, tableFormatOf } from '../tables/write.js'
import { checkAuditChain } from './chain.js'
import {
  type AuditFilter,
  type AuditFirstValues,
  type AuditTenantWords,
  everMembers,
  readAuditPage,
} from './log.js'
import { auditTable } from './table.js'

/** The token the language of the log is handed under. */
export const AUDIT_LANGUAGE = Symbol('AuditLanguage')

/** The token what the application says about the values of its log is handed under. */
export const AUDIT_WORDS = Symbol('AuditWords')

/** What an application knows of the values a record was written with, or null (`AuditFirstValues`). */
export const AUDIT_FIRST_VALUES = Symbol('AuditFirstValues')

/** The words of the values for one tenant, or null where the words of the application hold (`AuditTenantWords`). */
export const AUDIT_TENANT_WORDS = Symbol('AuditTenantWords')

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Why an entry is not found: it is not in the log of this tenant. */
const noSuchEntry = 'Diesen Eintrag gibt es im Änderungsprotokoll nicht.'

/** Why a redaction is refused to somebody who reads the log: only whoever leads blacks out a value. */
export const redactionNeedsLead =
  'Einen Wert im Änderungsprotokoll schwärzt nur, wer den Mandanten führt.'

/** The code PostgreSQL refuses a row with that a policy does not let through. */
const rowLevelSecurity = '42501'

/** One value of the query, or null when it is missing or empty; a repeated one is refused. */
function one(query: Record<string, unknown>, name: string): string | null {
  const value = query[name]

  if (value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} kommt einmal und als Text.`)
  }

  return value
}

function day(query: Record<string, unknown>, name: string): string | null {
  const value = one(query, name)

  if (value === null) {
    return null
  }

  const problem = auditDayProblem(value)

  if (problem !== null) {
    throw new BadRequestException(`${name}: ${problem}`)
  }

  return value
}

/** Words in a list as a sentence says them: "A, B und C". */
function listed(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} und ${words[words.length - 1] ?? ''}`
}

/** The filter from the query, refused in words a person reads where it does not fit. */
export function auditFilterFrom(
  query: Record<string, unknown>,
  language: AuditLanguage,
): AuditFilter {
  const since = day(query, 'since')
  const until = day(query, 'until')

  if (since !== null && until !== null && until < since) {
    throw new BadRequestException('Der letzte Tag liegt vor dem ersten.')
  }

  const person = one(query, 'person')

  if (person !== null && person.length > 200) {
    throw new BadRequestException('person ist zu lang für eine Kennung.')
  }

  const table = one(query, 'table')

  if (table !== null && !(table in language.tables)) {
    throw new BadRequestException(`Unbekannte Art eines Datensatzes: ${table}`)
  }

  const record = one(query, 'record')

  if (record !== null) {
    if (!uuidPattern.test(record)) {
      throw new BadRequestException('record ist keine Kennung eines Datensatzes.')
    }

    if (table === null || !language.records.includes(table)) {
      throw new BadRequestException(
        `Einen einzelnen Datensatz gibt es nur für ${listed(
          language.records.map((key) => language.tableLabel(key)),
        )}, mit table.`,
      )
    }
  }

  const before = one(query, 'before')
  let cursor: number | null = null

  if (before !== null) {
    cursor = Number(before)

    if (!Number.isSafeInteger(cursor) || cursor < 1) {
      throw new BadRequestException('before ist eine Stelle in der Kette, eine ganze Zahl ab 1.')
    }
  }

  return {
    since,
    until,
    userId: person,
    // Opened from a record, the table names the record; its parts are other tables.
    table: record === null ? table : null,
    record: record === null || table === null ? null : { table, id: record.toLowerCase() },
    before: cursor,
  }
}

/**
 * The change log of a tenant for whoever may read it: the changes page by
 * page, the check of the chain, and the people for the filter.
 *
 * Reading the log is not written to the log. It is a read like any other, and
 * a log of every look at the log would grow with every page and bury the
 * changes it exists for (decided on 27.09.2026, opengewerk#285).
 */
@Controller('audit')
export class AuditController {
  constructor(
    private readonly database: Database,
    @Inject(AUDIT_LANGUAGE) private readonly language: AuditLanguage,
    @Inject(AUDIT_WORDS) private readonly words: AuditValueWords,
    @Inject(AUDIT_FIRST_VALUES) private readonly firstValues: AuditFirstValues | null,
    @Inject(AUDIT_TENANT_WORDS) private readonly tenantWords: AuditTenantWords | null,
  ) {}

  @Get('changes')
  @RequiresPermission(auditRights.read)
  async changes(
    @CurrentIdentity() identity: RequestIdentity,
    @Query() query: Record<string, unknown>,
  ): Promise<AuditPage> {
    const [page, redacts] = await Promise.all([
      readAuditPage(
        this.database,
        identity,
        auditFilterFrom(query, this.language),
        this.language,
        this.firstValues,
      ),
      this.leads(identity),
    ])

    return { ...page, redacts }
  }

  /**
   * Whether the person leads the tenant, which a screen needs to offer the
   * redaction of a value (ADR 0013). The policy of the redactions asks the
   * same of the membership when one is written.
   */
  private leads(identity: RequestIdentity): Promise<boolean> {
    return this.database.forTenant(identity, async (tx) => {
      const [found] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.userId, identity.userId), leadsItsTenant()))
        .limit(1)

      return found !== undefined
    })
  }

  /**
   * The log as a table (opengewerk-haustechnik#236): every change the filter
   * finds, not a page of them, newest first and in the words of the list, as
   * a workbook or as text (`?format=xlsx` or `csv`).
   *
   * For whoever reads the log and may see the staff as well
   * (`tableNamesPeople`). A log names people in every row, by who made a
   * change, by a field and by what a record is called, and one with the
   * people left out would name them still; so it leaves as a table only
   * with somebody a list of the staff may leave with.
   */
  @Get('table')
  @RequiresPermission(auditRights.read)
  @Header('Cache-Control', 'no-store')
  async table(
    @CurrentIdentity() identity: RequestIdentity,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    if (!tableNamesPeople(identity)) {
      throw new ForbiddenException(auditTableNamesPeople)
    }

    const format = tableFormatOf(query)
    const filter = auditFilterFrom(query, this.language)
    // The words of this tenant where the application makes them per tenant (opengewerk-haustechnik#426).
    const tenantWords = this.tenantWords
    const words =
      tenantWords === null
        ? this.words
        : {
            ...(await this.database.forTenant(identity, (tx) => tenantWords(tx))),
            vocabulary: this.words.vocabulary,
          }

    return tableAnswer(
      await auditTable(this.database, identity, filter, this.language, words, this.firstValues),
      format,
      berlinClock(new Date()).day,
    )
  }

  /**
   * The walk over the whole chain. A GET, because it changes nothing, and on
   * request only: it reads and hashes every entry the tenant has.
   */
  @Get('chain')
  @RequiresPermission(auditRights.read)
  chain(@CurrentIdentity() identity: RequestIdentity): Promise<AuditChainReport> {
    return checkAuditChain(this.database, identity)
  }

  /**
   * Blacks out one value of an entry (ADR 0013): the value before or after,
   * with a reason. Whoever reads the log may ask; whether the person leads
   * the tenant, and whether the entry is still as it was written, the database
   * decides, and the redaction itself stands in the log.
   *
   * No right of its own, on purpose: who may black out a value is whoever
   * leads the tenant (decided at opengewerk-haustechnik#355 on 19.10.2026),
   * and leading is a property of a role, not a right one could hand to a
   * role of a tenant's own. The restrictive policy of `audit_redactions` asks
   * it of the membership, so no right a route could check would add to it.
   * The log is no evidence: a value in it is a copy of what a record held,
   * and the record and every evidence stay as they are.
   */
  @Post('entries/:id/redactions')
  @RequiresPermission(auditRights.read)
  async redact(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AuditRedactionNote> {
    if (!uuidPattern.test(id)) {
      throw new NotFoundException(noSuchEntry)
    }

    const { side, reason } =
      typeof body === 'object' && body !== null
        ? (body as { side?: unknown; reason?: unknown })
        : {}
    const problem = auditRedactionProblem(side, reason)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    try {
      // A reason of its own, so that the log says a value was blacked out and not that it was read.
      const redacting = {
        tenantId: identity.tenantId,
        userId: identity.userId,
        reason: 'audit.redact',
      }
      const [written] = await this.database.forTenant(redacting, (tx) =>
        tx
          .insert(auditRedactions)
          .values({
            tenantId: identity.tenantId,
            entryId: id.toLowerCase(),
            side: side as AuditRedactionSide,
            reason: reason as string,
            redactedBy: identity.userId,
          })
          .returning({
            at: auditRedactions.createdAt,
            by: auditRedactions.redactedBy,
            reason: auditRedactions.reason,
          }),
      )

      if (written === undefined) {
        throw new NotFoundException(noSuchEntry)
      }

      return { at: written.at.toISOString(), by: written.by, reason: written.reason }
    } catch (error) {
      const code = [error, (error as { cause?: unknown }).cause]
        .map((candidate) => (candidate as { code?: unknown } | undefined)?.code)
        .find((each) => typeof each === 'string')

      if (code === rowLevelSecurity) {
        throw new ForbiddenException(redactionNeedsLead)
      }

      throw error
    }
  }

  /** Everybody who ever had a membership here, also those who have left, by name. */
  @Get('people')
  @RequiresPermission(auditRights.read)
  async people(@CurrentIdentity() identity: RequestIdentity): Promise<AuditPerson[]> {
    const ids = await this.database.forTenant(identity, (tx) => everMembers(tx, identity.tenantId))
    const accounts = await accountsOf(this.database, ids, identity.userId)

    return [...accounts]
      .map(([userId, account]) => ({ userId, name: account.name }))
      .sort((one, other) => one.name.localeCompare(other.name, 'de'))
  }
}

/** What the routes of the log are put together from. */
export interface AuditLogParts<Right extends string> {
  /** The rights of the application, which have to hold the one of the log. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  /** What the application says about its own tables in the log. */
  readonly vocabulary: AuditVocabulary
  /**
   * What the application says about the values of its log, as its screen
   * says it, for the log as a table (opengewerk-haustechnik#236).
   */
  readonly words?: Omit<AuditValueWords, 'vocabulary'>
  /**
   * What the application knows of the values a record was written with,
   * where the log is silent about them (opengewerk-haustechnik#422).
   */
  readonly firstValues?: AuditFirstValues
  /**
   * The words of the values for the tenant that asks, where a tenant adds
   * words of its own (opengewerk-haustechnik#426). Without it the log as a
   * table speaks in `words`.
   */
  readonly tenantWords?: AuditTenantWords
}

/**
 * The controller of the change log and what it is handed, for the module of
 * an application.
 *
 * A function and not a module of its own, for the reason `authenticationParts`
 * is one: the guard, the database and the identity source are the
 * application's to register, once.
 */
export function auditLogParts<Right extends string>(
  parts: AuditLogParts<Right>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  if (!parts.access.catalogue.isRight(auditRights.read)) {
    // The routes ask for it. Without it in the catalogue no role could hold
    // it, and nobody would ever read the log.
    throw new Error(`The catalogue lacks the right of the change log: ${auditRights.read}`)
  }

  return {
    controllers: [AuditController],
    providers: [
      { provide: AUDIT_LANGUAGE, useValue: auditLanguage(parts.vocabulary) },
      { provide: AUDIT_WORDS, useValue: { ...parts.words, vocabulary: parts.vocabulary } },
      { provide: AUDIT_FIRST_VALUES, useValue: parts.firstValues ?? null },
      { provide: AUDIT_TENANT_WORDS, useValue: parts.tenantWords ?? null },
    ],
  }
}
