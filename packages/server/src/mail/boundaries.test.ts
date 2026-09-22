import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * No module sends mail itself, section 2 of the concept and the last line of
 * the acceptance in #81.
 *
 * Two places are allowed and no third: `mail/` talks to the mail server, and
 * `notifications/` decides which message a cause becomes. A controller that
 * wanted a message sent would have to import one of the two things these tests
 * look for, and the test names it before a second sender, a second template
 * and a second place for a business's address have grown out of it.
 */

const source = fileURLToPath(new URL('..', import.meta.url))

function codeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return codeFiles(path)
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const files = codeFiles(source).map((path) => ({
  path: relative(source, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}))

function outside(paths: readonly string[], allowed: readonly string[]): string[] {
  return paths.filter((path) => !allowed.some((folder) => path.startsWith(folder)))
}

describe('sending mail', () => {
  it('happens in mail/ and nowhere else', () => {
    const importing = files
      .filter((file) => /from\s+['"]nodemailer/.test(file.text))
      .map((file) => file.path)

    // Found at all, or the test would pass by looking at nothing.
    expect(importing).toContain('mail/transport.ts')
    expect(outside(importing, ['mail/'])).toEqual([])
  })

  it('is asked for through the notifications, and nothing else writes a message', () => {
    const touching = files
      .filter((file) => /\bmailOutbox\b/.test(file.text))
      .map((file) => file.path)

    expect(touching).toContain('notifications/notify.ts')
    expect(outside(touching, ['mail/', 'notifications/', 'database/schema/'])).toEqual([])
  })
})
