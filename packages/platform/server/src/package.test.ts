import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }

// ADR 0010 makes the direction of the dependency a property of the package
// graph: the foundation depends on no package of an application. An import the
// wrong way round then fails as a missing module, and the lint rule beside it
// says which rule that is. Both hold only as long as nobody enters such a
// dependency here, which is one line in a manifest and looks harmless in a
// diff. This is the test for that line.
const sections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

function declared(): readonly string[] {
  const read = manifest as Readonly<Record<string, unknown>>

  return sections.flatMap((section) =>
    Object.keys((read[section] ?? {}) as Readonly<Record<string, unknown>>),
  )
}

describe('the server side of the foundation', () => {
  it('depends on no package of an application', () => {
    const fromTheOrganisation = declared().filter((name) => name.startsWith('@opengewerk/'))

    expect(fromTheOrganisation.filter((name) => !name.startsWith('@opengewerk/platform-'))).toEqual(
      [],
    )
  })

  it('stands on the part of the foundation that computes, and not on the interface', () => {
    // `platform-web` is built for a browser. A server that depended on it
    // would pull the DOM in underneath itself.
    expect(declared().filter((name) => name.startsWith('@opengewerk/platform-'))).toEqual([
      '@opengewerk/platform-domain',
    ])
  })
})

// A dependency is one way of knowing an application. The other is quieter: its
// name in a sentence, or one of its roles in a comparison. Both compile, both
// pass every test of that application, and both are wrong for the next one,
// whose people would read a stranger's name in their authenticator app or
// find that the role leading their tenants is one this code never heard of.
// So what an application is called and which roles it has come in as
// arguments (`ServerApplication`, `AccessRules`), and this holds the line.

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** A line of a file of the package, with where it stands. */
interface Line {
  readonly file: string
  readonly number: number
  readonly text: string
}

function filesUnder(folder: string, extension: string): string[] {
  return readdirSync(join(packageRoot, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name))
}

/**
 * What an instance runs and what a migration is put together from: the
 * sources without the tests and without the application the tests bring
 * along, and the SQL building blocks.
 */
function shipped(): string[] {
  const code = filesUnder('src', '.ts').filter((file) => {
    const name = file.split(sep).at(-1) ?? ''

    return !name.endsWith('.test.ts') && !name.startsWith('probe-')
  })

  return [...code, ...filesUnder('sql', '.sql')]
}

function linesOf(file: string): Line[] {
  const name = relative(packageRoot, file).split(sep).join('/')

  return readFileSync(file, 'utf8')
    .split('\n')
    .map((text, index) => ({ file: name, number: index + 1, text }))
}

/** Whether a line is a comment from its first character on, in TypeScript or in SQL. */
function isComment(line: Line): boolean {
  const text = line.text.trimStart()

  return (
    text.startsWith('//') || text.startsWith('/*') || text.startsWith('*') || text.startsWith('--')
  )
}

function found(lines: readonly Line[]): string[] {
  return lines.map((line) => `${line.file}:${String(line.number)}: ${line.text.trim()}`)
}

/**
 * The name of an application of the organisation, the way a person reads it.
 * In small letters it is the organisation, and stands in the name of this
 * package and of the database roles; that is not what this looks for.
 */
const productName = /OpenGewerk/

/**
 * The roles of the trades application, the one whose roles have stood in this
 * code: as a string of their own, which is how a role is compared and stored,
 * and by the labels a person reads. The word for who owns a table is the same
 * as one of them and is everywhere in the comments, which is why only a
 * string counts.
 */
const roleLiteral = /(['"`])(?:owner|office|technician)\1/
const roleLabel = /\b(?:Inhaber|Monteur)\b/

describe('what the foundation knows of an application', () => {
  const lines = shipped().flatMap(linesOf)

  it('is looked for in the whole package', () => {
    const files = new Set(lines.map((line) => line.file))

    // The authentication, where all three used to stand, and a building block.
    expect(files).toContain('src/authentication/authentication.ts')
    expect(files).toContain('src/authentication/setup.ts')
    expect(files).toContain('sql/setup.sql')
    expect(files.has('src/authentication/probe-application.ts')).toBe(false)
    expect(files.size).toBeGreaterThan(50)
  })

  it('is not its name: no product is named anywhere, not even in a comment', () => {
    expect(found(lines.filter((line) => productName.test(line.text)))).toEqual([])
  })

  it('is not one of its roles: none stands as a string, and no label of one in a sentence', () => {
    const code = lines.filter((line) => !isComment(line))

    expect(
      found(code.filter((line) => roleLiteral.test(line.text) || roleLabel.test(line.text))),
    ).toEqual([])
  })

  it('would notice either, as the patterns are written', () => {
    // The patterns against lines of the kind that used to be here, so that a
    // pattern that matches nothing is not mistaken for a clean package.
    expect(productName.test("    appName: 'OpenGewerk',")).toBe(true)
    expect(productName.test("const applicationRoleName = 'opengewerk_app'")).toBe(false)

    expect(roleLiteral.test("const firstRoles: readonly RoleKey[] = ['owner']")).toBe(true)
    expect(roleLiteral.test('sql`${memberships.roles} @> ARRAY["owner"]::text[]`')).toBe(true)
    expect(roleLiteral.test("    if (roles.includes('office')) {")).toBe(true)
    expect(roleLiteral.test("export const migrationRole = 'opengewerk_owner'")).toBe(false)
    expect(roleLiteral.test(' * which runs as the owner of the tables')).toBe(false)

    expect(roleLabel.test("'Der Inhaber kann ihn wieder freigeben.'")).toBe(true)
    expect(roleLabel.test("'Für diese Rolle ist ein zweiter Faktor Pflicht.'")).toBe(false)
  })
})
