import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, foundationDeviations } from './test-database.js'

// The foundation of this application came about over sixty migrations, and
// since ADR 0010 it is also a set of building blocks a new application starts
// from. This holds the two against each other: a database built from the
// blocks alone, and this one after every migration.
//
// It is the migrations that are right. Each of them has run on somebody's
// installation and stays as it is; a deviation therefore means a block has to
// follow, or that a migration changed the foundation without anybody noticing
// that it is the foundation.

let admin: Pool

beforeAll(async () => {
  admin = await connect()
})

afterAll(async () => {
  await admin.end()
})

describe('the foundation in this database', () => {
  it('is what its building blocks say, after every migration', async () => {
    // What hangs of its own on a table of the foundation is what the outbox of
    // the mail carries for the records its messages are about (#23): the
    // task, the document with its file, and the deadline. The one trigger
    // that used to be named here, the log of the instance watching `tenants`
    // (#188), is the foundation's since the area of the instance moved there.
    const deviations = await foundationDeviations(admin, {
      columns: [
        'mail_outbox.task_id',
        'mail_outbox.document_id',
        'mail_outbox.attachment',
        'mail_outbox.deadline_id',
      ],
      constraints: [
        'mail_outbox.mail_outbox_task_in_tenant',
        'mail_outbox.mail_outbox_document_in_tenant',
        'mail_outbox.mail_outbox_deadline_in_tenant',
      ],
      indexes: [
        'mail_outbox.mail_outbox_task_idx',
        'mail_outbox.mail_outbox_document_idx',
        'mail_outbox.mail_outbox_deadline_idx',
      ],
    })

    expect(deviations).toEqual([])
  })
})
