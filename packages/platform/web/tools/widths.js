import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

/**
 * Opens every screen of both entry points of an application in a real
 * browser at the widths of the board "Breiten und Auflösungen", light and
 * dark, and fails as soon as a page is wider than its window (#218).
 *
 * The screens are found, not listed: the walk starts at the entries the
 * application names, follows every link that leads to a page of the
 * application, and keeps one address per kind of page, so `/kunden/<id>` is
 * visited for one record and not for all of them. A list kept somewhere would
 * miss the next screen the way the roadmap in the README missed the next
 * phase. A page with one of the buttons the application names is checked a
 * second time with that button pressed, because the form it opens has no
 * link that leads to it.
 *
 * It runs against a preview of the application, and in a Chromium it connects
 * to rather than one it starts: the browserless image the renderer uses, so
 * the check and the installation agree on the browser. Two variables say
 * where:
 *
 * - `WIDTHS_BROWSER`, the CDP endpoint of that browser,
 *   `ws://127.0.0.1:3999?token=probe` unless set;
 * - `WIDTHS_ADDRESS`, the preview as the browser reaches it,
 *   `http://host.docker.internal:23700` unless set, which is how a container
 *   on Docker Desktop sees the host.
 *
 * Whatever is too wide is photographed into the folder of the report, next
 * to a line that names the element sticking out furthest. What an application
 * hands in is said at `checkWidths` (ADR 0010).
 *
 * The measuring runs on several pages at once, light and dark side by side
 * and each theme on pages of its own (#576): one page after the other, the
 * check of an application with 106 kinds of page took 27 minutes on
 * 08.10.2026, close to the 30 a session of the browser is given in the CI.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** The widths of the board, in CSS pixels. */
export const widths = [
  320, 360, 390, 412, 768, 1024, 1280, 1366, 1440, 1536, 1920, 2560, 3440, 3840,
]

/** A height that goes with each width, as the devices of the board have it. */
export function heightFor(width) {
  if (width < 600) {
    return 844
  }

  if (width < 1024) {
    return 1024
  }

  return width >= 2560 ? 1440 : 900
}

/**
 * How many pages of one kind the walk looks at for links. One is not enough:
 * the first record of a kind may lack what leads to the next screen, and that
 * screen would never be found. Only the first page of a kind is checked at
 * every width.
 */
const pagesPerKind = 4

/**
 * Enough for every kind of page an application has had so far, and a stop if
 * the walk runs away. An application with more names its own to `checkWidths`.
 */
const mostKindsUnlessSaid = 120

/**
 * How many pages measure one theme at once unless an application says. Both
 * themes run side by side, so twice as many are open: four, as many as the
 * runner of the CI has processors.
 */
const lanesUnlessSaid = 2

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A day in an address, as the times on site have them. Taken for a kind of
 * its own, every day was one: the walk went back a day at a time until it
 * reached `mostKinds`, measured some ninety days at every width, and could
 * stop before it found the pages still waiting behind them.
 */
const day = /^\d{4}-\d{2}-\d{2}$/

/** The kind of page an address is: every identifier becomes `:id`, every day `:day`. */
export function kindOf(path) {
  return path
    .split('/')
    .map((part) => (identifier.test(part) ? ':id' : day.test(part) ? ':day' : part))
    .join('/')
}

/** The first button of that name on the page. */
function opener(page, name) {
  return page.getByRole('button', { name, exact: true }).first()
}

/**
 * The widths at which a screen may draw another layout and with it drop a
 * form that was open: the steps of `useBand` and of `useThreeColumns`, read
 * from `components/band.ts` of this package rather than written here a second
 * time, in pixels at the 16 a rem is, since the root has no font size of its
 * own (#229). The first version knew three of the five bands and opened a
 * form once for everything from 1024 to 3840 pixels.
 */
export function stepsIn(source) {
  const steps = [...source.matchAll(/min-width:\s*([\d.]+)rem/g)]
    .map((match) => Number(match[1]) * 16)
    .sort((a, b) => a - b)

  if (steps.length < 5) {
    throw new Error(
      `In band.ts stehen ${String(steps.length)} Stufen, erwartet sind mindestens fünf: die Prüfung liest sie aus "min-width: <n>rem".`,
    )
  }

  return steps
}

/** How many of those steps a width has passed: the same number, the same layout. */
export function bandOf(steps, width) {
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
 * The pages a link to this one stands for as well, from the pairs of pattern
 * and address an application names for the pages only a scan reaches.
 */
export function alsoReached(scannedOnly, path) {
  return scannedOnly.flatMap(([pattern, address]) => {
    const match = pattern.exec(path)

    return match && identifier.test(match[1]) ? [address(match[1])] : []
  })
}

/**
 * The addresses worth following among the links of a page: those not queued
 * yet, and as many of a kind as that kind has left of `pagesPerKind`. Whether
 * one of them leads to a page of the application the browser says afterwards.
 */
export function worthFollowing(paths, queued, looked, scannedOnly) {
  const fresh = new Set()
  const taken = new Map()

  for (const path of [...paths, ...paths.flatMap((path) => alsoReached(scannedOnly, path))]) {
    const kind = kindOf(path)
    const count = (looked.get(kind) ?? 0) + (taken.get(kind) ?? 0)

    if (!queued.has(path) && !fresh.has(path) && count < pagesPerKind) {
      fresh.add(path)
      taken.set(kind, (taken.get(kind) ?? 0) + 1)
    }
  }

  return [...fresh]
}

/** Goes to a page and waits until the screen stands. */
async function open(page, address, path) {
  await page.goto(address + path, { waitUntil: 'networkidle', timeout: 30_000 })
  await settle(page, 400)
}

/**
 * What the walk asks of a browser, on one page of it: to open an address,
 * whether a button stands on what is open, where its links lead, and which of
 * some addresses are pages of the application. Apart from the walk, so that
 * the walk can be held to what it promises without a browser.
 */
function readerOf(page, address) {
  return {
    // At a desktop width, where the navigation stands open and every link
    // in it can be found.
    async open(path) {
      await open(page, address, path)
      await resize(page, 1280)
    },

    async has(name) {
      return (await opener(page, name).count()) > 0
    },

    paths() {
      return page.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .filter((anchor) => !anchor.hasAttribute('download') && !anchor.target)
          .map((anchor) => new URL(anchor.href, location.href))
          .filter((url) => url.origin === location.origin)
          .map((url) => url.pathname),
      )
    },

    // A link to a PDF or to the API answers with something other than the
    // shell of the application, and that is how it is told apart.
    pages(candidates) {
      return page.evaluate(async (asked) => {
        const pages = []

        for (const path of asked) {
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
      }, candidates)
    },
  }
}

/**
 * The kinds of page of both entry points, one address each, and with it the
 * button to press first, or null.
 *
 * The limit is a stop for a walk that runs away and not a number of pages
 * that is enough. Reached with addresses still waiting, pages went unchecked,
 * and the walk used to end there and the check to report a success it did not
 * have (opengewerk-haustechnik#31). Now that is a failure which says how many
 * were left.
 *
 * @param {object} reader What the walk asks of a browser, see `readerOf`.
 */
export async function walkThrough(
  reader,
  { entries, scannedOnly = [], openers = [], mostKinds = mostKindsUnlessSaid },
) {
  const kinds = new Map()
  const queued = new Set(entries)
  const looked = new Map(entries.map((path) => [kindOf(path), 1]))
  const queue = [...entries]

  while (queue.length > 0 && kinds.size < mostKinds) {
    const path = queue.shift()

    if (!kinds.has(kindOf(path))) {
      kinds.set(kindOf(path), { path, press: null })
    }

    await reader.open(path)

    for (const name of openers) {
      const kind = `${kindOf(path)} (${name})`

      if (!kinds.has(kind) && (await reader.has(name))) {
        kinds.set(kind, { path, press: name })
      }
    }

    const fresh = worthFollowing(await reader.paths(), queued, looked, scannedOnly)

    for (const link of await reader.pages(fresh)) {
      queued.add(link)
      looked.set(kindOf(link), (looked.get(kindOf(link)) ?? 0) + 1)
      queue.push(link)
    }
  }

  if (queue.length > 0) {
    throw new Error(
      `Der Gang durch die Seiten hat an der Grenze von ${String(mostKinds)} Arten angehalten, ${String(queue.length)} Adressen blieben ungeprüft. Eine Anwendung mit mehr Arten von Seiten nennt checkWidths eine höhere Grenze (mostKinds).`,
    )
  }

  return kinds
}

/** The walk in a page of its own of this browser. */
async function walk(context, { address, ...asked }) {
  const page = await context.newPage()

  try {
    return await walkThrough(readerOf(page, address), asked)
  } finally {
    await page.close()
  }
}

/**
 * Checks every item on all lanes at once, each lane taking the next item as
 * soon as it is free, so that a lane with the slow kinds of page does not hold
 * up the others. What the checks return comes back in the order of the items,
 * whichever finished first, and the first check that fails stops the lanes
 * from taking more. Apart from the browser, so that it can be held to that
 * without one.
 *
 * @template Item, Lane, Result
 * @param {readonly Item[]} items
 * @param {readonly Lane[]} lanes
 * @param {(item: Item, lane: Lane) => Promise<Result>} check
 * @returns {Promise<Result[]>}
 */
export async function inLanes(items, lanes, check) {
  if (lanes.length === 0) {
    throw new Error('Ohne eine Seite im Browser wird nichts gemessen: es braucht mindestens eine.')
  }

  const results = []
  let next = 0
  let failed = false

  async function run(lane) {
    while (!failed && next < items.length) {
      const index = next
      next += 1

      try {
        results[index] = await check(items[index], lane)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(lanes.map(run))

  return results
}

/**
 * The key the choice of light or dark is kept under, read from
 * `components/theme.ts` of this package rather than written here a second
 * time. A copy that fell behind would have run the dark pass light without a
 * word (opengewerk-haustechnik#31). Read with `indexOf`: what a package
 * exports counts as foreign input for the code scanning, and a pattern that
 * backtracks is a finding there.
 */
export function themeKeyIn(source) {
  const opening = "const key = '"
  const from = source.indexOf(opening)
  const until = from < 0 ? -1 : source.indexOf("'", from + opening.length)

  if (until <= from + opening.length) {
    throw new Error(
      'In theme.ts steht kein Schlüssel der Farbwahl: die Prüfung liest ihn aus "const key = \'<schlüssel>\'" und liefe ohne ihn im dunklen Durchgang hell.',
    )
  }

  return source.slice(from + opening.length, until)
}

/**
 * What is wrong when a pass does not run in the theme it is run for, or null.
 * Asked of the first page of every pass, of what the page itself says it
 * shows: a dark pass that runs light finds nothing and proves nothing.
 */
export function themeProblem(wanted, shown) {
  if (shown === wanted) {
    return null
  }

  const pass = wanted === 'dark' ? 'dunkle' : 'helle'
  const seen =
    shown === 'dark' ? 'dunkel' : shown === 'light' ? 'hell' : 'ohne Angabe ihrer Farbwahl'

  return `Der ${pass} Durchgang lief ${seen}: die Seite hat die Farbwahl nicht übernommen, die die Prüfung ihr mitgibt.`
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

/**
 * A file name for a failure, from the kind of page, the width and the theme.
 *
 * The slashes at both ends are cut by counting rather than with `/\/+$/`,
 * which backtracks on a long run of slashes; an exported function takes
 * whatever it is handed (CodeQL on #496).
 */
export function fileFor(report, kind, width, theme) {
  let start = 0
  let end = kind.length

  while (start < end && kind[start] === '/') {
    start += 1
  }

  while (end > start && kind[end - 1] === '/') {
    end -= 1
  }

  const stem = kind.slice(start, end).replace(/[/:]+/g, '-') || 'start'

  return join(report, `${stem}-${String(width)}-${theme}.png`)
}

/**
 * A page of the browser that measures in one theme, in a context of its own,
 * so that pages measuring at once share neither what one of them stored nor
 * a process of the browser. The choice is made the way a person makes it, as
 * the stored choice of the device, before the first script of the page runs:
 * under the key `components/theme.ts` keeps it under.
 */
async function laneIn(browser, theme, themeKey) {
  const context = await browser.newContext()

  if (theme === 'dark') {
    await context.addInitScript((key) => {
      localStorage.setItem(key, 'dark')
    }, themeKey)
  }

  return { theme, context, page: await context.newPage(), confirmed: false }
}

/** Opens a page, and holds the first of the lane to the theme the lane is run for. */
async function openInTheme(lane, address, path) {
  await open(lane.page, address, path)

  if (!lane.confirmed) {
    const problem = themeProblem(
      lane.theme,
      await lane.page.evaluate(() => document.documentElement.dataset.theme ?? null),
    )

    if (problem) {
      throw new Error(problem)
    }

    lane.confirmed = true
  }
}

/** One kind of page at every width on one lane, and what was found wrong with it. */
async function checkKind(lane, { kind, path, press }, { address, report, steps }) {
  const { page, theme } = lane
  const failures = []

  // A kind with a button to press opens its page in the loop below, in every
  // band anew; the first column of its tables is the plain kind's to check,
  // once per page.
  if (!press) {
    await openInTheme(lane, address, path)

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

    if (press && bandOf(steps, width) !== band) {
      band = bandOf(steps, width)
      await openInTheme(lane, address, path)
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
      await page.screenshot({ path: fileFor(report, kind, width, theme), fullPage: false })
      failures.push({
        kind,
        theme,
        line: `bei ${String(width)} px ${String(over)} px zu breit`,
        culprits,
      })
    }
  }

  return failures
}

/**
 * Walks and measures an application, says what it found, and sets the exit
 * code when a page is too wide or a button out of reach.
 *
 * @param {object} options
 * @param {string} options.report The folder the photographs of a failure go into.
 * @param {readonly string[]} options.entries Where the walk starts: the two
 *   entries, and every page no link on any page leads to.
 * @param {readonly [RegExp, (id: string) => string][]} [options.scannedOnly]
 *   Pages only a scan reaches, found through a link to the same record: a
 *   pattern with the identifier as its first group, and the address it stands
 *   for as well.
 * @param {readonly string[]} [options.openers] The names of the buttons that
 *   open a form without an address of its own.
 * @param {number} [options.mostKinds] How many kinds of page the walk may
 *   find before it stops and fails, 120 unless said.
 * @param {number} [options.lanes] How many pages measure one theme at once,
 *   two unless said.
 */
export async function checkWidths({
  report,
  entries,
  scannedOnly = [],
  openers = [],
  mostKinds,
  lanes = lanesUnlessSaid,
}) {
  const browserAddress = process.env.WIDTHS_BROWSER ?? 'ws://127.0.0.1:3999?token=probe'
  const address = (process.env.WIDTHS_ADDRESS ?? 'http://host.docker.internal:23700').replace(
    /\/$/,
    '',
  )
  const steps = stepsIn(readFileSync(resolve(here, '..', 'src', 'components', 'band.ts'), 'utf8'))
  const themeKey = themeKeyIn(
    readFileSync(resolve(here, '..', 'src', 'components', 'theme.ts'), 'utf8'),
  )

  rmSync(report, { recursive: true, force: true })

  const browser = await chromium.connectOverCDP(browserAddress)
  const failures = []

  try {
    const kinds = await walk(await browser.newContext(), {
      address,
      entries,
      scannedOnly,
      openers,
      mostKinds,
    })
    console.log(
      `${String(kinds.size)} Arten von Seiten gefunden, geprüft bei ${String(widths.length)} Breiten, hell und dunkel, auf ${String(lanes)} Seiten je Farbwahl zugleich:`,
    )

    for (const kind of kinds.keys()) {
      console.log(`  ${kind}`)
    }

    const asked = [...kinds].map(([kind, { path, press }]) => ({ kind, path, press }))
    const passes = await Promise.all(
      ['light', 'dark'].map(async (theme) => {
        const opened = await Promise.all(
          Array.from({ length: lanes }, () => laneIn(browser, theme, themeKey)),
        )

        try {
          const found = await inLanes(asked, opened, (kind, lane) =>
            checkKind(lane, kind, { address, report, steps }),
          )

          return found.flat()
        } finally {
          await Promise.all(opened.map((lane) => lane.context.close()))
        }
      }),
    )

    failures.push(...passes.flat())
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
