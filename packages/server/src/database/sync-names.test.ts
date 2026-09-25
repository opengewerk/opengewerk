import { isSetByServer, syncEntities, syncEntityNames, syncFieldNames } from '@opengewerk/domain'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { syncTableFor } from './sync.js'

/**
 * Every name a conflict can show, held against the schema (#221).
 *
 * A conflict names the record and the fields it hangs on. What the web package
 * cannot put into words, it shows raw, and on site that read "form_records"
 * and "performedOn". The names live in `domain`, and here every entity of the
 * sync policies and every field a device may write has to have one; what the
 * server sets itself never reaches a conflict and needs none.
 */
describe('the names of the sync', () => {
  it('name every kind of record a device exchanges', () => {
    expect(syncEntities.filter((entity) => !(entity in syncEntityNames))).toEqual([])
  })

  it('name every field a device may write, on every entity', () => {
    const missing: string[] = []

    for (const entity of syncEntities) {
      const table = syncTableFor(entity)

      if (!table) {
        missing.push(`${entity}: keine Tabelle`)
        continue
      }

      for (const field of Object.keys(getTableColumns(table))) {
        if (!isSetByServer(entity, field) && !(field in syncFieldNames)) {
          missing.push(`${entity}.${field}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})
