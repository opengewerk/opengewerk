import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function uuidv7Version(packageJson: string): string | undefined {
  const manifest = JSON.parse(readFileSync(new URL(packageJson, import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
  }

  return manifest.dependencies?.['uuidv7']
}

/**
 * Server and browser mint keys each on their own side, because `domain` stays
 * free of randomness (#151). What keeps them from drifting apart is that every
 * place that mints one uses the same library in the same version: the
 * foundation, which mints for the server since ADR 0010, the server where it
 * still mints for itself, and the browser.
 */
describe('a key minted at the edge', () => {
  it('comes from the same library wherever one is made', () => {
    const foundation = uuidv7Version('../../../platform/server/package.json')
    const server = uuidv7Version('../../package.json')
    const browser = uuidv7Version('../../../web/package.json')

    expect(foundation).toBeDefined()
    expect(server).toBe(foundation)
    expect(browser).toBe(foundation)
  })
})
