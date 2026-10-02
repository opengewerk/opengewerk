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

describe('the interface of the foundation', () => {
  it('depends on no package of an application', () => {
    const fromTheOrganisation = declared().filter((name) => name.startsWith('@opengewerk/'))

    expect(fromTheOrganisation.filter((name) => !name.startsWith('@opengewerk/platform-'))).toEqual(
      [],
    )
  })

  it('stands on the part of the foundation that computes at most, and never on the server', () => {
    // `platform-server` is built for Node. An interface that depended on it
    // would pull a database driver into a browser.
    expect(
      declared().filter(
        (name) =>
          name.startsWith('@opengewerk/platform-') && name !== '@opengewerk/platform-domain',
      ),
    ).toEqual([])
  })

  it('is handed to an application as source, with its stylesheets beside it', () => {
    // An application compiles this package with its own screens. An entry
    // that pointed at a build would be one nobody makes.
    expect(manifest.exports).toEqual({
      '.': './src/index.ts',
      './format': './src/format.ts',
      './gate': './src/gate/index.ts',
      './instance': './src/instance/index.ts',
      './office': './src/office/index.ts',
      './session': './src/session/index.ts',
      './shell': './src/shell/index.ts',
      './site': './src/site/index.ts',
      './sync': './src/sync/index.ts',
      './testing': './src/testing.ts',
      './styles/index.css': './src/styles/index.css',
      './styles/tokens.css': './src/styles/tokens.css',
    })
  })

  /**
   * An entry of this package hands on many modules, and an application takes
   * a few of them from each of its own entry points. Unless a package says
   * that loading its modules does nothing, a bundler has to assume it does
   * something, and puts every module that both entry points can reach into
   * what both load. That is how the office came to load the frame of the
   * site: a component both share takes one piece from the same entry. The
   * build was green and the budget held; only the chunks showed it.
   */
  it('says that loading one of its modules does nothing, a stylesheet apart', () => {
    expect(manifest.sideEffects).toEqual(['**/*.css'])
  })
})

// A dependency is one way of knowing an application. The other is quieter: its
// name on a screen, its word for a tenant in a sentence, one of its records in
// a list. All of them compile, all pass every test of that application, and
// all are wrong for the next one, whose people would read a stranger's name
// in the header or a word for their organisation that is not theirs. So what
// an application is called and what its things are called come in as
// arguments, and this holds the line.

/** What an entry point loads: the sources and the stylesheets, without the tests. */
const shipped = import.meta.glob(['./**/*.{ts,tsx,css}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Readonly<Record<string, string>>

interface Line {
  readonly file: string
  readonly number: number
  readonly text: string
}

function linesOf(file: string, text: string): Line[] {
  return text.split('\n').map((line, index) => ({ file, number: index + 1, text: line }))
}

/**
 * The text with its comments blanked, line for line, so that what is left
 * still stands on the line it stood on. Block comments in both languages, and
 * the comment a line of TypeScript ends in.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

function found(lines: readonly Line[]): string[] {
  return lines.map((line) => `${line.file}:${String(line.number)}: ${line.text.trim()}`)
}

const everything = Object.entries(shipped).flatMap(([file, text]) => linesOf(file, text))
const outsideComments = Object.entries(shipped).flatMap(([file, text]) =>
  linesOf(file, withoutComments(text)),
)

/**
 * The name of an application of the organisation, the way a person reads it.
 * In small letters it is the organisation, and stands in the name of this
 * package; that is not what this looks for.
 */
const productName = /OpenGewerk/

/**
 * What an application calls a tenant, whoever leads one and whoever runs an
 * instance, in a sentence a person reads. These are the words of the trades
 * application and, for the second, of the next one: set into a sentence of
 * the foundation, either would be wrong in one of them.
 */
const tenantWord = /\b(?:Betrieb|Betriebs|Betriebe|Betrieben|Betreiber|Betreibers|Betreibern)\b/
const roleLabel = /\b(?:Inhaber|Inhabers|Monteur|Monteurs|Monteure)\b/

/**
 * Where the people of the trades application work when they are not at a
 * desk. Its second entry is named after that place, and the next application
 * names its own after another.
 */
const entryWord = /\b(?:Baustelle|Baustellen)\b/

/**
 * The records of the trades application, the one whose screens were built
 * from this code: by the names its tables go by, as a string of their own,
 * and by the words a person reads for them.
 */
const recordLiteral =
  /(['"`])(?:customers|sites|installations|jobs|documents|document_lines|tasks|contacts|suppliers|articles|time_entries|attachments)\1/
const recordWord =
  /\b(?:Kunde|Kunden|Beleg|Belege|Belegs|Rechnung|Rechnungen|Angebot|Angebote|Auftrag|Aufträge|Auftrags|Regiebericht|Regieberichte)\b/

/** An import for its effect alone: no name is taken from the module. */
const sideEffectImport = /^\s*import\s+['"]/

describe('what the interface of the foundation knows of an application', () => {
  it('is looked for in the whole package', () => {
    const files = Object.keys(shipped)

    expect(files).toContain('./index.ts')
    expect(files).toContain('./components/button.tsx')
    expect(files).toContain('./sync/client.ts')
    expect(files).toContain('./session/session.ts')
    expect(files).toContain('./gate/boot.tsx')
    expect(files).toContain('./gate/sign-in.tsx')
    expect(files).toContain('./office/list.tsx')
    expect(files).toContain('./office/staff.tsx')
    expect(files).toContain('./instance/frame.tsx')
    expect(files).toContain('./site/kit.tsx')
    expect(files).toContain('./shell/suggestion.tsx')
    expect(files).toContain('./format.ts')
    expect(files).toContain('./styles/tokens.css')
    expect(files.filter((file) => file.includes('.test.'))).toEqual([])
    expect(files.length).toBeGreaterThanOrEqual(15)
  })

  it('is not its name: no product is named anywhere, not even in a comment', () => {
    expect(found(everything.filter((line) => productName.test(line.text)))).toEqual([])
  })

  it('is not its word for a tenant, for who leads one or for where its people work: no sentence says any', () => {
    expect(
      found(
        outsideComments.filter(
          (line) =>
            tenantWord.test(line.text) || roleLabel.test(line.text) || entryWord.test(line.text),
        ),
      ),
    ).toEqual([])
  })

  it('is not one of its records: none is named as a string, and none in a sentence', () => {
    expect(
      found(
        outsideComments.filter(
          (line) => recordLiteral.test(line.text) || recordWord.test(line.text),
        ),
      ),
    ).toEqual([])
  })

  /**
   * What the manifest says of every module has to be true of every module.
   * An import without a name is one made for what loading the module does,
   * and a bundler that was told there is no such thing may leave it out.
   */
  it('imports no module for what loading it does', () => {
    expect(found(outsideComments.filter((line) => sideEffectImport.test(line.text)))).toEqual([])
    expect(sideEffectImport.test("import 'fake-indexeddb/auto'")).toBe(true)
    expect(sideEffectImport.test("import { Button } from './button.js'")).toBe(false)
    expect(sideEffectImport.test("import type { Entry } from './surface.js'")).toBe(false)
  })

  it('would notice any of them, as the patterns are written', () => {
    // The patterns against lines of the kind that stand in an application, so
    // that a pattern that matches nothing is not mistaken for a clean package.
    expect(productName.test('<title>OpenGewerk</title>')).toBe(true)
    expect(productName.test("import { Button } from '@opengewerk/platform-web'")).toBe(false)

    expect(tenantWord.test("'Dieser Zugang ist im Betrieb gesperrt.'")).toBe(true)
    expect(tenantWord.test("'Den Betreiber gibt es nicht.'")).toBe(true)
    expect(tenantWord.test("'Die Betriebsart steht in den Einstellungen.'")).toBe(false)
    expect(roleLabel.test("'Der Inhaber vergibt die Rollen.'")).toBe(true)
    expect(roleLabel.test("'Die Leitung vergibt die Rollen.'")).toBe(false)
    expect(entryWord.test('<a href="/m">Zur Baustelle</a>')).toBe(true)
    expect(entryWord.test('<a href="/m">Unterwegs</a>')).toBe(false)

    expect(recordLiteral.test("if (entity === 'customers') {")).toBe(true)
    expect(recordLiteral.test('queryKey: ["document_lines", id]')).toBe(true)
    expect(recordLiteral.test('const customers = rows.length')).toBe(false)
    expect(recordWord.test("'Der Beleg ist festgeschrieben.'")).toBe(true)
    expect(recordWord.test("'Dieser Vorgang wurde abgelehnt.'")).toBe(false)
  })

  it('reads a sentence and not a comment, in a script and in a stylesheet', () => {
    const script = "// im Betrieb\nconst a = 'x' // der Inhaber\n/**\n * Kunde\n */\nconst b = 1"
    const sheet = '/* Leisten im\n   Betrieb */\n.a { color: red; }'

    expect(
      withoutComments(script)
        .split('\n')
        .map((line) => line.trim()),
    ).toEqual(['', "const a = 'x'", '', '', '', 'const b = 1'])
    expect(
      withoutComments(sheet)
        .split('\n')
        .map((line) => line.trim()),
    ).toEqual(['', '', '.a { color: red; }'])
    // An address in a string is not a comment.
    expect(withoutComments("const u = 'https://example.de/x'")).toBe(
      "const u = 'https://example.de/x'",
    )
  })
})
