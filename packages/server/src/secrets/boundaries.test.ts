import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The sealed credentials are read and written in one place.
 *
 * `secrets/` seals and opens them, and hands out the opened value only to the
 * code that asks for one purpose of one business. A route that read the table
 * itself could hand the sealed value to a browser, and a job that wrote it
 * itself could store it without the seal; the test names that before it
 * happens.
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

describe('the sealed credentials', () => {
  it('are touched in secrets/ and nowhere else', () => {
    const touching = codeFiles(source)
      .map((path) => ({
        path: relative(source, path).split(sep).join('/'),
        text: readFileSync(path, 'utf8'),
      }))
      // Whoever imports the table from the schema can read or write it.
      .filter((file) =>
        /import\s*\{[^}]*\bsecrets\b[^}]*\}\s*from\s*'[^']*schema\/index\.js'/.test(file.text),
      )
      .map((file) => file.path)

    // Found at all, or the test would pass by looking at nothing.
    expect(touching).toContain('secrets/store.ts')
    expect(
      touching.filter(
        (path) => !path.startsWith('secrets/') && !path.startsWith('database/schema/'),
      ),
    ).toEqual([])
  })
})
