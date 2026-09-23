import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { isUuid, newId } from './identifier.js'

function uuidv7Version(packageJson: string): string | undefined {
  const manifest = JSON.parse(readFileSync(new URL(packageJson, import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
  }

  return manifest.dependencies?.['uuidv7']
}

describe('a key minted at the edge', () => {
  it('is a UUIDv7, sorted by the moment it was made', () => {
    const first = newId<'probe'>()
    const second = newId<'probe'>()

    expect(isUuid(first)).toBe(true)
    // The version sits in the first digit of the third group.
    expect(first.split('-')[2]?.[0]).toBe('7')
    expect(first < second).toBe(true)
  })

  /**
   * Server and browser mint keys each on their own side, because `domain`
   * stays free of randomness (#151). What keeps the two from drifting apart is
   * that both use the same library in the same version.
   */
  it('comes from the same library in the server and in the browser', () => {
    const server = uuidv7Version('../../package.json')
    const browser = uuidv7Version('../../../web/package.json')

    expect(server).toBeDefined()
    expect(browser).toBe(server)
  })
})
