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

describe('the foundation', () => {
  it('depends on no package of an application', () => {
    const fromTheOrganisation = declared().filter((name) => name.startsWith('@opengewerk/'))

    expect(fromTheOrganisation.filter((name) => !name.startsWith('@opengewerk/platform-'))).toEqual(
      [],
    )
  })

  it('is the bottom layer of the foundation and depends on none of its other layers', () => {
    // `platform-server` and `platform-web` build on this package. The other
    // direction would put Node or the DOM underneath code that has to run on
    // both sides.
    expect(declared().filter((name) => name.startsWith('@opengewerk/'))).toEqual([])
  })

  /**
   * The service worker of an application takes one list from this package,
   * the paths of the foundation (#12). Unless a package says that loading its
   * modules does nothing, a bundler has to keep every module that computes
   * something at its top, and through the entry of the package that can be
   * every one of them.
   */
  it('says that loading one of its modules does nothing', () => {
    expect(manifest.sideEffects).toBe(false)
  })
})

// A dependency is one way of knowing an application. The other is quieter: its
// name in a sentence, its word for a tenant, one of its roles or its records
// as a string. All of them compile, all pass every test of that application,
// and all are wrong for the next one, which reads this package on both sides,
// in its server and on its pages. So what an application is called and what
// its things are called come in as arguments, and this holds the line.

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

/** What the package hands to an application, its testing entry included, without the tests. */
const shipped = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  eager: true,
  import: 'default',
})

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
 * still stands on the line it stood on: block comments, and the comment a
 * line ends in.
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
 * package and in the header a page names its tenant in; that is not what
 * this looks for.
 */
const productName = /OpenGewerk/

/**
 * What an application calls a tenant, whoever leads one and whoever runs an
 * instance: the words of the trades application and, for the second, of the
 * next one. Set into a sentence of the foundation, either would be wrong in
 * one of them.
 */
const tenantWord = /\b(?:Betrieb|Betriebs|Betriebe|Betrieben|Betreiber|Betreibers|Betreibern)\b/
const roleLabel = /\b(?:Inhaber|Inhabers|Monteur|Monteurs|Monteure)\b/

/**
 * The roles of the trades application as a string of their own, which is how
 * a role is compared and stored. The word for who owns a table is the same as
 * one of them and stands in comments, which is why only a string counts.
 */
const roleLiteral = /(['"`])(?:owner|office|technician)\1/

/**
 * The records of the trades application: by the names its tables go by, as a
 * string of their own, and by the words a person reads for them.
 */
const recordLiteral =
  /(['"`])(?:customers|sites|installations|jobs|documents|document_lines|tasks|contacts|suppliers|articles|time_entries|attachments)\1/
const recordWord =
  /\b(?:Kunde|Kunden|Beleg|Belege|Belegs|Rechnung|Rechnungen|Angebot|Angebote|Auftrag|Aufträge|Auftrags|Regiebericht|Regieberichte)\b/

/** An import for its effect alone: no name is taken from the module. */
const sideEffectImport = /^\s*import\s+['"]/

describe('what the foundation without I/O knows of an application', () => {
  it('is looked for in the whole package', () => {
    const files = Object.keys(shipped)

    expect(files).toContain('./index.ts')
    expect(files).toContain('./testing.ts')
    expect(files).toContain('./model/identity.ts')
    expect(files).toContain('./model/paths.ts')
    expect(files).toContain('./model/rights.ts')
    expect(files).toContain('./sync/rules.ts')
    expect(files).toContain('./sync/probe-policies.ts')
    expect(files).toContain('./rules/rule.ts')
    expect(files.filter((file) => file.includes('.test.'))).toEqual([])
    expect(files.length).toBeGreaterThanOrEqual(15)
  })

  it('is not its name: no product is named anywhere, not even in a comment', () => {
    expect(found(everything.filter((line) => productName.test(line.text)))).toEqual([])
  })

  it('is not its word for a tenant or for who leads one: no sentence says either', () => {
    expect(
      found(
        outsideComments.filter((line) => tenantWord.test(line.text) || roleLabel.test(line.text)),
      ),
    ).toEqual([])
  })

  it('is not one of its roles or its records: none stands as a string, and none in a sentence', () => {
    expect(
      found(
        outsideComments.filter(
          (line) =>
            roleLiteral.test(line.text) ||
            recordLiteral.test(line.text) ||
            recordWord.test(line.text),
        ),
      ),
    ).toEqual([])
  })

  it('would notice any of them, as the patterns are written', () => {
    // The patterns against lines of the kind that stand in an application, so
    // that a pattern that matches nothing is not mistaken for a clean package.
    expect(productName.test("export const workingInHeader = 'X-OpenGewerk-Tenant'")).toBe(true)
    expect(productName.test("export const workingInHeader = 'x-opengewerk-tenant'")).toBe(false)

    expect(tenantWord.test("'Dieser Zugang ist im Betrieb gesperrt.'")).toBe(true)
    expect(tenantWord.test("'Die Betriebsart steht in den Einstellungen.'")).toBe(false)
    expect(roleLabel.test("'Der Inhaber vergibt die Rollen.'")).toBe(true)
    expect(roleLabel.test("'Die Leitung vergibt die Rollen.'")).toBe(false)

    expect(roleLiteral.test("const firstRoles = ['owner']")).toBe(true)
    expect(roleLiteral.test(' * which runs as the owner of the tables')).toBe(false)
    expect(recordLiteral.test("if (entity === 'customers') {")).toBe(true)
    expect(recordLiteral.test('const customers = rows.length')).toBe(false)
    expect(recordWord.test("'Der Beleg ist festgeschrieben.'")).toBe(true)
    expect(recordWord.test("'Dieser Vorgang wurde abgelehnt.'")).toBe(false)
  })

  /**
   * What the manifest says of every module has to be true of every module.
   * An import without a name is one made for what loading the module does,
   * and a bundler that was told there is no such thing may leave it out.
   */
  it('imports no module for what loading it does', () => {
    expect(found(outsideComments.filter((line) => sideEffectImport.test(line.text)))).toEqual([])
    expect(sideEffectImport.test("import './register.js'")).toBe(true)
    expect(sideEffectImport.test("import { foundationPaths } from './model/paths.js'")).toBe(false)
  })

  it('reads a sentence and not a comment', () => {
    const script = "// im Betrieb\nconst a = 'x' // der Inhaber\n/**\n * Kunde\n */\nconst b = 1"

    expect(
      withoutComments(script)
        .split('\n')
        .map((line) => line.trim()),
    ).toEqual(['', "const a = 'x'", '', '', '', 'const b = 1'])
    // An address in a string is not a comment.
    expect(withoutComments("const u = 'https://example.de/x'")).toBe(
      "const u = 'https://example.de/x'",
    )
  })
})
