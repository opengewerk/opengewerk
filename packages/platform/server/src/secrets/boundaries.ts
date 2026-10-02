import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// The sealed credentials are read and written in one place, the store. A
// route that read the table itself could hand the sealed value to a browser,
// and a job that wrote it itself could store a value without the seal. This
// names the files of an application that could do either, so that a test of
// the application holds the list to the folder its store lives in, before it
// happens rather than after.

/** The code of an application under a folder, without its tests. */
function codeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return codeFiles(path)
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const schemaModule = "'[^']*schema(?:/[^']*)?'"

/** `import { ..., secrets, ... } from '.../schema/...'`, on one line or over several. */
const named = new RegExp(
  `import\\s+(?:type\\s+)?\\{[^}]*\\bsecrets\\b[^}]*\\}\\s*from\\s*${schemaModule}`,
)

/** `import * as schema from '.../schema/...'`, which reaches every table through the name. */
const namespace = new RegExp(`import\\s*\\*\\s*as\\s+(\\w+)\\s+from\\s*${schemaModule}`, 'g')

/**
 * The text without its comments. An import written out in a comment imports
 * nothing, and this file has one.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function touches(text: string): boolean {
  const statements = code(text)

  if (named.test(statements)) {
    return true
  }

  return [...statements.matchAll(namespace)].some((match) =>
    new RegExp(`\\b${match[1] ?? ''}\\.secrets\\b`).test(statements),
  )
}

/**
 * The files under a source folder that import the table of sealed
 * credentials from the schema, and so can read or write it. Paths relative to
 * the folder, with forward slashes.
 *
 * An application holds the answer to its store and its schema. Whatever else
 * turns up is a second place that touches the sealed values.
 */
export function secretsTouchedIn(sourceFolder: string): string[] {
  return codeFiles(sourceFolder)
    .filter((path) => touches(readFileSync(path, 'utf8')))
    .map((path) => relative(sourceFolder, path).split(sep).join('/'))
    .sort()
}
