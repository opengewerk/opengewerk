import { describe, expect, it } from 'vitest'

import {
  applicationRole,
  ConfigurationError,
  type Environment,
  migrationRole,
  readConfiguration,
} from './configuration.js'

/**
 * The configuration is the only thing between a deployment and a running
 * instance, and the mistakes it can make are the quiet kind: a wrong role
 * that works until two tenants notice each other, a port that silently
 * becomes 3000 while the proxy waits on 8080.
 */

const valid: Environment = {
  DATABASE_URL: `postgres://${applicationRole}:geheim@db:5432/opengewerk`,
}

describe('the configuration', () => {
  it('reads what an instance needs', () => {
    const configuration = readConfiguration({ ...valid, PORT: '8080', HOST: '127.0.0.1' })

    expect(configuration).toEqual({
      databaseUrl: `postgres://${applicationRole}:geheim@db:5432/opengewerk`,
      port: 8080,
      host: '127.0.0.1',
    })
  })

  it('binds every interface unless told otherwise, because a container has to', () => {
    expect(readConfiguration(valid).host).toBe('0.0.0.0')
  })

  it('listens on 3000 when no port is given', () => {
    expect(readConfiguration(valid).port).toBe(3000)
  })

  it('refuses to start without a database', () => {
    expect(() => readConfiguration({})).toThrow(ConfigurationError)
    expect(() => readConfiguration({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/)
  })

  it('refuses an address that is not a database address', () => {
    expect(() => readConfiguration({ DATABASE_URL: 'db 5432 opengewerk' })).toThrow(
      /Verbindungsadresse/,
    )
    expect(() => readConfiguration({ DATABASE_URL: 'mysql://user:pw@db:3306/opengewerk' })).toThrow(
      /PostgreSQL/,
    )
  })

  it('accepts either spelling of the postgres scheme', () => {
    const url = `postgresql://${applicationRole}:geheim@db:5432/opengewerk`

    expect(readConfiguration({ DATABASE_URL: url }).databaseUrl).toBe(url)
  })

  /**
   * The check this file exists for. Row level security never applies to a
   * superuser and applies to the owner of a table only through FORCE, so an
   * instance connecting as either has an isolation that looks like one and is
   * not. The failure is invisible until it is a data leak, which is why it
   * has to be a refusal at startup.
   */
  it('refuses to connect as a role that row level security would not apply to', () => {
    for (const role of ['postgres', migrationRole]) {
      expect(() =>
        readConfiguration({ DATABASE_URL: `postgres://${role}:geheim@db:5432/opengewerk` }),
      ).toThrow(new RegExp(role))
    }
  })

  it('refuses a port that is not one', () => {
    for (const port of ['0', '70000', 'achttausend', '80.5']) {
      expect(() => readConfiguration({ ...valid, PORT: port })).toThrow(ConfigurationError)
    }
  })
})
