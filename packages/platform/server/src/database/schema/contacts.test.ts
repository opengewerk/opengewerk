import { sql } from 'drizzle-orm'
import { check, getTableConfig, index, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { contactsSchema } from './contacts.js'

// The table of the contacts as an application makes it, asked of the table
// itself and of no database: what the foundation gives every table of
// contacts, and that what the application adds arrives beside it. What the
// database makes of it, the tests of the routes hold.

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

describe('the table of the contacts', () => {
  it('is made with the columns of the application, and without any as the building blocks know it', () => {
    const { contacts: plain } = contactsSchema()
    const { contacts: own } = contactsSchema({ columns: { drawer: text('drawer') } })

    expect(columnsOf(plain)).not.toContain('drawer')
    expect(columnsOf(own)).toContain('drawer')
    expect(columnsOf(own)).toEqual(expect.arrayContaining(columnsOf(plain)))
    expect(Object.keys(own)).toContain('drawer')
  })

  it('refuses a column of the application under a name the table has', () => {
    expect(() => contactsSchema({ columns: { familyName: text('surname') } })).toThrow(
      'The contacts have these columns already: familyName.',
    )
  })

  it('says who a contact is and how to reach them, and needs nothing but a family name', () => {
    const { columns } = getTableConfig(contactsSchema().contacts)
    const needed = columns.filter((column) => column.notNull && !column.hasDefault)

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['given_name', 'family_name', 'role', 'email', 'phone']),
    )
    expect(needed.map((column) => column.name).sort()).toEqual(['family_name', 'tenant_id'])
  })

  it('travels: it carries the columns of the sync, whatever an application adds', () => {
    const travelling = ['version', 'updated_by', 'device_id', 'deleted_at', 'change_sequence']

    expect(columnsOf(contactsSchema().contacts)).toEqual(expect.arrayContaining(travelling))
    expect(columnsOf(contactsSchema({ columns: { drawer: text('drawer') } }).contacts)).toEqual(
      expect.arrayContaining(travelling),
    )
  })

  it('keeps the tenants apart, and carries the checks and indexes of the application beside that', () => {
    const { contacts: plain } = contactsSchema()
    const { contacts: own } = contactsSchema({
      columns: { drawer: text('drawer') },
      constraints: (table) => [
        check('contacts_in_a_drawer', sql`${table.drawer} is not null`),
        index('contacts_drawer_idx').on(table.tenantId, table.drawer),
      ],
    })

    expect(getTableConfig(plain).policies.map((policy) => policy.name)).toEqual([
      'tenant_isolation',
    ])
    expect(getTableConfig(plain).checks).toEqual([])
    expect(getTableConfig(plain).indexes).toEqual([])

    expect(getTableConfig(own).policies.map((policy) => policy.name)).toEqual(['tenant_isolation'])
    expect(getTableConfig(own).checks.map((made) => made.name)).toEqual(['contacts_in_a_drawer'])
    expect(getTableConfig(own).indexes.map((made) => made.config.name)).toEqual([
      'contacts_drawer_idx',
    ])
  })
})
