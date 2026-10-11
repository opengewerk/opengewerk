import {
  auditFormatInGermany,
  type AuditLanguage,
  auditTableColumns,
  auditTextWords,
  type AuditValueWords,
  emptyAuditValue,
  type TenantId,
  withheldAuditValue,
} from '@opengewerk/platform-domain'

import type { Database } from '../database/database.js'
import type { OutgoingTable, TableCell } from '../tables/write.js'
import { type AuditFilter, readAuditPage } from './log.js'

/**
 * The change log of a tenant as a table (opengewerk-haustechnik#236): what
 * the log shows under its filter, newest first, read page by page as the
 * list reads it and named in the words of the list, with a row for each
 * field a change shows.
 *
 * Who made a change, and the value of a field that holds a person, stand in
 * it only where `names` says so (`tableNamesPeople`); without, the column of
 * the person is left out and such a value is written as set, as the log
 * writes a value it keeps to itself.
 */
export async function auditTable(
  database: Database,
  identity: { readonly tenantId: TenantId; readonly userId: string },
  filter: AuditFilter,
  language: AuditLanguage,
  said: AuditValueWords,
  names: boolean,
): Promise<OutgoingTable> {
  const words = auditTextWords(said, auditFormatInGermany)
  const columns = auditTableColumns
  const rows: (readonly TableCell[])[] = []
  let before = filter.before

  do {
    const page = await readAuditPage(database, identity, { ...filter, before }, language)

    for (const change of page.changes) {
      const way = words.wayWords(change, page)
      const valueOf = (field: string, raw: string | null): string => {
        if (!names && raw !== null && raw !== '' && language.isPersonField(field)) {
          return withheldAuditValue
        }

        return words.auditValue(change.table, field, raw, page) ?? emptyAuditValue
      }
      const common = [
        auditFormatInGermany.moment(change.changedAt),
        words.recordTitle(change.table, change.recordId, page),
        words.recordKind(change.table, change.recordId, page),
        words.changeSummary(change),
      ]
      const after = [...(names ? [way.person ?? 'Niemand'] : []), way.device, way.way]
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
      ...(names ? [columns.person] : []),
      columns.device,
      columns.way,
    ],
    rows,
  }
}
