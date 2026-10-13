import { chromium } from 'playwright-core'

import { noticeId } from './entry-guard.js'

/**
 * Opens the entries of an application in a real browser with the script of
 * the entry cut off, and fails unless the page gets over it as
 * `entry-guard.js` means it to (opengewerk-haustechnik#279):
 *
 * - cut off once, the entry script or a part it imports, the page loads
 *   itself anew and the application stands;
 * - cut off for good, the page loads itself anew once and then says so, with
 *   a button that loads it anew and nothing that does so by itself.
 *
 * Asked of a browser because the whole of it hangs on what a browser does
 * with a module script it cannot load, and no test without one knows that.
 * It runs like the check of the widths, against a preview of the application
 * and in the Chromium of the installation, and reads the same two variables:
 * `WIDTHS_BROWSER` and `WIDTHS_ADDRESS`.
 *
 * Without a service worker, as on a first visit: a worker would answer for
 * the scripts itself, and what is cut off here would never be asked for.
 */

/** How long a page may take to stand or to say that it does not. */
const settledWithin = 15_000

/** How long a page is watched for loading itself anew once it has settled. */
const watchedFor = 1500

/**
 * What a page shows, asked of the page: `stands` when its `main` holds
 * something, `says` when the sentence of the guard is shown, null before
 * either. Runs in the page.
 */
function shownBy(notice) {
  if ((document.querySelector('main')?.textContent ?? '').trim() !== '') {
    return 'stands'
  }

  const sentence = document.getElementById(notice)

  return sentence && !sentence.hidden ? 'says' : null
}

/**
 * A page of its own, with a count of how often its document was asked for
 * and with whatever `cut` names cut off. `cut` is told the path of a request
 * and which load of the page it belongs to, the first being 1.
 */
async function pageIn(browser, cut) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  const seen = { loads: 0 }

  await page.route('**/*', async (route) => {
    const request = route.request()

    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      seen.loads += 1
    }

    await (cut(new URL(request.url()).pathname, seen.loads) ? route.abort() : route.continue())
  })

  return { context, page, seen }
}

/** Waits until the page stands or says that it does not, and answers which, or null. */
function settled(page) {
  return page.waitForFunction(shownBy, noticeId, { timeout: settledWithin }).then(
    (shown) => shown.jsonValue(),
    () => null,
  )
}

/**
 * Opens an entry with something cut off and says how the page ended up: what
 * it shows, and how often it was loaded, right away and a while later.
 */
async function opened(browser, address, path, cut, then = async () => {}) {
  const { context, page, seen } = await pageIn(browser, cut)

  try {
    // A page that loads itself anew cuts its own first load short, which is
    // what is asked for here and no failure to open it.
    await page.goto(address + path, { waitUntil: 'commit', timeout: 30_000 }).catch(() => {})

    const shown = await settled(page)
    const loads = seen.loads

    await page.waitForTimeout(watchedFor)

    return { shown, loads, later: seen.loads, ...(await then(page, seen)) }
  } finally {
    await context.close()
  }
}

/** What a shell names: its entry script, the parts loaded ahead of it, and whether it is guarded. */
async function shellOf(browser, address, path) {
  const { context, page } = await pageIn(browser, () => false)

  try {
    await page.goto(address + path, { waitUntil: 'load', timeout: 30_000 })

    return await page.evaluate(() => ({
      entry: document.querySelector('script[data-entry]')?.getAttribute('data-entry') ?? null,
      parts: [...document.querySelectorAll('link[rel="modulepreload"]')].map(
        (link) => new URL(link.href).pathname,
      ),
    }))
  } finally {
    await context.close()
  }
}

/**
 * Everything a browser was seen doing at one entry.
 *
 * @param {object} browser
 * @param {string} address
 * @param {string} path
 */
async function seenAt(browser, address, path) {
  const shell = await shellOf(browser, address, path)

  if (shell.entry === null) {
    return { path, guarded: false }
  }

  const once = (target) => (asked, load) => asked === target && load === 1

  return {
    path,
    guarded: true,
    entryOnce: await opened(browser, address, path, once(shell.entry)),
    partOnce:
      shell.parts.length === 0 ? null : await opened(browser, address, path, once(shell.parts[0])),
    entryNever: await opened(
      browser,
      address,
      path,
      (asked) => asked === shell.entry,
      // The button of the sentence: it loads the page anew, and the page says
      // the same again without loading itself a further time.
      async (page, seen) => {
        const before = seen.loads

        await page
          .locator(`#${noticeId} button`)
          .click({ timeout: 5000 })
          .catch(() => {})

        const shown = await settled(page)

        await page.waitForTimeout(watchedFor)

        return { pressed: { shown, loads: seen.loads - before } }
      },
    ),
  }
}

/**
 * What is wrong with what was seen at an entry, as lines, and none where the
 * page got over everything as it is meant to.
 *
 * @param {object} seen What `seenAt` saw.
 * @returns {string[]}
 */
export function findingsAt(seen) {
  if (!seen.guarded) {
    return ['die Seite nennt keine Wache vor ihrem Skript']
  }

  const findings = []
  const cutOnce = (what, { shown, loads, later }) => {
    if (shown !== 'stands') {
      findings.push(
        `${what} einmal nicht angekommen: die Anwendung steht danach nicht${shown === 'says' ? ', die Seite zeigt den Satz' : ', die Seite bleibt leer'}`,
      )
    } else if (later > 2) {
      findings.push(
        `${what} einmal nicht angekommen: die Seite lud ${String(later - 1)} Mal von selbst neu statt höchstens einmal`,
      )
    } else if (loads !== later) {
      findings.push(`${what} einmal nicht angekommen: die Seite lud neu, obwohl sie schon stand`)
    }
  }

  cutOnce('das Skript des Einstiegs', seen.entryOnce)

  if (seen.partOnce) {
    cutOnce('ein Teil des Skripts', seen.partOnce)
  }

  const { shown, loads, later, pressed } = seen.entryNever

  if (shown !== 'says') {
    findings.push(
      `das Skript des Einstiegs fehlt auf Dauer: die Seite zeigt den Satz nicht${shown === 'stands' ? ', sie steht' : ', sie bleibt leer'}`,
    )
  } else if (later !== 2) {
    findings.push(
      later === 1
        ? 'das Skript des Einstiegs fehlt auf Dauer: die Seite zeigt den Satz, ohne es einmal von selbst neu versucht zu haben'
        : `das Skript des Einstiegs fehlt auf Dauer: die Seite lud ${String(later - 1)} Mal von selbst neu statt einmal`,
    )
  } else if (loads !== 2) {
    findings.push(
      'das Skript des Einstiegs fehlt auf Dauer: die Seite lud von selbst neu, nachdem sie den Satz schon zeigte',
    )
  } else if (pressed.loads !== 1 || pressed.shown !== 'says') {
    findings.push(
      pressed.loads === 0
        ? 'das Skript des Einstiegs fehlt auf Dauer: der Knopf des Satzes lädt die Seite nicht neu'
        : `das Skript des Einstiegs fehlt auf Dauer: nach dem Knopf lud die Seite ${String(pressed.loads)} Mal und zeigt den Satz ${pressed.shown === 'says' ? '' : 'nicht '}wieder`,
    )
  }

  return findings
}

/**
 * Asks a browser at every entry of an application, says what it found, and
 * sets the exit code when an entry does not get over a script that did not
 * arrive.
 *
 * @param {object} options
 * @param {readonly string[]} options.entries Where the entries start.
 */
export async function checkEntries({ entries }) {
  const browserAddress = process.env.WIDTHS_BROWSER ?? 'ws://127.0.0.1:3999?token=probe'
  const address = (process.env.WIDTHS_ADDRESS ?? 'http://host.docker.internal:23700').replace(
    /\/$/,
    '',
  )
  const browser = await chromium.connectOverCDP(browserAddress)
  const failed = []

  try {
    for (const path of entries) {
      const seen = await seenAt(browser, address, path)
      const findings = findingsAt(seen)

      if (findings.length === 0) {
        console.log(
          `${path}: steht nach einem Neuladen von selbst, wenn sein Skript${seen.partOnce ? ' oder ein Teil davon' : ''} einmal nicht ankommt, und sagt es nach einem Neuladen, wenn es auf Dauer fehlt.`,
        )
      }

      for (const finding of findings) {
        failed.push(`${path}: ${finding}`)
      }
    }
  } finally {
    await browser.close()
  }

  if (failed.length > 0) {
    console.log(
      `${String(failed.length)} ${failed.length === 1 ? 'Befund' : 'Befunde'} an einem Einstieg, dessen Skript nicht ankommt:`,
    )

    for (const line of failed) {
      console.log(`  ${line}`)
    }

    process.exitCode = 1
  }
}
