import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Measures what each entry point costs on a first load, and refuses a build
 * that grew past its budget.
 *
 * ADR 0004 asks for a budget per entry point and names one figure: under 300
 * kB gzip for the first load on site. A figure nobody measures is a wish, and
 * this is the measurement.
 *
 * What is counted is what the browser fetches before the application runs:
 * the entry script, everything preloaded beside it, and the stylesheet. Taken
 * from the built HTML rather than from a list kept here, so a chunk that is
 * split differently tomorrow is still counted tomorrow.
 *
 * Fonts are reported and not counted, and that is a decision rather than an
 * oversight. Barlow is loaded by the stylesheet, lazily, per weight and per
 * subset, and the text on screen is readable before any of it arrives. It is
 * also already compressed, so gzip does nothing for it. Reporting it keeps
 * the number from being mistaken for the whole of a first visit.
 */

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '..', 'dist')

/**
 * The two budgets.
 *
 * The site figure is the one from ADR 0004. The office figure is not in any
 * ADR: it is a ceiling that catches a careless import, generous because the
 * office sits at a desk on a cable. If it ever has to be raised, that is a
 * decision worth a sentence in the pull request, which is the whole point of
 * having it.
 */
const budgets = [
  { entry: 'site', name: 'Baustelle', document: join(dist, 'm', 'index.html'), limit: 300 * 1024 },
  { entry: 'office', name: 'Büro', document: join(dist, 'index.html'), limit: 450 * 1024 },
]

/** Everything the document pulls in before the application starts. */
function referencedBy(html) {
  const references = new Set()

  for (const pattern of [
    /<script[^>]+src="([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
    /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g,
  ]) {
    for (const match of html.matchAll(pattern)) {
      references.add(match[1])
    }
  }

  return [...references]
}

function gzipped(path) {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength
}

function kilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`
}

function fontBytes() {
  const assets = join(dist, 'assets')
  let total = 0

  for (const name of readdirSync(assets)) {
    if (name.endsWith('.woff2')) {
      total += statSync(join(assets, name)).size
    }
  }

  return total
}

let failed = false

for (const budget of budgets) {
  const html = readFileSync(budget.document, 'utf8')
  const parts = referencedBy(html)

  if (parts.length === 0) {
    // An empty measurement is the one result that proves nothing, so it is a
    // failure rather than a pass with a zero in it.
    console.error(`${budget.name}: in ${budget.document} steht kein einziger Baustein.`)
    failed = true
    continue
  }

  let total = 0

  for (const reference of parts) {
    total += gzipped(join(dist, reference.replace(/^\//, '')))
  }

  const verdict = total <= budget.limit ? 'hält' : 'reißt'

  console.log(
    `${budget.name}: ${kilobytes(total)} gzip aus ${String(parts.length)} Dateien, ` +
      `Budget ${kilobytes(budget.limit)}, ${verdict}.`,
  )

  if (total > budget.limit) {
    failed = true
  }
}

console.log(
  `Dazu die Schriften: ${kilobytes(fontBytes())} als woff2, nachgeladen je Schnitt und ` +
    'Zeichensatz, nicht im Budget.',
)

if (failed) {
  console.error('Das Bündelbudget ist gerissen. Ein Import mehr kostet hier echte Sekunden.')
  process.exitCode = 1
}
