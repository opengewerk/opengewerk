import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  type Provider,
  Query,
  type Type,
} from '@nestjs/common'
import {
  type AuditChainReport,
  auditDayProblem,
  type AuditLanguage,
  auditLanguage,
  type AuditPage,
  type AuditPerson,
  auditRights,
  type AuditVocabulary,
} from '@opengewerk/platform-domain'

import { RequiresPermission } from '../api/authorization.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { accountsOf } from '../authentication/administration.js'
import { Database } from '../database/database.js'
import { checkAuditChain } from './chain.js'
import { type AuditFilter, everMembers, readAuditPage } from './log.js'

/** The token the language of the log is handed under. */
export const AUDIT_LANGUAGE = Symbol('AuditLanguage')

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  ) {}

  @Get('changes')
  @RequiresPermission(auditRights.read)
  changes(
    @CurrentIdentity() identity: RequestIdentity,
    @Query() query: Record<string, unknown>,
  ): Promise<AuditPage> {
    return readAuditPage(
      this.database,
      identity,
      auditFilterFrom(query, this.language),
      this.language,
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
    providers: [{ provide: AUDIT_LANGUAGE, useValue: auditLanguage(parts.vocabulary) }],
  }
}
