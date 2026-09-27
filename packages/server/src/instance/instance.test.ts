import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { appointOperator, removeOperator } from './operators.js'
import {
  InstanceSettingsCache,
  readInstanceSettings,
  saveInstanceSettings,
  takeOverFromEnvironment,
} from './settings.js'

/**
 * The parts of the area of the instance (#188) that no route shows: what an
 * update takes over from the `.env`, how soon a change reaches the check on
 * every connection to a mail server, and the operator nobody can take away.
 */

let admin: Pool
let database: Database

beforeAll(async () => {
  admin = await connect()
  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

beforeEach(async () => {
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query(
    `insert into auth_users (id, name, email, two_factor_enabled)
     values ('olga', 'Olga Owner', 'olga@example.de', true),
            ('paul', 'Paul Plain', 'paul@example.de', true)`,
  )
  await admin.query(`insert into instance_operators (user_id) values ('olga')`)
})

describe('MAIL_INTERNAL_HOSTS from the .env', () => {
  it('is taken over once, next to what the operators set, and never again', async () => {
    await saveInstanceSettings(database, 'olga', { mailInternalHosts: ['mail.intern.example'] })

    expect(await takeOverFromEnvironment(database, ['192.168.1.20', 'mail.intern.example'])).toBe(
      true,
    )

    const taken = await readInstanceSettings(database)

    expect(taken.mailInternalHosts).toEqual(['mail.intern.example', '192.168.1.20'])
    expect(taken.takenOverAt).not.toBeNull()

    // A later start with another value changes nothing: the screen decides now.
    expect(await takeOverFromEnvironment(database, ['10.0.0.5'])).toBe(false)
    expect((await readInstanceSettings(database)).mailInternalHosts).toEqual([
      'mail.intern.example',
      '192.168.1.20',
    ])
  })

  it('takes nothing over while it is empty, and leaves the way open for a value set later', async () => {
    expect(await takeOverFromEnvironment(database, [])).toBe(false)
    expect((await readInstanceSettings(database)).takenOverAt).toBeNull()

    expect(await takeOverFromEnvironment(database, ['mail.lan'])).toBe(true)
    expect((await readInstanceSettings(database)).mailInternalHosts).toEqual(['mail.lan'])
  })

  it('stands in the log of the instance as taken from the environment, by nobody', async () => {
    await takeOverFromEnvironment(database, ['mail.lan'])

    const { rows } = await admin.query<{ user_id: string | null; reason: string | null }>(
      `select user_id, reason from instance_changes
        where table_name = 'instance_settings' and field = 'mail_internal_hosts'
          and operation = 'update'`,
    )

    expect(rows).toEqual([{ user_id: null, reason: 'environment' }])
  })
})

describe('the settings in memory', () => {
  it('follow a change on the next refresh, and settings that never change never ask', async () => {
    const cache = await InstanceSettingsCache.load(database)

    expect(cache.current().backupTime).toBe('02:30')

    await saveInstanceSettings(database, 'olga', { backupTime: '04:15' })
    expect(cache.current().backupTime).toBe('02:30')

    await cache.refresh()
    expect(cache.current().backupTime).toBe('04:15')

    const fixed = InstanceSettingsCache.fixed({
      mailInternalHosts: ['mail.lan'],
      backupTime: '02:30',
      takenOverAt: null,
    })

    await fixed.refresh()
    expect(fixed.current().mailInternalHosts).toEqual(['mail.lan'])
  })
})

describe('the operators', () => {
  it('keep the last one, also when two take each other out at the same moment', async () => {
    await appointOperator(database, 'olga', 'paul@example.de')

    // Both passed the door while both were operators; the second to get the
    // lock finds itself alone with the one it wants to remove.
    await removeOperator(database, 'olga', 'paul')
    await expect(removeOperator(database, 'paul', 'olga')).rejects.toThrow(
      'Der letzte Betreiber bleibt.',
    )

    const { rows } = await admin.query<{ user_id: string }>(
      'select user_id from instance_operators',
    )

    expect(rows.map((row) => row.user_id)).toEqual(['olga'])
  })

  it('name the way in the log of the instance, the command line with nobody signed in', async () => {
    // As `appoint-operator` calls it: there is no account at a shell.
    await appointOperator(database, '', 'paul@example.de', 'operator.cli')

    const { rows } = await admin.query<{
      user_id: string | null
      reason: string | null
      new_value: string
    }>(
      `select user_id, reason, new_value from instance_changes
        where table_name = 'instance_operators' and field = 'user_id' and new_value = 'paul'`,
    )

    expect(rows).toEqual([{ user_id: null, reason: 'operator.cli', new_value: 'paul' }])
  })
})
