import {
  auditFormatInGermany,
  type AuditLanguage,
  auditTableColumns,
  auditTextWords,
  type AuditValueWords,
  emptyAuditValue,
  type TenantId,
} from '@opengewerk/platform-domain'

import type { Database } from '../database/database.js'
import { type OutgoingTable, refuseOverlongTable, type TableCell } from '../tables/write.js'
import { type AuditFilter, type AuditFirstValues, readAuditPage } from './log.js'

/**
 * The change log of a tenant as a table (opengewerk-haustechnik#236): what
 * the log shows under its filter, newest first, read page by page as the
 * list reads it and named in the words of the list, with a row for each
 * field a change shows.
 *
 * It names people as the log does: who made a change, whom a field holds,
 * and a record that is called by a person. Whoever calls this has asked
 * whether the person may see the staff (`tableNamesPeople`); there is no log
 * without its people to hand to anybody else.
 *
 * @throws UnprocessableEntityException once the log is longer than a table goes out with
 */
export async function auditTable(
  database: Database,
  identity: { readonly tenantId: TenantId; readonly userId: string },
  filter: AuditFilter,
  language: AuditLanguage,
  said: AuditValueWords,
  firstValues: AuditFirstValues | null = null,
): Promise<OutgoingTable> {
  const words = auditTextWords(said, auditFormatInGermany)
  const columns = auditTableColumns
  const rows: (readonly TableCell[])[] = []
  let before = filter.before

  do {
    const page = await readAuditPage(
      database,
      identity,
      { ...filter, before },
      language,
      firstValues,
    )

    for (const change of page.changes) {
      const way = words.wayWords(change, page)
      const valueOf = (field: string, raw: string | null): string =>
        words.auditValue(change.table, field, raw, page) ?? emptyAuditValue
      const common = [
        auditFormatInGermany.moment(change.changedAt),
        words.recordTitle(change.table, change.recordId, page),
        words.recordKind(change.table, change.recordId, page),
        words.changeSummary(change, page),
      ]
      const after = [way.person ?? 'Niemand', way.device, way.way]
      const fields = words.shownFields(change)

      if (fields.length === 0) {
        rows.push([...common, null, null, null, ...after])
      }

      for (const field of fields) {
        rows.push([
          ...common,
          words.fieldWords(change.table, field.field),
          valueOf(field.field, field.before),
          valueOf(field.field, field.after),
          ...after,
        ])
      }
    }

    // Asked page by page: a log that is too long is not read to its end first.
    refuseOverlongTable(rows.length)
    before = page.next
  } while (before !== null)

  return {
    name: 'Änderungsprotokoll',
    columns: [
      columns.moment,
      columns.record,
      columns.kind,
      columns.change,
      columns.field,
      columns.before,
      columns.after,
      columns.person,
      columns.device,
      columns.way,
    ],
    rows,
  }
}
