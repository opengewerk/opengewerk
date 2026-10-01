import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import {
  type AuditChainReport,
  auditDayProblem,
  type AuditPage,
  auditRecordTables,
  auditTables,
} from '@opengewerk/domain'
import { Database } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

import { accountsOf } from '../authentication/administration.js'
import { checkAuditChain, type AuditFilter, readAuditPage } from '../audit/log.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** Somebody who has worked in this business, for the filter of the log. */
export interface AuditPerson {
  readonly userId: string
  readonly name: string
}

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

/** The filter from the query, refused in the words of the office where it does not fit. */
export function auditFilterFrom(query: Record<string, unknown>): AuditFilter {
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

  if (table !== null && !(table in auditTables)) {
    throw new BadRequestException(`Unbekannte Art eines Datensatzes: ${table}`)
  }

  const record = one(query, 'record')

  if (record !== null) {
    if (!uuidPattern.test(record)) {
      throw new BadRequestException('record ist keine Kennung eines Datensatzes.')
    }

    if (table === null || !(auditRecordTables as readonly string[]).includes(table)) {
      throw new BadRequestException(
        'Einen einzelnen Datensatz gibt es nur für Kunde, Objekt, Anlage, Auftrag und Beleg, mit table.',
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
 * The change log of the business for its owner (#285): the changes page by
 * page, the check of the chain, and the people for the filter.
 *
 * Reading the log is not written to the log. It is a read like any other, and
 * a log of every look at the log would grow with every page and bury the
 * changes it exists for (decided on 27.09.2026, #285).
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly database: Database) {}

  @Get('changes')
  @RequiresPermission('audit.read')
  changes(
    @CurrentIdentity() identity: RequestIdentity,
    @Query() query: Record<string, unknown>,
  ): Promise<AuditPage> {
    return readAuditPage(this.database, identity, auditFilterFrom(query))
  }

  /**
   * The walk over the whole chain. A GET, because it changes nothing, and on
   * request only: it reads and hashes every entry the business has.
   */
  @Get('chain')
  @RequiresPermission('audit.read')
  chain(@CurrentIdentity() identity: RequestIdentity): Promise<AuditChainReport> {
    return checkAuditChain(this.database, identity)
  }

  /** Everybody who ever had a membership here, also those who have left, by name. */
  @Get('people')
  @RequiresPermission('audit.read')
  async people(@CurrentIdentity() identity: RequestIdentity): Promise<AuditPerson[]> {
    const ids = await this.database.forTenant(identity, async (tx) => {
      const result = await tx.execute(sql`
        select distinct new_value as user_id
          from audit_entries
         where tenant_id = ${identity.tenantId}::uuid
           and table_name = 'memberships'
           and field = 'user_id'
           and new_value is not null`)

      return (result.rows as { user_id: string }[]).map((row) => row.user_id)
    })
    const accounts = await accountsOf(this.database, ids, identity.userId)

    return [...accounts]
      .map(([userId, account]) => ({ userId, name: account.name }))
      .sort((one, other) => one.name.localeCompare(other.name, 'de'))
  }
}
