import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Measures what each entry point of an application costs on a first load, and
 * refuses a build that grew past its budget.
 *
 * ADR 0004 asks for a budget per entry point. A figure nobody measures is a
 * wish, and this is the measurement, for every application of the
 * organisation: it hands in where its build lies and its entry points with
 * their names and limits (ADR 0010).
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

/** Everything the document pulls in before the application starts. */
export function referencedBy(html) {
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

function fontBytes(dist) {
  const assets = join(dist, 'assets')
  let total = 0

  for (const name of readdirSync(assets)) {
    if (name.endsWith('.woff2')) {
      total += statSync(join(assets, name)).size
    }
  }

  return total
}

/**
 * Measures every budget of a build, says each in a line, and returns whether
 * all of them hold.
 *
 * @param {object} options
 * @param {string} options.dist Where the build lies.
 * @param {readonly { name: string, document: string, limit: number }[]} options.budgets
 *   One per entry point: its name, its HTML document relative to `dist`, and
 *   the most it may cost, in bytes gzip.
 * @param {(line: string) => void} [options.say] Where a line goes.
 * @param {(line: string) => void} [options.complain] Where a failure goes.
 * @returns {boolean}
 */
export function measureBudgets({ dist, budgets, say = console.log, complain = console.error }) {
  let failed = false

  for (const budget of budgets) {
    const html = readFileSync(join(dist, budget.document), 'utf8')
    const parts = referencedBy(html)

    if (parts.length === 0) {
      // An empty measurement is the one result that proves nothing, so it is a
      // failure rather than a pass with a zero in it.
      complain(`${budget.name}: in ${budget.document} steht kein einziger Baustein.`)
      failed = true
      continue
    }

    let total = 0

    for (const reference of parts) {
      total += gzipped(join(dist, reference.replace(/^\//, '')))
    }

    const verdict = total <= budget.limit ? 'hält' : 'reißt'

    say(
      `${budget.name}: ${kilobytes(total)} gzip aus ${String(parts.length)} Dateien, ` +
        `Budget ${kilobytes(budget.limit)}, ${verdict}.`,
    )

    if (total > budget.limit) {
      failed = true
    }
  }

  say(
    `Dazu die Schriften: ${kilobytes(fontBytes(dist))} als woff2, nachgeladen je Schnitt und ` +
      'Zeichensatz, nicht im Budget.',
  )

  if (failed) {
    complain('Das Bündelbudget ist gerissen. Ein Import mehr kostet hier echte Sekunden.')
  }

  return !failed
}

/** The same as a step of a build: a budget that tears sets the exit code. */
export function checkBudgets(options) {
  if (!measureBudgets(options)) {
    process.exitCode = 1
  }
}
