// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { measureBudgets, referencedBy } from './budget.js'

/**
 * The budget of an entry point, measured on a build laid out in a folder of
 * its own: what the documents pull in, what that costs gzip, and the fonts
 * beside it.
 */

let dist = ''

/** A file of the build whose bytes do not compress: gzip leaves it at about its size. */
function asset(name, bytes) {
  writeFileSync(join(dist, 'assets', name), randomBytes(bytes))
}

function document(path, html) {
  mkdirSync(join(dist, path, '..'), { recursive: true })
  writeFileSync(join(dist, path), html)
}

function measured(budgets) {
  const said = []
  const complaints = []
  const holds = measureBudgets({
    dist,
    budgets,
    say: (line) => said.push(line),
    complain: (line) => complaints.push(line),
  })

  return { holds, said, complaints }
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'budget-'))
  mkdirSync(join(dist, 'assets'))
})

afterEach(() => {
  rmSync(dist, { recursive: true, force: true })
})

describe('what a document pulls in', () => {
  it('is its scripts, what it preloads and its stylesheets, each once', () => {
    expect(
      referencedBy(
        '<script type="module" crossorigin src="/assets/entry.js"></script>' +
          '<link rel="modulepreload" crossorigin href="/assets/shared.js">' +
          '<link rel="stylesheet" crossorigin href="/assets/styles.css">' +
          '<link rel="modulepreload" crossorigin href="/assets/shared.js">' +
          '<link rel="icon" href="/brand/icon.svg">' +
          '<link rel="manifest" href="/manifest.webmanifest">',
      ),
    ).toEqual(['/assets/entry.js', '/assets/shared.js', '/assets/styles.css'])
  })
})

describe('the budget of an entry point', () => {
  it('holds while what the document pulls in stays below it, and says so per entry', () => {
    asset('entry.js', 20 * 1024)
    asset('styles.css', 10 * 1024)
    asset('font.woff2', 3 * 1024)
    asset('font.woff', 50 * 1024)
    document(
      'index.html',
      '<script src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/styles.css">',
    )

    const { holds, said, complaints } = measured([
      { name: 'Schreibtisch', document: 'index.html', limit: 100 * 1024 },
    ])

    expect(holds).toBe(true)
    expect(complaints).toEqual([])
    expect(said[0]).toMatch(
      /^Schreibtisch: \d+\.\d kB gzip aus 2 Dateien, Budget 100\.0 kB, hält\.$/,
    )
    // Only woff2, the format a browser fetches; never counted.
    expect(said[1]).toBe(
      'Dazu die Schriften: 3.0 kB als woff2, nachgeladen je Schnitt und Zeichensatz, nicht im Budget.',
    )
  })

  it('tears when it costs more, and says that the build has to come down', () => {
    asset('entry.js', 40 * 1024)
    document('m/index.html', '<script src="/assets/entry.js"></script>')
    document('index.html', '<script src="/assets/entry.js"></script>')

    const { holds, said, complaints } = measured([
      { name: 'Unterwegs', document: 'm/index.html', limit: 20 * 1024 },
      { name: 'Schreibtisch', document: 'index.html', limit: 100 * 1024 },
    ])

    expect(holds).toBe(false)
    expect(said[0]).toMatch(/^Unterwegs: .*, Budget 20\.0 kB, reißt\.$/)
    expect(said[1]).toMatch(/^Schreibtisch: .*, hält\.$/)
    expect(complaints).toEqual([
      'Das Bündelbudget ist gerissen. Ein Import mehr kostet hier echte Sekunden.',
    ])
  })

  it('counts what it costs gzip, not what it weighs', () => {
    writeFileSync(join(dist, 'assets', 'entry.js'), 'a'.repeat(200 * 1024))
    document('index.html', '<script src="/assets/entry.js"></script>')

    expect(
      measured([{ name: 'Schreibtisch', document: 'index.html', limit: 10 * 1024 }]).holds,
    ).toBe(true)
  })

  it('is no pass for a document that pulls in nothing', () => {
    document('index.html', '<p>Leer</p>')

    const { holds, complaints } = measured([
      { name: 'Schreibtisch', document: 'index.html', limit: 100 * 1024 },
    ])

    expect(holds).toBe(false)
    expect(complaints[0]).toBe('Schreibtisch: in index.html steht kein einziger Baustein.')
  })
})
