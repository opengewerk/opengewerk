import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

/**
 * Opens every screen of both entry points in a real browser at the widths of
 * the board "Breiten und Auflösungen", light and dark, and fails as soon as a
 * page is wider than its window (#218).
 *
 * The screens are found, not listed: the walk starts at the office and at the
 * site, follows every link that leads to a page of the application, and keeps
 * one address per kind of page, so `/kunden/<id>` is visited for one customer
 * and not for all of them. A list kept here would miss the next screen the
 * way the roadmap in the README missed the next phase. A page with a button
 * "Bearbeiten" is checked a second time with that button pressed, because
 * the form it opens has no link that leads to it.
 *
 * It runs against the preview (`pnpm run preview`), where every request counts
 * as the owner of a sample business, and in a Chromium it connects to rather
 * than one it starts: the browserless image the renderer uses, so the check
 * and the installation agree on the browser. Two variables say where:
 *
 * - `WIDTHS_BROWSER`, the CDP endpoint of that browser,
 *   `ws://127.0.0.1:3999?token=probe` unless set;
 * - `WIDTHS_ADDRESS`, the preview as the browser reaches it,
 *   `http://host.docker.internal:23700` unless set, which is how a container
 *   on Docker Desktop sees the host.
 *
 * Whatever is too wide is photographed into `widths-report/`, next to a line
 * that names the element sticking out furthest.
 */

const here = dirname(fileURLToPath(import.meta.url))
const report = resolve(here, '..', 'widths-report')

const browserAddress = process.env.WIDTHS_BROWSER ?? 'ws://127.0.0.1:3999?token=probe'
const address = (process.env.WIDTHS_ADDRESS ?? 'http://host.docker.internal:23700').replace(
  /\/$/,
  '',
)

/** The widths of the board, in CSS pixels. */
const widths = [320, 360, 390, 412, 768, 1024, 1280, 1366, 1440, 1536, 1920, 2560, 3440, 3840]

/** A height that goes with each width, as the devices of the board have it. */
function heightFor(width) {
  if (width < 600) {
    return 844
  }

  if (width < 1024) {
    return 1024
  }

  return width >= 2560 ? 1440 : 900
}

/**
 * Where the walk starts: the office, the site, and the account, which is
 * behind the menu under the name and not behind a link on any page. And the
 * page the browser of a phone opens for a label (#308), which only a scan
 * reaches, here with a code no label has, so that it says so.
 */
const entries = ['/', '/m/', '/konto', `/a/${'0'.repeat(16)}`]

/**
 * Pages only a scan reaches, found through a link to the same record: the
 * installation a label opens on the site (#308) is the one the office links
 * to under `/anlagen/<id>`. From there the walk follows its links as usual.
 */
const scannedOnly = [[/^\/anlagen\/([^/]+)$/, (id) => `/m/anlagen/${id}`]]

/** The pages a link to this one stands for as well. */
function alsoReached(path) {
  return scannedOnly.flatMap(([pattern, address]) => {
    const match = pattern.exec(path)

    return match && identifier.test(match[1]) ? [address(match[1])] : []
  })
}

/**
 * How many pages of one kind the walk looks at for links. One is not enough:
 * the first job may have no distribution board, and the board screen would
 * never be found. Only the first page of a kind is checked at every width.
 */
const pagesPerKind = 4

/** Enough for every kind of page there is, and a stop if the walk runs away. */
const mostKinds = 120

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A day in an address, as the times on site have them. Taken for a kind of
 * its own, every day was one: the walk went back a day at a time until it
 * reached `mostKinds`, measured some ninety days at every width, and could
 * stop before it found the pages still waiting behind them.
 */
const day = /^\d{4}-\d{2}-\d{2}$/

/** The kind of page an address is: every identifier becomes `:id`, every day `:day`. */
function kindOf(path) {
  return path
    .split('/')
    .map((part) => (identifier.test(part) ? ':id' : day.test(part) ? ':day' : part))
    .join('/')
}

/**
 * The buttons that open a form without an address of its own, or go to one
 * without a link: the forms of a customer and of a site hold the tags a
 * person can remove, and the walk, which follows links, never saw them
 * (Greptile on #446). A page that has one is checked a second time as a kind
 * of its own, with the button pressed. Found like the pages, by its name,
 * so that the next form with the same button is checked as well. The new
 * position of a document and the material of a report open the choice of an
 * article (#296). The preview plants a quote and a report in draft as its
 * newest documents, so that the walk meets them among the first of their
 * kind: the quote with a price per 100 (#456), the report on site.
 */
const openers = ['Bearbeiten', 'Position hinzufügen', 'Material eintragen']

/** The first button of that name on the page. */
function opener(page, name) {
  return page.getByRole('button', { name, exact: true }).first()
}

/**
 * The widths at which a screen may draw another layout and with it drop a
 * form that was open: the steps of `useBand` and of `useThreeColumns`, read
 * from `src/components/band.ts` rather than written here a second time, in
 * pixels at the 16 a rem is, since the root has no font size of its own
 * (#229). The first version knew three of the five bands and opened a form
 * once for everything from 1024 to 3840 pixels.
 */
const steps = [
  ...readFileSync(resolve(here, '..', 'src', 'components', 'band.ts'), 'utf8').matchAll(
    /min-width:\s*([\d.]+)rem/g,
  ),
]
  .map((match) => Number(match[1]) * 16)
  .sort((a, b) => a - b)

if (steps.length < 5) {
  throw new Error(
    `In band.ts stehen ${String(steps.length)} Stufen, erwartet sind mindestens fünf: die Prüfung liest sie aus "min-width: <n>rem".`,
  )
}

/** How many of those steps a width has passed: the same number, the same layout. */
function bandOf(width) {
  return steps.filter((step) => width >= step).length
}

/** How long a screen may take to settle after it loaded or was resized. */
function settle(page, milliseconds) {
  return page.waitForTimeout(milliseconds)
}

const sessions = new WeakMap()

/**
 * Gives the page a window of this width, and makes sure it has one.
 *
 * Through a connection to a running browser, Playwright does not apply the
 * viewport a context is created with, and it skips a resize to the size it
 * believes the page already has: measured on 25.09.2026, the first width of
 * every round was checked at 800 pixels. So the size is set through the
 * DevTools protocol itself, and a page that reports another width stops the
 * check instead of passing it.
 */
async function resize(page, width) {
  const height = heightFor(width)

  // One session per page and kept open: the size set through a session holds
  // only as long as the session does.
  if (!sessions.has(page)) {
    sessions.set(page, await page.context().newCDPSession(page))
  }

  await sessions.get(page).send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await settle(page, 150)

  const seen = await page.evaluate(() => window.innerWidth)

  if (seen !== width) {
    throw new Error(
      `Das Fenster sollte ${String(width)} Pixel breit sein, die Seite meldet ${String(seen)}.`,
    )
  }
}

/**
 * The links on the page worth following: to pages not queued yet, as many of
 * a kind as that kind has left of `pagesPerKind`, and only those that lead to
 * a page of the application.
 */
async function linksOn(page, queued, looked) {
  const paths = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .filter((anchor) => !anchor.hasAttribute('download') && !anchor.target)
      .map((anchor) => new URL(anchor.href, location.href))
      .filter((url) => url.origin === location.origin)
      .map((url) => url.pathname),
  )
  const fresh = new Set()
  const taken = new Map()

  for (const path of [...paths, ...paths.flatMap(alsoReached)]) {
    const kind = kindOf(path)
    const count = (looked.get(kind) ?? 0) + (taken.get(kind) ?? 0)

    if (!queued.has(path) && !fresh.has(path) && count < pagesPerKind) {
      fresh.add(path)
      taken.set(kind, (taken.get(kind) ?? 0) + 1)
    }
  }

  // A link to a PDF or to the API answers with something other than the
  // shell of the application, and that is how it is told apart.
  return page.evaluate(
    async (candidates) => {
      const pages = []

      for (const path of candidates) {
        try {
          // Asked the way a browser asks for a page, and the answer left
          // unread: only its type matters.
          const response = await fetch(path, { headers: { Accept: 'text/html' } })

          if ((response.headers.get('content-type') ?? '').startsWith('text/html')) {
            pages.push(path)
          }

          await response.body?.cancel()
        } catch {
          // Not reachable is not a page to check.
        }
      }

      return pages
    },
    [...fresh.values()],
  )
}

/** Goes to a page and waits until the screen stands. */
async function open(page, path) {
  await page.goto(address + path, { waitUntil: 'networkidle', timeout: 30_000 })
  await settle(page, 400)
}

/**
 * The kinds of page of both entry points, one address each, and with it the
 * button to press first, or null.
 */
async function walk(context) {
  const page = await context.newPage()

  const kinds = new Map()
  const queued = new Set(entries)
  const looked = new Map(entries.map((path) => [kindOf(path), 1]))
  const queue = [...entries]

  while (queue.length > 0 && kinds.size < mostKinds) {
    const path = queue.shift()

    if (!kinds.has(kindOf(path))) {
      kinds.set(kindOf(path), { path, press: null })
    }

    // At a desktop width, where the navigation stands open and every link
    // in it can be found.
    await open(page, path)
    await resize(page, 1280)

    for (const name of openers) {
      const kind = `${kindOf(path)} (${name})`

      if (!kinds.has(kind) && (await opener(page, name).count()) > 0) {
        kinds.set(kind, { path, press: name })
      }
    }

    for (const link of await linksOn(page, queued, looked)) {
      queued.add(link)
      looked.set(kindOf(link), (looked.get(kindOf(link)) ?? 0) + 1)
      queue.push(link)
    }
  }

  await page.close()

  return kinds
}

/**
 * How far the page reaches past its window, and what reaches furthest.
 *
 * What sits inside something that scrolls or clips sideways does not count:
 * a table that scrolls in its frame is what the board asks for. Two things
 * the first version of this missed, both found on 25.09.2026: text that runs
 * out of its element, a long word in a heading, and an absolutely placed
 * element, which a scrolling frame only holds when the frame is its
 * containing block.
 */
function measure(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const over = root.scrollWidth - root.clientWidth

    if (over <= 0) {
      return { over: 0, culprits: [] }
    }

    const edge = root.clientWidth

    /** Whether something between here and the page clips or scrolls this sideways. */
    function held(element, absolute) {
      // Absolutely placed, it is held only by what lies at or above the
      // element it is placed in.
      let parent = absolute ? element.offsetParent : element.parentElement

      for (; parent && parent !== document.body && parent !== root; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== 'visible') {
          return parent.getBoundingClientRect().right <= edge + 1
        }
      }

      return false
    }

    function describe(element, right, text) {
      const name = element.tagName.toLowerCase()
      const shown = (text ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)

      return {
        right,
        line: `${name} bis ${String(Math.round(right))} px${shown ? ` ("${shown}")` : ''}`,
      }
    }

    const found = []
    const wide = [...document.body.querySelectorAll('*')].filter((element) => {
      const box = element.getBoundingClientRect()
      const absolute = getComputedStyle(element).position === 'absolute'

      return box.width > 0 && box.right > edge + 1 && !held(element, absolute)
    })

    // The innermost ones, which are where the width comes from.
    for (const element of wide) {
      if (!wide.some((other) => other !== element && element.contains(other))) {
        found.push(describe(element, element.getBoundingClientRect().right))
      }
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const range = document.createRange()

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement) {
        continue
      }

      range.selectNodeContents(node)
      const right = range.getBoundingClientRect().right

      if (right > edge + 1 && !held(node.parentElement, false)) {
        found.push(describe(node.parentElement, right, node.textContent))
      }
    }

    const culprits = found
      .sort((a, b) => b.right - a.right)
      .slice(0, 3)
      .map((culprit) => culprit.line)

    return { over, culprits }
  })
}

/**
 * The first cells of scrolling tables that have no background of their own.
 * Such a cell stays put while the other columns slide under it, and without a
 * background they show through it. It takes the colour of its row, and a row
 * without one the `--surface-here` of the card or shell around it; a table
 * outside both, in something drawn into `body` directly, would have none.
 */
function bareColumns(page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('.scrolling-table tr > :first-child')].filter(
        (cell) => getComputedStyle(cell).backgroundColor === 'rgba(0, 0, 0, 0)',
      ).length,
  )
}

/** A file name for a failure, from the kind of page, the width and the theme. */
function fileFor(kind, width, theme) {
  const stem = kind.replace(/^\/+|\/+$/g, '').replace(/[/:]+/g, '-') || 'start'

  return join(report, `${stem}-${String(width)}-${theme}.png`)
}

async function main() {
  rmSync(report, { recursive: true, force: true })

  const browser = await chromium.connectOverCDP(browserAddress)
  const failures = []

  try {
    const kinds = await walk(await browser.newContext())
    console.log(
      `${String(kinds.size)} Arten von Seiten gefunden, geprüft bei ${String(widths.length)} Breiten, hell und dunkel:`,
    )

    for (const kind of kinds.keys()) {
      console.log(`  ${kind}`)
    }

    for (const theme of ['light', 'dark']) {
      // The choice is made the way a person makes it, as the stored choice
      // of the device, before the first script of the page runs.
      const context = await browser.newContext()

      if (theme === 'dark') {
        await context.addInitScript(() => {
          localStorage.setItem('opengewerk.theme', 'dark')
        })
      }

      const page = await context.newPage()

      for (const [kind, { path, press }] of kinds) {
        // A kind with a button to press opens its page in the loop below, in
        // every band anew; the first column of its tables is the plain
        // kind's to check, once per page.
        if (!press) {
          await open(page, path)

          const bare = await bareColumns(page)

          if (bare > 0) {
            failures.push({
              kind,
              theme,
              line: `${String(bare)} Zellen der stehenden ersten Tabellenspalte ohne Grund`,
              culprits: [],
            })
          }
        }

        let band = null
        let reachable = true

        for (const width of widths) {
          await resize(page, width)

          if (press && bandOf(width) !== band) {
            band = bandOf(width)
            await open(page, path)
            await resize(page, width)

            const button = opener(page, press)

            reachable = await button.isVisible()

            // A button that is there at a desktop width and gone in this band
            // leaves the form out of reach on such a device.
            if (reachable) {
              await button.click()
              await settle(page, 400)
            } else {
              failures.push({
                kind,
                theme,
                line: `bei ${String(width)} px ist "${press}" nicht zu sehen`,
                culprits: [],
              })
            }
          }

          if (!reachable) {
            continue
          }

          const { over, culprits } = await measure(page)

          if (over > 0) {
            mkdirSync(report, { recursive: true })
            await page.screenshot({ path: fileFor(kind, width, theme), fullPage: false })
            failures.push({
              kind,
              theme,
              line: `bei ${String(width)} px ${String(over)} px zu breit`,
              culprits,
            })
          }
        }
      }

      await context.close()
    }
  } finally {
    await browser.close()
  }

  if (failures.length === 0) {
    console.log(
      'Keine Seite ist breiter als ihr Fenster, und jede stehende Tabellenspalte hat einen Grund.',
    )

    return
  }

  console.log(`${String(failures.length)} Befunde:`)

  for (const { kind, theme, line, culprits } of failures) {
    const shade = theme === 'dark' ? 'dunkel' : 'hell'
    console.log(`  ${kind}, ${shade}: ${line}`)

    for (const culprit of culprits) {
      console.log(`      ${culprit}`)
    }
  }

  process.exitCode = 1
}

await main()
