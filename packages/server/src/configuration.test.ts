import { applicationRoleName, type Environment } from '@opengewerk/platform-server'
import { describe, expect, it } from 'vitest'

import { application, readConfiguration } from './configuration.js'
import { readRendererConfiguration } from './documents/renderer.js'

// The checks themselves are the foundation's and are tested there, against an
// application of their own. What is held here is what this application hands
// in: its name, its port, the variable its version arrives in.

const valid: Environment = {
  DATABASE_URL: `postgres://${applicationRoleName}:geheim@db:5432/opengewerk`,
  STORAGE_PATH: '/var/lib/opengewerk/storage',
  SESSION_SECRET: 'a'.repeat(64),
  TRUSTED_ORIGINS: 'https://opengewerk.example.de',
}

/** Every directory is fine, so that the other checks are what fails. */
const writable = () => null

describe('the configuration of this application', () => {
  it('listens on 23700 when no port is given, far from the 3000 everything else takes', () => {
    expect(application.port).toBe(23700)
    expect(readConfiguration(valid, writable).port).toBe(23700)
    expect(readConfiguration({ ...valid, PORT: '8080' }, writable).port).toBe(8080)
  })

  /**
   * Handed over by the Compose file, where a release kit carries its version
   * in place of "source" (#259).
   */
  it('reads its version from OPENGEWERK_VERSION', () => {
    expect(readConfiguration({ ...valid, OPENGEWERK_VERSION: '0.4.0' }, writable).version).toBe(
      '0.4.0',
    )
    expect(readConfiguration({ ...valid, OPENGEWERK_VERSION: 'source' }, writable).version).toBe(
      null,
    )
  })

  it('says its own name where a sentence needs one', () => {
    expect(() => readConfiguration({ ...valid, SESSION_SECRET: undefined }, writable)).toThrow(
      'Ohne sie startet OpenGewerk nicht.',
    )
    expect(() =>
      readConfiguration({ ...valid, DATABASE_URL: 'db 5432 opengewerk' }, writable),
    ).toThrow('postgres://benutzer:passwort@host:5432/opengewerk')
    expect(() =>
      readConfiguration({ ...valid, TRUSTED_ORIGINS: 'opengewerk.example.de' }, writable),
    ).toThrow('etwa https://opengewerk.example.de')
  })

  /**
   * The renderer reads its own two variables and refuses a placeholder of the
   * template like every other key: the same sentence, from the same check.
   */
  it('refuses a placeholder of the template for the renderer as well', () => {
    expect(() => readRendererConfiguration({ RENDERER_TOKEN: 'bitte-ersetzen-4' })).toThrow(
      /RENDERER_TOKEN enthält noch einen Platzhalter/,
    )
  })
})
