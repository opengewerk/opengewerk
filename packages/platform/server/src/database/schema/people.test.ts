import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { peopleSchema } from './people.js'

// The tables of the people as an application makes them (ADR 0016), asked of
// the tables and of no database. What a database makes of them, the tests of
// the application that binds them hold.

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

describe('the tables of the people', () => {
  it('travel: both carry the columns of the sync, and keep the tenants apart', () => {
    const travelling = ['version', 'updated_by', 'device_id', 'deleted_at', 'change_sequence']

    for (const table of Object.values(peopleSchema())) {
      expect(columnsOf(table)).toEqual(expect.arrayContaining(travelling))
      expect(getTableConfig(table).policies.map((policy) => policy.name)).toContain(
        'tenant_isolation',
      )
    }
  })

  it('hold in the database that a person has an account here or none, one person to an account', () => {
    const { people } = peopleSchema()

    expect(getTableConfig(people).foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining(['people_account_here']),
    )
    expect(getTableConfig(people).indexes.map((each) => each.config.name)).toContain(
      'people_one_per_account',
    )
    expect(getTableConfig(people).checks.map((each) => each.name)).toEqual(
      expect.arrayContaining(['people_name_fits', 'people_leave_after_joining']),
    )
    expect(
      getTableConfig(people).columns.find((column) => column.name === 'user_id')?.notNull,
    ).toBe(false)
  })

  it('hold a working time from a day for a person here, with the minutes of every weekday', () => {
    const { workingTimes } = peopleSchema()

    expect(getTableConfig(workingTimes).foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining(['working_times_of_a_person_here']),
    )
    expect(getTableConfig(workingTimes).indexes.map((each) => each.config.name)).toContain(
      'working_times_one_from_a_day',
    )
    expect(columnsOf(workingTimes)).toEqual(
      expect.arrayContaining([
        'person_id',
        'valid_from',
        'monday_minutes',
        'tuesday_minutes',
        'wednesday_minutes',
        'thursday_minutes',
        'friday_minutes',
        'saturday_minutes',
        'sunday_minutes',
      ]),
    )
  })
})
