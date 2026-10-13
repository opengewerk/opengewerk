import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
 *
 * A finding counts when it stands at a second measurement of the same kind of
 * page (opengewerk-haustechnik#231). The check went red at pages nobody had
 * changed, a different one each time: a page that had not drawn at all, or
 * one that had not followed its window yet. What only one of two measurements
 * found is said after the findings, with what the page reported while it was
 * open, and fails nothing.
 *
 * An application that asks for it (`accessibility`) has every kind of page
 * checked for what a screen reader and a keyboard need as well
 * (opengewerk-haustechnik#132): labels, roles, the order of the headings and
 * the contrast, with axe-core, light and dark, at the width of a telephone
 * and of a desktop, where a page shows different controls.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** The widths of the board, in CSS pixels. */
export const widths = [
  320, 360, 390, 412, 768, 1024, 1280, 1366, 1440, 1536, 1920, 2560, 3440, 3840,
]

/** The widths the accessibility of a page is checked at: a telephone and a desktop. */
export const accessibilityWidths = [390, 1280]

/**
 * The rules of axe-core a page is held to: WCAG 2.1 at the levels A and AA,
 * which EN 301 549 asks of public bodies, and the best practice axe adds.
 * The experimental rules are left out: they are not settled, and
 * `label-content-name-mismatch` among them counts the initial in an avatar
 * and the figure beside an entry of the navigation as part of a name both
 * are hidden from.
 */
export function accessibilityRules(rules) {
  return rules
    .filter(
      (rule) =>
        !rule.tags.includes('experimental') &&
        rule.tags.some((tag) =>
          ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'].includes(tag),
        ),
    )
    .map((rule) => rule.ruleId)
}

/** The script of axe-core, read once, for the first page that asks. */
let axeScript = null

function axeSource() {
  axeScript ??= readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

  return axeScript
}

/**
 * What axe-core finds wrong on a page as it stands, one line per rule with
 * the elements it found. The script comes in through the browser's protocol
 * and not as a script tag, which the policy of the application would block,
 * and the policy stays on, as the application runs with it.
 */
async function accessibilityOf(page) {
  if (!(await page.evaluate(() => 'axe' in window))) {
    // A line of its own on each side, in case the script ends in a comment.
    await page.evaluate(['(function () {', axeSource(), '}).call(window)'].join('\n'))
  }

  const rules = accessibilityRules(await page.evaluate(() => window.axe.getRules()))

  return page.evaluate(async (values) => {
    const { violations } = await window.axe.run(document, {
      runOnly: { type: 'rule', values },
      resultTypes: ['violations'],
    })

    return violations.map((violation) => ({
      id: violation.id,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }))
  }, rules)
}

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

/**
 * The kind of page an address is: every identifier becomes `:id`, every day
 * `:day`, and every part an application names a record by its key in
 * becomes `:key`.
 *
 * Such a key is a word, not an identifier, and only the application knows
 * where one stands in its addresses: it says so with patterns, each group of
 * which captures a key. Without them every entry of a register addressed by
 * its key was a kind of its own, measured at every width, and the walk grew
 * with every entry added.
 *
 * @param {string} path
 * @param {readonly RegExp[]} [keys]
 */
export function kindOf(path, keys = []) {
  const plain = path
    .split('/')
    .map((part) => (identifier.test(part) ? ':id' : day.test(part) ? ':day' : part))
    .join('/')

  return keys.reduce(keyed, plain)
}

/** An address with every part the pattern captures as `:key`. */
function keyed(path, pattern) {
  // A pattern of its own for every address, with the places of its groups:
  // nothing of one search carries over to the next.
  const { flags } = pattern
  const match = new RegExp(pattern.source, flags.includes('d') ? flags : `${flags}d`).exec(path)

  if (match?.indices === undefined) {
    return path
  }

  let kind = path

  // From the last group to the first, so that the places of the earlier ones hold.
  for (let group = match.indices.length - 1; group >= 1; group -= 1) {
    const span = match.indices[group]

    if (span !== undefined) {
      kind = `${kind.slice(0, span[0])}:key${kind.slice(span[1])}`
    }
  }

  return kind
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

/** How long a screen may take to settle after it loaded or a button was pressed. */
function settle(page, milliseconds) {
  return page.waitForTimeout(milliseconds)
}

const sessions = new WeakMap()

/**
 * The session of the DevTools protocol a page is sized and photographed
 * through. One per page and kept open: the size set through a session holds
 * only as long as the session does.
 */
async function sessionOf(page) {
  if (!sessions.has(page)) {
    sessions.set(page, await page.context().newCDPSession(page))
  }

  return sessions.get(page)
}

/**
 * Whether the window of a page has a width and the page has drawn with it.
 * Runs in the page, and answers once it has.
 *
 * A page follows its window where the browser draws a frame: there it asks
 * the media queries again and tells whoever listens to them, the band a
 * screen is laid out in among them (`components/band.ts`), before it runs the
 * callbacks of that frame. So a callback that finds the window at the width
 * runs after the page was told, and the frame after it is for what a page
 * changes in answer.
 *
 * Until opengewerk-haustechnik#280 the check waited 150 milliseconds instead
 * and measured: a page that had not drawn a frame by then still stood in the
 * layout of the width before, a desktop's header in the window of a phone.
 *
 * @param {number} width
 * @param {number} [frames] How many frames the page draws at the width before
 *   it counts as having followed.
 */
export function drawnAt(width, frames = 2) {
  return new Promise((resolve) => {
    const next = (left) => {
      requestAnimationFrame(() => {
        if (window.innerWidth !== width) {
          next(frames)
        } else if (left > 1) {
          next(left - 1)
        } else {
          resolve(true)
        }
      })
    }

    next(frames)
  })
}

/**
 * Waits until a page has followed its window to a width, and stops the check
 * at one that does not: a page that reports another width, or draws nothing,
 * would be measured as something it is not, and pass or fail for that.
 *
 * @param {object} page
 * @param {number} width
 * @param {number} [within] How long the page may take, in milliseconds.
 */
export async function followed(page, width, within = drawnWithin) {
  let timer
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, within, false)
  })
  const drawn = page.evaluate(drawnAt, width)

  try {
    if (await Promise.race([drawn, late])) {
      return
    }
  } finally {
    clearTimeout(timer)
  }

  // Still asked of the page, and answered or refused whenever the page moves on.
  drawn.catch(() => {})

  const seen = await page.evaluate(() => window.innerWidth)

  throw new Error(
    seen === width
      ? `Die Seite hat ${String(within / 1000)} Sekunden nach dem Wechsel auf ${String(width)} Pixel Breite nichts neu gezeichnet.`
      : `Das Fenster sollte ${String(width)} Pixel breit sein, die Seite meldet ${String(seen)}.`,
  )
}

/**
 * Gives the page a window of this width, and makes sure it has one and has
 * followed it.
 *
 * Through a connection to a running browser, Playwright does not apply the
 * viewport a context is created with, and it skips a resize to the size it
 * believes the page already has: measured on 25.09.2026, the first width of
 * every round was checked at 800 pixels. So the size is set through the
 * DevTools protocol itself, and a page that reports another width stops the
 * check instead of passing it.
 */
async function resize(page, width) {
  await (
    await sessionOf(page)
  ).send('Emulation.setDeviceMetricsOverride', {
    width,
    height: heightFor(width),
    deviceScaleFactor: 1,
    mobile: false,
  })
  await followed(page, width)
}

/** How wide a picture is, read from the head of a PNG, or null where there is none. */
function widthOfPicture(picture) {
  return picture.length >= 24 && picture.toString('latin1', 12, 16) === 'IHDR'
    ? picture.readUInt32BE(16)
    : null
}

/**
 * Photographs what stands in the window of a page, as wide as that window.
 *
 * Through the session the window is sized through, and not with Playwright's
 * own photograph. That one cuts to the size Playwright keeps for the page,
 * the 1280 by 720 pixels a context is created with, and leaves the page at
 * that size: every photograph of a page too wide at 320 pixels showed it at
 * 1280, where it was not too wide, and whatever was measured next was
 * measured there (opengewerk-haustechnik#280).
 *
 * Both are asked afterwards, of the picture and of the page, and a wrong
 * answer stops the check like a window of the wrong width does.
 *
 * @param {object} page
 * @param {string} file Where the picture goes.
 * @param {number} width The width the window was given, which the picture has.
 */
export async function photograph(page, file, width) {
  const { data } = await (await sessionOf(page)).send('Page.captureScreenshot', { format: 'png' })
  const picture = Buffer.from(data, 'base64')

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, picture)

  const shown = widthOfPicture(picture)

  if (shown !== width) {
    throw new Error(
      `Das Foto sollte ${String(width)} Pixel breit sein, es ist ${shown === null ? 'kein Bild' : `${String(shown)} Pixel breit`}.`,
    )
  }

  const seen = await page.evaluate(() => window.innerWidth)

  if (seen !== width) {
    throw new Error(
      `Nach dem Foto sollte das Fenster ${String(width)} Pixel breit sein, die Seite meldet ${String(seen)}.`,
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
export function worthFollowing(paths, queued, looked, scannedOnly, keys = []) {
  const fresh = new Set()
  const taken = new Map()

  for (const path of [...paths, ...paths.flatMap((path) => alsoReached(scannedOnly, path))]) {
    const kind = kindOf(path, keys)
    const count = (looked.get(kind) ?? 0) + (taken.get(kind) ?? 0)

    if (!queued.has(path) && !fresh.has(path) && count < pagesPerKind) {
      fresh.add(path)
      taken.set(kind, (taken.get(kind) ?? 0) + 1)
    }
  }

  return [...fresh]
}

/**
 * How long a screen may take to draw what it shows, and a button to appear,
 * before what is missing counts as missing.
 */
const drawnWithin = 10_000

/**
 * Goes to a page and waits until the screen stands: until its `main` holds
 * something. A screen whose records reach the device after the page loaded
 * draws its content, and the buttons in it, later than the network falls
 * quiet; measured before, it was an empty page without a heading, or a page
 * without the button it has, and the check went red at a page nobody had
 * changed, a different one each time. Whether it stands is what this
 * answers: a screen that never drew has nothing to measure, and is a finding
 * of its own rather than a page that passes because it is empty.
 */
async function open(page, address, path) {
  await page.goto(address + path, { waitUntil: 'networkidle', timeout: 30_000 })

  const drawn = await page.waitForFunction(stands, null, { timeout: drawnWithin }).then(
    () => true,
    () => false,
  )

  await settle(page, 400)

  return drawn
}

/** Whether the screen stands: whether its `main` holds something. Runs in the page. */
function stands() {
  return (document.querySelector('main')?.textContent ?? '').trim() !== ''
}

/** Whether a button of that name appears on the page, given the time a screen has to draw. */
function appears(page, name) {
  return opener(page, name)
    .waitFor({ state: 'visible', timeout: drawnWithin })
    .then(
      () => true,
      () => false,
    )
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
      // A page that did not draw has no links to follow and no button to
      // find, and the kinds behind it would go unchecked without a word:
      // opened once more. One that stays empty is found when it is measured.
      if (!(await open(page, address, path))) {
        await open(page, address, path)
      }

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
  { entries, scannedOnly = [], keys = [], openers = [], mostKinds = mostKindsUnlessSaid },
) {
  const kindOfPath = (path) => kindOf(path, keys)
  const kinds = new Map()
  const queued = new Set(entries)
  const looked = new Map(entries.map((path) => [kindOfPath(path), 1]))
  const queue = [...entries]

  while (queue.length > 0 && kinds.size < mostKinds) {
    const path = queue.shift()

    if (!kinds.has(kindOfPath(path))) {
      kinds.set(kindOfPath(path), { path, press: null })
    }

    await reader.open(path)

    for (const name of openers) {
      const kind = `${kindOfPath(path)} (${name})`

      if (!kinds.has(kind) && (await reader.has(name))) {
        kinds.set(kind, { path, press: name })
      }
    }

    const fresh = worthFollowing(await reader.paths(), queued, looked, scannedOnly, keys)

    for (const link of await reader.pages(fresh)) {
      queued.add(link)
      looked.set(kindOfPath(link), (looked.get(kindOfPath(link)) ?? 0) + 1)
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

  const page = await context.newPage()
  const lane = { theme, context, page, opened: false, confirmed: false, troubles: [], errors: [] }
  const where = (url) => kindOf(new URL(url).pathname)

  page.on('response', (response) => {
    if (response.status() >= 400) {
      lane.troubles.push(`${String(response.status())} ${where(response.url())}`)
    }
  })
  page.on('requestfailed', (request) => {
    lane.troubles.push(`${request.failure()?.errorText ?? 'ohne Antwort'} ${where(request.url())}`)
  })
  // What the script of the page itself reported: a page whose script stopped
  // has lost no request, and until #231 a finding at such a page named nothing.
  page.on('pageerror', (error) => {
    lane.errors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      lane.errors.push(message.text())
    }
  })

  return lane
}

/**
 * What went wrong at a page since it was opened, as a few words after a
 * finding: an answer with an error, a request that got none, and what the
 * script of the page reported itself. A button that comes with what the
 * server answers, a right for instance, is missing when that answer is, and
 * waiting does not bring it back; the finding says which answer it was rather
 * than leaving it to be guessed.
 *
 * A request the next page cut off is no trouble of a page that stands. Of a
 * page that did not draw it is named: the script it never ran may be the
 * request that was cut off.
 *
 * @param {readonly string[]} troubles
 * @param {object} [more]
 * @param {readonly string[]} [more.errors] What the script and the console of
 *   the page reported as errors.
 * @param {boolean} [more.drawn] Whether the page stood, true unless said.
 */
export function troubleNote(troubles, { errors = [], drawn = true } = {}) {
  const told = [
    ...new Set(troubles.filter((trouble) => !drawn || !trouble.includes('ERR_ABORTED'))),
  ]
  const reported = [...new Set(errors.map((error) => error.replace(/\s+/g, ' ').trim()))]
    .filter((error) => error !== '')
    .map((error) => (error.length > 160 ? `${error.slice(0, 160)} ...` : error))

  return [
    told.length === 0 ? '' : `; beim Laden: ${told.slice(0, 5).join(', ')}`,
    reported.length === 0 ? '' : `; Fehler der Seite: ${reported.slice(0, 3).join(' | ')}`,
  ].join('')
}

/**
 * Opens a page, says whether it drew, and holds the first one of the lane
 * that did to the theme the lane is run for. A page that did not draw says
 * nothing of its theme, and stopping the whole check there would be the same
 * failure at a page nobody changed, only louder.
 */
async function openInTheme(lane, address, path) {
  lane.troubles.length = 0
  lane.errors.length = 0

  const drawn = await open(lane.page, address, path)

  lane.opened = true

  if (drawn && !lane.confirmed) {
    const problem = themeProblem(
      lane.theme,
      await lane.page.evaluate(() => document.documentElement.dataset.theme ?? null),
    )

    if (problem) {
      throw new Error(problem)
    }

    lane.confirmed = true
  }

  return drawn
}

/** How a finding says that a page did not draw, after the width it was opened at. */
const notDrawn = 'hat die Seite nach zehn Sekunden nichts gezeichnet'

/**
 * How a page that did not draw stands there, asked of the page itself: how
 * far its document got, what it shows instead, whether the script of its
 * entry ran, whether its timers still fire, whether a service worker answers
 * for it, and which of its scripts arrived. A page may stay empty without one failed request and
 * without an error (#231), and then this is all there is to go by.
 *
 * Whether the script ran is read from the theme: setting it is the first
 * thing an entry does (`startTheme`), before it draws anything.
 */
async function stateOf(page) {
  const state = await page
    .evaluate(() => ({
      ready: document.readyState,
      text: document.body?.innerText ?? '',
      started: document.documentElement.dataset.theme !== undefined,
      controlled: Boolean(navigator.serviceWorker?.controller),
      scripts: [...document.scripts]
        .filter((script) => script.src !== '')
        .map((script) => new URL(script.src).pathname),
      loaded: performance.getEntriesByType('resource').map((entry) => ({
        path: new URL(entry.name).pathname,
        status: entry.responseStatus ?? 0,
      })),
    }))
    .catch(() => null)

  if (state === null) {
    return null
  }

  // Asked from outside with a limit: on a page whose timers stand, the
  // answer never comes.
  const ticking = await Promise.race([
    page
      .evaluate(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(true)
            }, 0)
          }),
      )
      .catch(() => false),
    new Promise((resolve) => {
      setTimeout(() => {
        resolve(false)
      }, 2000)
    }),
  ])

  return { ...state, ticking }
}

/**
 * The state of a page that did not draw, as a few words after its finding.
 *
 * @param {null | {
 *   ready: string,
 *   text: string,
 *   started: boolean,
 *   ticking: boolean,
 *   controlled: boolean,
 *   scripts: readonly string[],
 *   loaded: readonly { path: string, status: number }[],
 * }} state What the page said, or null when it did not answer.
 */
export function stateNote(state) {
  if (state === null) {
    return '; die Seite gab über sich keine Auskunft'
  }

  const scripts = state.scripts.slice(0, 4).map((path) => {
    const answer = state.loaded.find((entry) => entry.path === path)

    return `${path} ${answer === undefined ? 'nicht angekommen' : `mit ${String(answer.status)}`}`
  })

  const text = state.text.replace(/\s+/g, ' ').trim()

  return [
    `; die Seite: Dokument "${state.ready}"`,
    text === ''
      ? 'ohne Text'
      : `mit dem Text "${text.length > 80 ? `${text.slice(0, 80)} ...` : text}"`,
    state.started ? 'ihr Skript ist gelaufen' : 'ihr Skript ist nicht gelaufen',
    state.ticking ? 'ihre Zeitgeber laufen' : 'ihre Zeitgeber stehen',
    state.controlled ? 'mit Service Worker' : 'ohne Service Worker',
    scripts.length === 0 ? 'ohne Skript im Dokument' : `Skripte: ${scripts.join(', ')}`,
  ].join(', ')
}

/**
 * One kind of page at every width on one lane, and what was found wrong with
 * it. Each finding names the width and what it is about (`what`), which is
 * how a second measurement is held against the first (`measuredTwice`).
 */
async function checkKind(lane, { kind, path, press }, { address, report, steps, accessibility }) {
  const { page, theme } = lane
  const failures = []
  const found = (width, what, line, culprits = []) => {
    failures.push({ kind, theme, width, what, line, culprits })
  }
  const noted = (drawn = true) => troubleNote(lane.troubles, { errors: lane.errors, drawn })
  // After a page that did not draw: what went wrong on the way, and how the
  // page stands there.
  const emptied = async () => `${noted(false)}${stateNote(await stateOf(page))}`
  // A photograph of what stood there, as of a page too wide: which screen,
  // which message, and whether the page drew at all.
  const photographed = (width) => photograph(page, fileFor(report, kind, width, theme), width)

  // A page that has never been opened keeps the 800 pixels it was made with,
  // whatever `resize` asks: the first kind of a lane opens its page before the
  // first width, also when it has a button to press, or the check stops there.
  // One page measuring everything always began with a kind without a button.
  const drawn = !press || !lane.opened ? await openInTheme(lane, address, path) : true

  // A kind with a button to press opens its page in the loop below, in every
  // band anew; the first column of its tables is the plain kind's to check,
  // once per page.
  if (!press) {
    // An empty page is no wider than its window at any width, and passed as
    // long as nobody asked whether it stood (#231).
    if (!drawn) {
      await resize(page, widths[0])
      await photographed(widths[0])
      found(widths[0], 'empty', `bei ${String(widths[0])} px ${notDrawn}${await emptied()}`)

      return failures
    }

    const bare = await bareColumns(page)

    if (bare > 0) {
      found(null, 'bare', `${String(bare)} Zellen der stehenden ersten Tabellenspalte ohne Grund`)
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

      reachable = await appears(page, press)

      // A button that is there at a desktop width and gone in this band
      // leaves the form out of reach on such a device.
      if (reachable) {
        await opener(page, press).click()
        await settle(page, 400)
      } else {
        // Asked now and not when the page was opened: a page that drew while
        // the button was waited for is a page without the button, and one
        // that is still empty has no button because it has nothing.
        const stood = await page.evaluate(stands)

        await photographed(width)

        if (stood) {
          found(
            width,
            'unreachable',
            `bei ${String(width)} px ist "${press}" nicht zu sehen${noted()}`,
          )
        } else {
          found(width, 'empty', `bei ${String(width)} px ${notDrawn}${await emptied()}`)
        }
      }
    }

    if (!reachable) {
      continue
    }

    if (accessibility && accessibilityWidths.includes(width)) {
      for (const { id, help, targets } of await accessibilityOf(page)) {
        found(
          width,
          `accessibility ${id}`,
          `bei ${String(width)} px ${id}: ${help}${noted()}`,
          targets.slice(0, 5),
        )
      }
    }

    const { over, culprits } = await measure(page)

    if (over > 0) {
      await photographed(width)
      found(width, 'wide', `bei ${String(width)} px ${String(over)} px zu breit`, culprits)
    }
  }

  return failures
}

/**
 * Measures a kind of page, and a second time when the first measurement
 * found something: what stood both times, and what only one of them found.
 *
 * A page too wide, a button out of reach and a rule broken are there every
 * time the page is opened. What is there once is the measuring: a page that
 * did not start, or one measured before it had followed its window. Until
 * #231 each of those was a red run at a page nobody had changed, made green
 * by running it again, which is what a second measurement does here, for
 * the one kind and in the open: what it did not confirm is handed back as
 * well, to be said and not to count.
 *
 * Two findings are the same when they are about the same thing at the same
 * width (`what`, `width`). How far a page reaches over and what its page
 * reported may differ from one measurement to the next.
 *
 * @template {{ width: number | null, what: string }} Finding
 * @param {() => Promise<Finding[]>} measure
 * @returns {Promise<{ stood: Finding[], once: Finding[] }>}
 */
export async function measuredTwice(measure) {
  const first = await measure()

  if (first.length === 0) {
    return { stood: [], once: [] }
  }

  const second = await measure()
  const among = (findings) => (finding) =>
    findings.some((other) => other.width === finding.width && other.what === finding.what)

  return {
    stood: second.filter(among(first)),
    once: [
      ...first.filter((finding) => !among(second)(finding)),
      ...second.filter((finding) => !among(first)(finding)),
    ],
  }
}

/**
 * Walks and measures an application, says what it found, and sets the exit
 * code when a page is too wide, a button out of reach or a page empty at two
 * measurements of it.
 *
 * @param {object} options
 * @param {string} options.report The folder the photographs of a failure go into.
 * @param {readonly string[]} options.entries Where the walk starts: the two
 *   entries, and every page no link on any page leads to.
 * @param {readonly [RegExp, (id: string) => string][]} [options.scannedOnly]
 *   Pages only a scan reaches, found through a link to the same record: a
 *   pattern with the identifier as its first group, and the address it stands
 *   for as well.
 * @param {readonly RegExp[]} [options.keys] Where the addresses name a record
 *   by its key rather than an identifier: patterns, each group of which
 *   captures such a key. Pages that differ only there are one kind.
 * @param {readonly string[]} [options.openers] The names of the buttons that
 *   open a form without an address of its own.
 * @param {number} [options.mostKinds] How many kinds of page the walk may
 *   find before it stops and fails, 120 unless said.
 * @param {number} [options.lanes] How many pages measure one theme at once,
 *   two unless said.
 * @param {boolean} [options.accessibility] Whether every kind of page is
 *   held to the rules of accessibility as well, light and dark, at
 *   `accessibilityWidths`; off unless said.
 */
export async function checkWidths({
  report,
  entries,
  scannedOnly = [],
  keys = [],
  openers = [],
  mostKinds,
  lanes = lanesUnlessSaid,
  accessibility = false,
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
  const seenOnce = []

  try {
    const kinds = await walk(await browser.newContext(), {
      address,
      entries,
      scannedOnly,
      keys,
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
          return await inLanes(asked, opened, (kind, lane) =>
            measuredTwice(() => checkKind(lane, kind, { address, report, steps, accessibility })),
          )
        } finally {
          await Promise.all(opened.map((lane) => lane.context.close()))
        }
      }),
    )

    for (const { stood, once } of passes.flat()) {
      failures.push(...stood)
      seenOnce.push(...once)
    }
  } finally {
    await browser.close()
  }

  for (const line of reportOf({ stood: failures, once: seenOnce, accessibility })) {
    console.log(line)
  }

  // A run on GitHub shows this beside the job, which stays green: what one
  // measurement found and the next did not is the trace of whatever makes a
  // page fail to start, and nobody reads the log of a green job for it.
  if (seenOnce.length > 0 && process.env.GITHUB_ACTIONS === 'true') {
    const pages = [...new Set(seenOnce.map(({ kind, theme }) => `${kind}, ${shadeOf(theme)}`))]

    console.log(
      `::warning title=Breitenprüfung::${counted(seenOnce.length)} bei nur einer von zwei Messungen derselben Seite, mehr im Protokoll dieses Schritts: ${pages.join('; ').replaceAll('%', '%25')}`,
    )
  }

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

function shadeOf(theme) {
  return theme === 'dark' ? 'dunkel' : 'hell'
}

function counted(count) {
  return `${String(count)} ${count === 1 ? 'Befund' : 'Befunde'}`
}

/**
 * What the check says at its end, line by line: first what only one of two
 * measurements of a page found, which fails nothing, then the findings that
 * stood at both, or the sentence that there are none.
 *
 * @param {object} found
 * @param {readonly object[]} found.stood The findings of both measurements.
 * @param {readonly object[]} found.once What one measurement found and the
 *   other did not.
 * @param {boolean} found.accessibility Whether the rules of accessibility
 *   were part of the check.
 */
export function reportOf({ stood, once, accessibility }) {
  const said = (findings) =>
    findings.flatMap(({ kind, theme, line, culprits }) => [
      `  ${kind}, ${shadeOf(theme)}: ${line}`,
      ...culprits.map((culprit) => `      ${culprit}`),
    ])

  return [
    ...(once.length === 0
      ? []
      : [
          `${counted(once.length)} bei nur einer von zwei Messungen derselben Seite, ohne Folge für das Ergebnis:`,
          ...said(once),
        ]),
    ...(stood.length === 0
      ? [
          accessibility
            ? 'Keine Seite ist breiter als ihr Fenster, jede stehende Tabellenspalte hat einen Grund, und keine verstößt gegen eine Regel der Barrierefreiheit.'
            : 'Keine Seite ist breiter als ihr Fenster, und jede stehende Tabellenspalte hat einen Grund.',
        ]
      : [`${counted(stood.length)} bei beiden Messungen derselben Seite:`, ...said(stood)]),
  ]
}
