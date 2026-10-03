import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }

// Vitest reads `import.meta.glob` the way vite does. Its type comes with the
// client types of vite, which this package does not load and should not: it
// computes, and runs in no bundler and on no page (ADR 0009). The one form
// this test uses is declared here, for this test.
declare global {
  interface ImportMeta {
    glob(
      patterns: readonly string[],
      options: { readonly query: '?raw'; readonly eager: true; readonly import: 'default' },
    ): Readonly<Record<string, string>>
  }
}

/** What the package hands to the server and to both entries, without the tests. */
const shipped = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  eager: true,
  import: 'default',
})

/** An import for its effect alone: no name is taken from the module. */
const sideEffectImport = /^\s*import\s+['"]/

describe('the package', () => {
  /**
   * The service worker takes one list from this package, the paths of the
   * server (#12), and each entry point takes what its screens need. Unless a
   * package says that loading its modules does nothing, a bundler has to keep
   * every module that computes something at its top, and through the entry of
   * the package that is nearly every one: the worker grew from 20 to 71 kB
   * with the wording of the instructions, and the site carried that wording
   * too, without showing a word of it.
   */
  it('says that loading one of its modules does nothing', () => {
    expect(manifest.sideEffects).toBe(false)
  })

  /**
   * What the manifest says of every module has to be true of every module.
   * An import without a name is one made for what loading the module does,
   * and a bundler that was told there is no such thing may leave it out.
   */
  it('imports no module for what loading it does', () => {
    const files = Object.keys(shipped)
    const found = Object.entries(shipped).flatMap(([file, text]) =>
      text
        .split('\n')
        .flatMap((line, index) =>
          sideEffectImport.test(line) ? [`${file}:${String(index + 1)}: ${line.trim()}`] : [],
        ),
    )

    expect(files).toContain('./index.ts')
    expect(files).toContain('./model/server-paths.ts')
    expect(files).toContain('./rules/instructions.ts')
    expect(files.length).toBeGreaterThanOrEqual(50)
    expect(found).toEqual([])
    expect(sideEffectImport.test("import './register.js'")).toBe(true)
    expect(sideEffectImport.test("import { serverPaths } from './model/server-paths.js'")).toBe(
      false,
    )
  })
})
