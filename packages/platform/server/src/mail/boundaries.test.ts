import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// One sender. Nothing in the foundation talks to a mail server but the
// transport in `mail/transport.ts`, and an application imports that transport
// rather than nodemailer: one set of timeouts, one place where file and URL
// access are switched off, and one place to look when a message did not
// arrive.

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

describe('talking to a mail server', () => {
  it('happens in the transport and nowhere else', () => {
    const importing = codeFiles(source)
      .filter((path) => /from\s+['"]nodemailer/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(source, path).split(sep).join('/'))

    expect(importing).toEqual(['mail/transport.ts'])
  })
})
