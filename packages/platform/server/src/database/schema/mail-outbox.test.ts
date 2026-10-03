import { getTableConfig, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { mailOutboxSchema } from './mail-outbox.js'

/**
 * The outbox as an application makes it: the columns every outbox has, and
 * those the application adds for what its messages are about. Whether the
 * table in a database is what the factory says is asked where there is one,
 * in the comparison of an application's migrations with the blocks.
 */

describe('the outbox of an application', () => {
  it('has the columns of every outbox and those the application adds', () => {
    const { mailOutbox } = mailOutboxSchema({
      kinds: ['parcel_waiting'],
      columns: { parcelNumber: text('parcel_number') },
    })

    const columns = getTableConfig(mailOutbox).columns.map((column) => column.name)

    expect(columns).toEqual(
      expect.arrayContaining(['kind', 'cause', 'invitation_id', 'subject', 'parcel_number']),
    )
  })

  it('takes no column of the application under the name of one every outbox has', () => {
    expect(() =>
      mailOutboxSchema({ kinds: ['parcel_waiting'], columns: { subject: text('headline') } }),
    ).toThrow('The outbox has these columns already: subject.')
  })

  it('points at nothing but an invitation unless the application says so', () => {
    const { mailOutbox } = mailOutboxSchema({ kinds: ['parcel_waiting'] })

    const pointsAt = getTableConfig(mailOutbox).foreignKeys.map(
      (key) => getTableConfig(key.reference().foreignTable).name,
    )

    expect(pointsAt.sort()).toEqual(['invitations', 'tenants'])
  })
})
