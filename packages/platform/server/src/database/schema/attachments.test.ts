import { sql } from 'drizzle-orm'
import { check, getTableConfig, index, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { attachmentsSchema } from './attachments.js'

// The tables of the files and their versions as an application makes them,
// asked of the tables themselves and of no database: what the foundation gives
// every such pair, and that what the application adds arrives beside it. What
// the database makes of it, the tests of the routes hold.

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

const keysOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((key) => key.getName())

const travelling = ['version', 'updated_by', 'device_id', 'deleted_at', 'change_sequence']

describe('the table of the files', () => {
  it('is made with the columns of the application, and without any as the building blocks know it', () => {
    const { attachments: plain } = attachmentsSchema()
    const { attachments: own } = attachmentsSchema({ columns: { drawer: text('drawer') } })

    expect(columnsOf(plain)).not.toContain('drawer')
    expect(columnsOf(own)).toContain('drawer')
    expect(columnsOf(own)).toEqual(expect.arrayContaining(columnsOf(plain)))
    expect(Object.keys(own)).toContain('drawer')
  })

  it('refuses a column of the application under a name the table has', () => {
    expect(() => attachmentsSchema({ columns: { title: text('heading') } })).toThrow(
      'The files have these columns already: title.',
    )
  })

  it('says what a file is called and nothing else, and needs nothing but that', () => {
    const { columns } = getTableConfig(attachmentsSchema().attachments)
    const needed = columns.filter((column) => column.notNull && !column.hasDefault)

    expect(needed.map((column) => column.name).sort()).toEqual(['tenant_id', 'title'])
  })

  it('travels: it carries the columns of the sync, whatever an application adds', () => {
    expect(columnsOf(attachmentsSchema().attachments)).toEqual(expect.arrayContaining(travelling))
    expect(
      columnsOf(attachmentsSchema({ columns: { drawer: text('drawer') } }).attachments),
    ).toEqual(expect.arrayContaining(travelling))
  })

  it('keeps the tenants apart, and carries the checks and indexes of the application beside that', () => {
    const { attachments: plain } = attachmentsSchema()
    const { attachments: own } = attachmentsSchema({
      columns: { drawer: text('drawer') },
      constraints: (table) => [
        check('attachments_in_a_drawer', sql`${table.drawer} is not null`),
        index('attachments_drawer_idx').on(table.tenantId, table.drawer),
      ],
    })

    expect(getTableConfig(plain).policies.map((policy) => policy.name)).toEqual([
      'tenant_isolation',
    ])
    expect(getTableConfig(plain).checks).toEqual([])
    expect(getTableConfig(plain).indexes).toEqual([])
    // What a version reaches its file over: the key over the tenant.
    expect(getTableConfig(plain).uniqueConstraints.map((made) => made.name)).toEqual([
      'attachments_tenant_id_key',
    ])

    expect(getTableConfig(own).policies.map((policy) => policy.name)).toEqual(['tenant_isolation'])
    expect(getTableConfig(own).checks.map((made) => made.name)).toEqual(['attachments_in_a_drawer'])
    expect(getTableConfig(own).indexes.map((made) => made.config.name)).toEqual([
      'attachments_drawer_idx',
    ])
    expect(getTableConfig(own).uniqueConstraints.map((made) => made.name)).toEqual([
      'attachments_tenant_id_key',
    ])
  })
})

describe('the table of the versions', () => {
  it('names the file it belongs to and the bytes behind it, and needs every one of those', () => {
    const { columns } = getTableConfig(attachmentsSchema().attachmentVersions)
    const needed = columns.filter((column) => column.notNull && !column.hasDefault)

    expect(needed.map((column) => column.name).sort()).toEqual([
      'attachment_id',
      'file_name',
      'media_type',
      'sha256',
      'size_bytes',
      'tenant_id',
    ])
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['preview_sha256', 'created_by', ...travelling]),
    )
  })

  it('reaches its file and its bytes over the tenant, so that neither points into another one', () => {
    const { attachments, attachmentVersions } = attachmentsSchema({
      columns: { drawer: text('drawer') },
    })
    const keys = getTableConfig(attachmentVersions).foreignKeys.map((key) => {
      const reference = key.reference()

      return {
        name: key.getName(),
        columns: reference.columns.map((column) => column.name),
        table: getTableConfig(reference.foreignTable).name,
        foreign: reference.foreignColumns.map((column) => column.name),
        onDelete: key.onDelete,
      }
    })

    expect(keys).toEqual(
      expect.arrayContaining([
        {
          name: 'attachment_versions_attachment_in_tenant',
          columns: ['tenant_id', 'attachment_id'],
          table: 'attachments',
          foreign: ['tenant_id', 'id'],
          onDelete: 'restrict',
        },
        {
          name: 'attachment_versions_file_in_tenant',
          columns: ['tenant_id', 'sha256'],
          table: 'files',
          foreign: ['tenant_id', 'sha256'],
          onDelete: 'restrict',
        },
        {
          name: 'attachment_versions_preview_in_tenant',
          columns: ['tenant_id', 'preview_sha256'],
          table: 'files',
          foreign: ['tenant_id', 'sha256'],
          onDelete: 'restrict',
        },
      ]),
    )
    // The key lands on the table the application made, with its columns.
    expect(columnsOf(attachments)).toContain('drawer')
    expect(getTableConfig(attachmentVersions).policies.map((policy) => policy.name)).toEqual([
      'tenant_isolation',
    ])
    expect(getTableConfig(attachmentVersions).indexes.map((made) => made.config.name)).toEqual([
      'attachment_versions_attachment_idx',
    ])
  })

  it('takes columns of the application as well, with their checks and indexes, and refuses a name it has', () => {
    const { attachmentVersions: own } = attachmentsSchema({
      versionColumns: { drawer: text('drawer') },
      versionConstraints: (table) => [
        check('attachment_versions_in_a_drawer', sql`${table.drawer} is not null`),
        index('attachment_versions_drawer_idx').on(table.tenantId, table.drawer),
      ],
    })

    expect(columnsOf(own)).toContain('drawer')
    expect(columnsOf(attachmentsSchema().attachmentVersions)).not.toContain('drawer')
    expect(getTableConfig(own).checks.map((made) => made.name)).toEqual([
      'attachment_versions_in_a_drawer',
    ])
    expect(getTableConfig(own).indexes.map((made) => made.config.name)).toEqual([
      'attachment_versions_attachment_idx',
      'attachment_versions_drawer_idx',
    ])
    expect(keysOf(own)).toHaveLength(keysOf(attachmentsSchema().attachmentVersions).length)

    expect(() => attachmentsSchema({ versionColumns: { sha256: text('hash') } })).toThrow(
      'The versions of a file have these columns already: sha256.',
    )
  })
})
