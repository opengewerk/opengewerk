import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type AccessCheck,
  applicationRole,
  ConfigurationError,
  directoryIsWritable,
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
  STORAGE_PATH: '/var/lib/opengewerk/storage',
}

/** Every directory is fine, so that the other checks are what fails. */
const writable: AccessCheck = () => null

describe('the configuration', () => {
  it('reads what an instance needs', () => {
    const configuration = readConfiguration({ ...valid, PORT: '8080', HOST: '127.0.0.1' }, writable)

    expect(configuration).toEqual({
      databaseUrl: `postgres://${applicationRole}:geheim@db:5432/opengewerk`,
      storagePath: '/var/lib/opengewerk/storage',
      port: 8080,
      host: '127.0.0.1',
    })
  })

  it('binds every interface unless told otherwise, because a container has to', () => {
    expect(readConfiguration(valid, writable).host).toBe('0.0.0.0')
  })

  it('listens on 3000 when no port is given', () => {
    expect(readConfiguration(valid, writable).port).toBe(3000)
  })

  it('refuses to start without a database', () => {
    expect(() => readConfiguration({}, writable)).toThrow(ConfigurationError)
    expect(() => readConfiguration({ ...valid, DATABASE_URL: '   ' }, writable)).toThrow(
      /DATABASE_URL/,
    )
  })

  it('refuses an address that is not a database address', () => {
    expect(() =>
      readConfiguration({ ...valid, DATABASE_URL: 'db 5432 opengewerk' }, writable),
    ).toThrow(/Verbindungsadresse/)
    expect(() =>
      readConfiguration({ ...valid, DATABASE_URL: 'mysql://user:pw@db:3306/opengewerk' }, writable),
    ).toThrow(/PostgreSQL/)
  })

  it('accepts either spelling of the postgres scheme', () => {
    const url = `postgresql://${applicationRole}:geheim@db:5432/opengewerk`

    expect(readConfiguration({ ...valid, DATABASE_URL: url }, writable).databaseUrl).toBe(url)
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
        readConfiguration(
          { ...valid, DATABASE_URL: `postgres://${role}:geheim@db:5432/opengewerk` },
          writable,
        ),
      ).toThrow(new RegExp(role))
    }
  })

  it('refuses a port that is not one', () => {
    for (const port of ['0', '70000', 'achttausend', '80.5']) {
      expect(() => readConfiguration({ ...valid, PORT: port }, writable)).toThrow(
        ConfigurationError,
      )
    }
  })
})

describe('the file store', () => {
  it('has to be named, because there is no sensible default for it', () => {
    const withoutStorage = { ...valid, STORAGE_PATH: undefined }

    expect(() => readConfiguration(withoutStorage, writable)).toThrow(/STORAGE_PATH/)
  })

  /**
   * The check that earns its keep. A wrong mount and a missing permission look
   * identical from outside: the instance starts and serves every page, right
   * up to the first upload. Refusing at startup costs a restart; finding out
   * later costs the photo somebody took on a roof.
   */
  it('refuses to start when it cannot be written to', () => {
    const denied: AccessCheck = () => 'permission denied'

    expect(() => readConfiguration(valid, denied)).toThrow(ConfigurationError)
    expect(() => readConfiguration(valid, denied)).toThrow(/permission denied/)
    expect(() => readConfiguration(valid, denied)).toThrow(/\/var\/lib\/opengewerk\/storage/)
  })

  /**
   * Against the real file system, because the interesting part of this check
   * is what the operating system answers, and a stub would only repeat what
   * the test already assumes.
   */
  it('really looks at the file system, not only at a stub', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'opengewerk-storage-'))

    try {
      expect(directoryIsWritable(temporary)).toBeNull()
      expect(directoryIsWritable(join(temporary, 'gibt-es-nicht'))).toMatch(/ENOENT/)

      // The same message on Linux and on Windows. Asking about permissions
      // first would give EACCES on one and pass on the other, and a wrong
      // mount would then be reported differently depending on the machine.
      const file = join(temporary, 'keine-mappe')
      writeFileSync(file, 'x')
      expect(directoryIsWritable(file)).toBe('es ist kein Verzeichnis')
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})
