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

const secret = 'a'.repeat(64)

const valid: Environment = {
  DATABASE_URL: `postgres://${applicationRole}:geheim@db:5432/opengewerk`,
  STORAGE_PATH: '/var/lib/opengewerk/storage',
  SESSION_SECRET: secret,
  TRUSTED_ORIGINS: 'https://opengewerk.example.de',
}

/** Every directory is fine, so that the other checks are what fails. */
const writable: AccessCheck = () => null

/** The valid environment minus one variable, to see what its absence does. */
function without(name: keyof typeof valid): Environment {
  const environment = { ...valid }
  delete environment[name]

  return environment
}

describe('the configuration', () => {
  it('reads what an instance needs', () => {
    const configuration = readConfiguration({ ...valid, PORT: '8080', HOST: '127.0.0.1' }, writable)

    expect(configuration).toEqual({
      databaseUrl: `postgres://${applicationRole}:geheim@db:5432/opengewerk`,
      storagePath: '/var/lib/opengewerk/storage',
      sessionSecret: secret,
      trustedOrigins: ['https://opengewerk.example.de'],
      closed: false,
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

  it('refuses to start without a cookie secret, and without a short one', () => {
    expect(() => readConfiguration(without('SESSION_SECRET'), writable)).toThrow(/SESSION_SECRET/)
    // Long enough to look deliberate, short enough to be somebody typing.
    expect(() =>
      readConfiguration({ ...valid, SESSION_SECRET: 'geheimes-passwort-1' }, writable),
    ).toThrow(/mindestens 32 Zeichen/)
  })

  /**
   * The origin list is the CSRF defence, so the ways it can be present and
   * useless matter more than the way it can be absent. A trailing slash is the
   * one somebody writes without thinking: it never matches what a browser puts
   * in the Origin header, so the entry looks configured and protects nothing.
   */
  it('refuses an origin list that would never match a browser', () => {
    expect(() => readConfiguration(without('TRUSTED_ORIGINS'), writable)).toThrow(/TRUSTED_ORIGINS/)
    expect(() =>
      readConfiguration({ ...valid, TRUSTED_ORIGINS: 'https://opengewerk.example.de/' }, writable),
    ).toThrow(/ohne Pfad/)
    expect(() =>
      readConfiguration(
        { ...valid, TRUSTED_ORIGINS: 'https://opengewerk.example.de/app' },
        writable,
      ),
    ).toThrow(/ohne Pfad/)
    expect(() =>
      readConfiguration({ ...valid, TRUSTED_ORIGINS: 'opengewerk.example.de' }, writable),
    ).toThrow(/gültige Adresse/)
  })

  it('takes several origins, because an instance can answer under more than one name', () => {
    const configuration = readConfiguration(
      {
        ...valid,
        TRUSTED_ORIGINS: 'https://opengewerk.example.de, https://app.example.de:8443',
      },
      writable,
    )

    expect(configuration.trustedOrigins).toEqual([
      'https://opengewerk.example.de',
      'https://app.example.de:8443',
    ])
  })

  /**
   * A flag that opens or closes an instance is one where a typo must not be
   * read as "no". `CLOSED=ture` meaning false would be the quiet kind of
   * mistake this whole file exists to prevent.
   */
  it('reads the closed flag strictly, so that a typo is not silently a no', () => {
    expect(readConfiguration(valid, writable).closed).toBe(false)
    expect(readConfiguration({ ...valid, CLOSED: 'true' }, writable).closed).toBe(true)
    expect(readConfiguration({ ...valid, CLOSED: '1' }, writable).closed).toBe(true)
    expect(readConfiguration({ ...valid, CLOSED: 'false' }, writable).closed).toBe(false)
    expect(() => readConfiguration({ ...valid, CLOSED: 'ture' }, writable)).toThrow(/CLOSED/)
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
