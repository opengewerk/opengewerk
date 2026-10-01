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
