// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { storedTheme } from '../src/components/theme.ts'
import {
  accessibilityRules,
  accessibilityWidths,
  alsoReached,
  bandOf,
  drawnAt,
  fileFor,
  followed,
  heightFor,
  inLanes,
  kindOf,
  measuredTwice,
  photograph,
  reportOf,
  stateNote,
  stepsIn,
  themeKeyIn,
  themeProblem,
  troubleNote,
  walkThrough,
  widths,
  worthFollowing,
} from './widths.js'

/**
 * What the check of the widths decides before a browser is involved: which
 * pages are of one kind, which a scan stands for, which links are followed
 * and when the walk gives up, how the pages measuring at once share the
 * kinds, where the layouts change, when a page has followed its window,
 * which theme a pass runs in, where a photograph of a failure goes and how
 * wide it is, and which findings stand after a second measurement. The walk through a real browser runs in the CI against the
 * preview of an application.
 */

describe('the widths of the board', () => {
  it('go from the smallest phone to the widest screen, each with its height', () => {
    expect(widths[0]).toBe(320)
    expect(widths.at(-1)).toBe(3840)
    expect([...widths].sort((a, b) => a - b)).toEqual(widths)
    expect(widths.map(heightFor)).toEqual([
      844, 844, 844, 844, 1024, 900, 900, 900, 900, 900, 900, 1440, 1440, 1440,
    ])
  })
})

describe('the kind of a page', () => {
  it('stands for every record and every day of its kind', () => {
    expect(kindOf('/notizen/0193a2b4-0000-7000-8000-000000000001')).toBe('/notizen/:id')
    expect(kindOf('/m/zeiten/2026-10-03')).toBe('/m/zeiten/:day')
    expect(
      kindOf(
        '/regale/0193a2b4-0000-7000-8000-000000000001/fach/0193a2b4-0000-7000-8000-000000000002',
      ),
    ).toBe('/regale/:id/fach/:id')
    expect(kindOf('/konto')).toBe('/konto')
    // What only looks like an id is a page of its own.
    expect(kindOf('/a/0000000000000000')).toBe('/a/0000000000000000')
  })

  /** A manual of an application, its topics and their chapters addressed by key. */
  const manual = [/^\/handbuch\/([^/]+)(?:\/[^/]+\/([^/]+))?/]

  it('stands for every entry an application names by its key, where its patterns capture one', () => {
    expect(kindOf('/handbuch/heizung', manual)).toBe('/handbuch/:key')
    expect(kindOf('/handbuch/heizung/kapitel', manual)).toBe('/handbuch/:key/kapitel')
    expect(kindOf('/handbuch/heizung/kapitel/pumpe_tauschen', manual)).toBe(
      '/handbuch/:key/kapitel/:key',
    )
    expect(kindOf('/handbuch', manual)).toBe('/handbuch')
    // Without the patterns a key is a page of its own.
    expect(kindOf('/handbuch/heizung')).toBe('/handbuch/heizung')
  })

  it('takes a pattern as it is meant, whatever its flags, and the same every time', () => {
    expect(kindOf('/HANDBUCH/heizung', [/^\/handbuch\/([^/]+)/i])).toBe('/HANDBUCH/:key')

    const global = [/^\/handbuch\/([^/]+)/g]

    expect([kindOf('/handbuch/heizung', global), kindOf('/handbuch/lueftung', global)]).toEqual([
      '/handbuch/:key',
      '/handbuch/:key',
    ])
  })
})

describe('a page only a scan reaches', () => {
  const scannedOnly = [[/^\/regale\/([^/]+)$/, (id) => `/m/regale/${id}`]]

  it('is found through a link to the same record', () => {
    expect(alsoReached(scannedOnly, '/regale/0193a2b4-0000-7000-8000-000000000001')).toEqual([
      '/m/regale/0193a2b4-0000-7000-8000-000000000001',
    ])
  })

  it('is not found through a link that names no record, or another page', () => {
    expect(alsoReached(scannedOnly, '/regale/neu')).toEqual([])
    expect(alsoReached(scannedOnly, '/regale/0193a2b4-0000-7000-8000-000000000001/fach')).toEqual(
      [],
    )
    expect(alsoReached([], '/regale/0193a2b4-0000-7000-8000-000000000001')).toEqual([])
  })
})

/** The identifier of a record, by its number. */
function id(number) {
  return `0193a2b4-0000-7000-8000-${String(number).padStart(12, '0')}`
}

describe('the links of a page worth following', () => {
  it('are those not queued yet, each once', () => {
    expect(
      worthFollowing(['/', '/notizen', '/konto', '/notizen'], new Set(['/']), new Map(), []),
    ).toEqual(['/notizen', '/konto'])
  })

  it('are four of a kind and no more, counting what was looked at before', () => {
    const records = Array.from({ length: 9 }, (_, number) => `/notizen/${id(number)}`)

    expect(worthFollowing(records, new Set(), new Map(), [])).toEqual(records.slice(0, 4))
    expect(worthFollowing(records, new Set(), new Map([['/notizen/:id', 3]]), [])).toEqual(
      records.slice(0, 1),
    )
    expect(worthFollowing(records, new Set(), new Map([['/notizen/:id', 4]]), [])).toEqual([])
  })

  it('include the page only a scan reaches, found through the link to its record', () => {
    expect(
      worthFollowing([`/regale/${id(1)}`], new Set(), new Map(), [
        [/^\/regale\/([^/]+)$/, (record) => `/m/regale/${record}`],
      ]),
    ).toEqual([`/regale/${id(1)}`, `/m/regale/${id(1)}`])
  })
})

/**
 * A site as the walk reads it, without a browser: for every address the
 * links that stand on it and the buttons, and every address that is not
 * listed is no page of the application. Says which addresses were opened.
 */
function siteOf(pages) {
  const opened = []
  let open = null

  return {
    opened,
    reader: {
      open(path) {
        open = path
        opened.push(path)

        return Promise.resolve()
      },
      has: (name) => Promise.resolve((pages[open]?.buttons ?? []).includes(name)),
      paths: () => Promise.resolve(pages[open]?.links ?? []),
      pages: (candidates) => Promise.resolve(candidates.filter((path) => path in pages)),
    },
  }
}

describe('the walk through the pages', () => {
  it('finds every kind of page by following links, one address each, and a button as a kind of its own', async () => {
    const site = siteOf({
      '/': { links: ['/notizen', '/konto', '/api/notizen.pdf'] },
      '/m/': { links: ['/m/regale'] },
      '/konto': { links: ['/'] },
      '/notizen': { links: [`/notizen/${id(1)}`, `/notizen/${id(2)}`], buttons: ['Neu'] },
      [`/notizen/${id(1)}`]: { links: ['/notizen'], buttons: ['Bearbeiten'] },
      [`/notizen/${id(2)}`]: { links: [`/notizen/${id(2)}/anhang`], buttons: ['Bearbeiten'] },
      [`/notizen/${id(2)}/anhang`]: {},
      '/m/regale': {},
    })

    const kinds = await walkThrough(site.reader, {
      entries: ['/', '/m/'],
      openers: ['Bearbeiten'],
    })

    expect(Object.fromEntries(kinds)).toEqual({
      '/': { path: '/', press: null },
      '/m/': { path: '/m/', press: null },
      '/notizen': { path: '/notizen', press: null },
      '/konto': { path: '/konto', press: null },
      '/m/regale': { path: '/m/regale', press: null },
      '/notizen/:id': { path: `/notizen/${id(1)}`, press: null },
      '/notizen/:id (Bearbeiten)': { path: `/notizen/${id(1)}`, press: 'Bearbeiten' },
      // Found on the second record of its kind only: one page of a kind is not enough.
      '/notizen/:id/anhang': { path: `/notizen/${id(2)}/anhang`, press: null },
    })
    // What answers with something other than a page is not opened.
    expect(site.opened).not.toContain('/api/notizen.pdf')
  })

  /**
   * The limit is there for a walk that runs away, as it once did over the
   * days of a calendar. Reached, the walk ended and the check went on to
   * measure what it had and to report that no page was too wide, with pages
   * it had never opened (opengewerk-haustechnik#31).
   */
  it('fails when it reaches its limit with addresses still waiting, and says how many', async () => {
    const site = siteOf({
      '/': { links: ['/a', '/b', '/c', '/d'] },
      '/a': {},
      '/b': {},
      '/c': {},
      '/d': {},
    })

    await expect(walkThrough(site.reader, { entries: ['/'], mostKinds: 3 })).rejects.toThrow(
      'an der Grenze von 3 Arten angehalten, 2 Adressen blieben ungeprüft',
    )
    expect(site.opened).toEqual(['/', '/a', '/b'])
  })

  it('takes the pages an application names by key as one kind, and opens four of them for links', async () => {
    const chapters = Array.from(
      { length: 6 },
      (_, number) => `/handbuch/heizung/kapitel/schritt_${String(number)}`,
    )
    const site = siteOf({
      '/': { links: ['/handbuch/heizung', '/handbuch/lueftung'] },
      '/handbuch/heizung': { links: chapters },
      '/handbuch/lueftung': { links: ['/handbuch/lueftung/kapitel/filter'] },
      ...Object.fromEntries(chapters.map((path) => [path, {}])),
      '/handbuch/lueftung/kapitel/filter': {},
    })

    const kinds = await walkThrough(site.reader, {
      entries: ['/'],
      keys: [/^\/handbuch\/([^/]+)(?:\/[^/]+\/([^/]+))?/],
    })

    expect(Object.fromEntries(kinds)).toEqual({
      '/': { path: '/', press: null },
      '/handbuch/:key': { path: '/handbuch/heizung', press: null },
      '/handbuch/:key/kapitel/:key': { path: chapters[0], press: null },
    })
    expect(site.opened.filter((path) => path.includes('/kapitel/'))).toEqual(chapters.slice(0, 4))
  })

  it('is through under the limit an application names', async () => {
    const pages = { '/': { links: [] } }

    for (let number = 0; number < 150; number++) {
      pages['/'].links.push(`/seite-${String(number)}`)
      pages[`/seite-${String(number)}`] = {}
    }

    // 151 kinds of page: too many for the limit it has unless told, which says so.
    await expect(walkThrough(siteOf(pages).reader, { entries: ['/'] })).rejects.toThrow(
      'an der Grenze von 120 Arten angehalten, 31 Adressen blieben ungeprüft',
    )
    expect((await walkThrough(siteOf(pages).reader, { entries: ['/'], mostKinds: 200 })).size).toBe(
      151,
    )
  })
})

/**
 * The kinds of page are measured on several pages of the browser at once
 * (#576). Every kind is measured, once, and the findings come back in the
 * order of the kinds, as they did when one page measured them all.
 */
describe('the pages that measure at once', () => {
  const pause = (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    })

  it('measure every kind once, all of them at the same time and no more', async () => {
    const kinds = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const measured = []
    let running = 0
    let most = 0

    await inLanes(kinds, ['eins', 'zwei', 'drei'], async (kind) => {
      running += 1
      most = Math.max(most, running)
      measured.push(kind)
      await pause(kind === 'a' ? 30 : 5)
      running -= 1
    })

    expect([...measured].sort()).toEqual(kinds)
    expect(most).toBe(3)
  })

  it('give back what they found in the order of the kinds, whichever finished first', async () => {
    const takes = { langsam: 30, mittel: 15, schnell: 0 }

    const found = await inLanes(Object.keys(takes), ['eins', 'zwei', 'drei'], async (kind) => {
      await pause(takes[kind])

      return `${kind} gemessen`
    })

    expect(found).toEqual(['langsam gemessen', 'mittel gemessen', 'schnell gemessen'])
  })

  it('take the next kind as soon as one is free, rather than wait for a slow one', async () => {
    const taken = { eins: [], zwei: [] }

    await inLanes(['a', 'b', 'c', 'd'], ['eins', 'zwei'], async (kind, lane) => {
      taken[lane].push(kind)
      await pause(kind === 'a' ? 60 : 5)
    })

    expect(taken).toEqual({ eins: ['a'], zwei: ['b', 'c', 'd'] })
  })

  it('take no more kinds once one of them fails, and fail with it', async () => {
    const measured = []

    await expect(
      inLanes(['a', 'b', 'c', 'd', 'e'], ['eins', 'zwei'], async (kind) => {
        measured.push(kind)
        await pause(5)

        if (kind === 'b') {
          throw new Error('Das Fenster sollte 320 Pixel breit sein, die Seite meldet 800.')
        }
      }),
    ).rejects.toThrow('Das Fenster sollte 320 Pixel breit sein')

    // What was already being measured on the other page finishes; nothing after it starts.
    await pause(30)
    expect(measured).not.toContain('d')
    expect(measured).not.toContain('e')
  })

  it('are at least one, rather than measure nothing and find nothing', async () => {
    await expect(inLanes(['a'], [], () => Promise.resolve('gemessen'))).rejects.toThrow(
      'es braucht mindestens eine',
    )
  })
})

describe('a page whose window was given another width (opengewerk-haustechnik#280)', () => {
  /** A window whose frames are drawn by hand, as `drawnAt` meets it in a page. */
  function windowOf(width) {
    const waiting = []
    const shown = { innerWidth: width }

    vi.stubGlobal('window', shown)
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      waiting.push(callback)
    })

    return {
      resize(to) {
        shown.innerWidth = to
      },
      /** One frame: what waited for it runs, and what that asks for waits for the next. */
      frame() {
        for (const callback of waiting.splice(0)) {
          callback()
        }
      },
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has followed once it drew two frames at that width, and no sooner', async () => {
    const page = windowOf(1920)
    let done = false

    void drawnAt(320).then(() => {
      done = true
    })

    // Frames at the width before count for nothing, however many there are.
    page.frame()
    page.frame()
    page.frame()
    await Promise.resolve()
    expect(done).toBe(false)

    // The frame the page hears of its width in, and the one for its answer.
    page.resize(320)
    page.frame()
    await Promise.resolve()
    expect(done).toBe(false)

    page.frame()
    await Promise.resolve()
    expect(done).toBe(true)
  })

  it('counts anew when the window left that width in between', async () => {
    const page = windowOf(320)
    let done = false

    void drawnAt(320).then(() => {
      done = true
    })

    page.frame()
    page.resize(1280)
    page.frame()
    page.resize(320)
    page.frame()
    await Promise.resolve()
    expect(done).toBe(false)

    page.frame()
    await Promise.resolve()
    expect(done).toBe(true)
  })

  /** A page that answers the question whether it has drawn when the test says so. */
  function pageOf(reported) {
    let answer

    return {
      follow() {
        answer(true)
      },
      page: {
        evaluate: (run) =>
          run === drawnAt
            ? new Promise((resolve) => {
                answer = resolve
              })
            : Promise.resolve(reported),
      },
    }
  }

  it('is waited for until it says it has drawn at that width, however long a fixed wait would have been', async () => {
    const { page, follow } = pageOf(320)
    let measured = false
    const waiting = followed(page, 320).then(() => {
      measured = true
    })

    // Longer than the 150 milliseconds the check waited until #280.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(measured).toBe(false)

    follow()
    await waiting
    expect(measured).toBe(true)
  })

  it('stops the check when it does not follow in time, rather than be measured as it stands', async () => {
    await expect(followed(pageOf(1280).page, 320, 20)).rejects.toThrow(
      'Das Fenster sollte 320 Pixel breit sein, die Seite meldet 1280.',
    )
    await expect(followed(pageOf(320).page, 320, 20)).rejects.toThrow(
      'Die Seite hat 0.02 Sekunden nach dem Wechsel auf 320 Pixel Breite nichts neu gezeichnet.',
    )
  })
})

describe('the theme of a pass', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/components/theme.ts'), 'utf8')

  /**
   * The dark pass sets the stored choice of the device before the page
   * loads. The key was written out in the tool a second time: changed in
   * `theme.ts`, the dark pass would have run light and found nothing
   * (opengewerk-haustechnik#31).
   */
  it('is chosen under the key the theme reads its choice from', () => {
    const key = themeKeyIn(source)

    expect(storedTheme({ getItem: (asked) => (asked === key ? 'dark' : null) })).toBe('dark')
    expect(storedTheme({ getItem: () => null })).toBe('light')
  })

  it('is not chosen under a key that could not be read, rather than run light', () => {
    expect(() => themeKeyIn("const name = 'x'")).toThrow('kein Schlüssel der Farbwahl')
    expect(() => themeKeyIn("const key = ''")).toThrow('kein Schlüssel der Farbwahl')
    expect(() => themeKeyIn("const key = 'offen")).toThrow('kein Schlüssel der Farbwahl')
    expect(themeKeyIn("export const x = 1\nconst key = 'probe.theme'\n")).toBe('probe.theme')
  })

  it('is held to what the page says it shows', () => {
    expect(themeProblem('dark', 'dark')).toBeNull()
    expect(themeProblem('light', 'light')).toBeNull()
    expect(themeProblem('dark', 'light')).toBe(
      'Der dunkle Durchgang lief hell: die Seite hat die Farbwahl nicht übernommen, die die Prüfung ihr mitgibt.',
    )
    expect(themeProblem('light', 'dark')).toContain('Der helle Durchgang lief dunkel')
    expect(themeProblem('dark', null)).toContain('ohne Angabe ihrer Farbwahl')
  })
})

describe('the bands a layout changes at', () => {
  const steps = stepsIn(
    readFileSync(join(import.meta.dirname, '../src/components/band.ts'), 'utf8'),
  )

  it('are read from the bands of this package, in pixels', () => {
    expect(steps.length).toBeGreaterThanOrEqual(5)
    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
    expect(steps).toContain(1024)
  })

  it('count how many steps a width has passed', () => {
    expect(bandOf([600, 1024], 599)).toBe(0)
    expect(bandOf([600, 1024], 600)).toBe(1)
    expect(bandOf([600, 1024], 3840)).toBe(2)
  })

  it('refuse a file that names fewer than five, rather than open a form too seldom', () => {
    expect(() => stepsIn('@media (min-width: 40rem) {} @media (min-width: 64rem) {}')).toThrow(
      'In band.ts stehen 2 Stufen',
    )
  })
})

describe('what went wrong while a page loaded', () => {
  it('follows a finding with every answer that failed, once each, and nothing where none did', () => {
    expect(troubleNote([])).toBe('')
    expect(troubleNote(['500 /auth/tenants', '500 /auth/tenants', '404 /regale/:id'])).toBe(
      '; beim Laden: 500 /auth/tenants, 404 /regale/:id',
    )
    expect(troubleNote(['net::ERR_CONNECTION_REFUSED /sync/pull'])).toBe(
      '; beim Laden: net::ERR_CONNECTION_REFUSED /sync/pull',
    )
  })

  it('leaves out what the next page cut off, and says no more than five', () => {
    expect(troubleNote(['net::ERR_ABORTED /sync/pull'])).toBe('')
    expect(troubleNote(['500 /a', '500 /b', '500 /c', '500 /d', '500 /e', '500 /f'])).toBe(
      '; beim Laden: 500 /a, 500 /b, 500 /c, 500 /d, 500 /e',
    )
  })

  it('names what was cut off at a page that did not draw, where it may be the script the page never ran (opengewerk-haustechnik#231)', () => {
    const troubles = ['net::ERR_ABORTED /assets/office.js', '500 /auth/tenants']

    expect(troubleNote(troubles, { drawn: false })).toBe(
      '; beim Laden: net::ERR_ABORTED /assets/office.js, 500 /auth/tenants',
    )
    expect(troubleNote(troubles, { drawn: true })).toBe('; beim Laden: 500 /auth/tenants')
  })

  it('says what the script of the page reported, once each, on one line and no more than three (opengewerk-haustechnik#231)', () => {
    expect(troubleNote([], { errors: [] })).toBe('')
    expect(
      troubleNote(['404 /regale/:id'], {
        errors: ['x is not\n  a function', 'x is not a function', '  '],
      }),
    ).toBe('; beim Laden: 404 /regale/:id; Fehler der Seite: x is not a function')
    expect(troubleNote([], { errors: ['a', 'b', 'c', 'd'] })).toBe('; Fehler der Seite: a | b | c')
    expect(troubleNote([], { errors: ['e'.repeat(200)] })).toBe(
      `; Fehler der Seite: ${'e'.repeat(160)} ...`,
    )
  })
})

describe('a page that did not draw (opengewerk-haustechnik#231)', () => {
  const state = {
    ready: 'complete',
    text: '',
    started: false,
    ticking: true,
    controlled: true,
    scripts: ['/assets/office.js', '/assets/styles.js'],
    loaded: [
      { path: '/assets/office.js', status: 200 },
      { path: '/assets/styles.css', status: 200 },
    ],
  }

  it('says how it stands there: its document, its script, its timers, its worker and which script arrived', () => {
    expect(stateNote(state)).toBe(
      '; die Seite: Dokument "complete", ohne Text, ihr Skript ist nicht gelaufen, ihre Zeitgeber laufen, mit Service Worker, Skripte: /assets/office.js mit 200, /assets/styles.js nicht angekommen',
    )
    expect(
      stateNote({
        ...state,
        text: ['  Einen Moment', ` bitte ${'x'.repeat(100)}`].join('\n'),
        started: true,
        ticking: false,
        controlled: false,
        scripts: [],
      }),
    ).toBe(
      `; die Seite: Dokument "complete", mit dem Text "Einen Moment bitte ${'x'.repeat(61)} ...", ihr Skript ist gelaufen, ihre Zeitgeber stehen, ohne Service Worker, ohne Skript im Dokument`,
    )
  })

  it('says so when it did not answer at all', () => {
    expect(stateNote(null)).toBe('; die Seite gab über sich keine Auskunft')
  })
})

describe('a finding of the check (opengewerk-haustechnik#231)', () => {
  const wide = { kind: '/kunden', theme: 'dark', width: 320, what: 'wide', line: 'a', culprits: [] }
  const empty = {
    kind: '/kunden',
    theme: 'dark',
    width: 768,
    what: 'empty',
    line: 'b',
    culprits: [],
  }

  /** A page whose measurements find these, one after the other, and how often it was measured. */
  function measuring(...rounds) {
    const page = { measured: 0 }

    page.measure = () => {
      page.measured += 1

      return Promise.resolve(rounds[page.measured - 1] ?? [])
    }

    return page
  }

  it('is not looked for a second time at a page the first measurement found nothing at', async () => {
    const page = measuring([], [wide])

    await expect(measuredTwice(page.measure)).resolves.toEqual({ stood: [], once: [] })
    expect(page.measured).toBe(1)
  })

  it('stands when the second measurement of the page finds it again, as that one found it', async () => {
    const again = { ...wide, line: 'bei 320 px 12 px zu breit' }
    const page = measuring([wide], [again])

    await expect(measuredTwice(page.measure)).resolves.toEqual({ stood: [again], once: [] })
    expect(page.measured).toBe(2)
  })

  it('does not stand when the second measurement does not find it, and is handed back as seen once', async () => {
    await expect(measuredTwice(measuring([empty], []).measure)).resolves.toEqual({
      stood: [],
      once: [empty],
    })
  })

  it('is the same finding only at the same width and about the same thing', async () => {
    const elsewhere = { ...wide, width: 360 }
    const other = { ...wide, what: 'unreachable' }

    await expect(
      measuredTwice(measuring([wide, empty], [elsewhere, other, empty]).measure),
    ).resolves.toEqual({ stood: [empty], once: [wide, elsewhere, other] })
  })

  it('is said under what stood at both measurements, and what one of them found alone before it and apart', () => {
    const culprit = { ...wide, line: 'bei 320 px 12 px zu breit', culprits: ['span bis 332 px'] }
    const once = { ...empty, theme: 'light', line: 'bei 768 px hat die Seite nichts gezeichnet' }

    expect(reportOf({ stood: [culprit], once: [once], accessibility: true })).toEqual([
      '1 Befund bei nur einer von zwei Messungen derselben Seite, ohne Folge für das Ergebnis:',
      '  /kunden, hell: bei 768 px hat die Seite nichts gezeichnet',
      '1 Befund bei beiden Messungen derselben Seite:',
      '  /kunden, dunkel: bei 320 px 12 px zu breit',
      '      span bis 332 px',
    ])
    expect(reportOf({ stood: [culprit, culprit], once: [], accessibility: true })[0]).toBe(
      '2 Befunde bei beiden Messungen derselben Seite:',
    )
  })

  it('leaves the check without one where nothing stood, whatever one measurement found alone', () => {
    expect(reportOf({ stood: [], once: [], accessibility: false })).toEqual([
      'Keine Seite ist breiter als ihr Fenster, und jede stehende Tabellenspalte hat einen Grund.',
    ])
    expect(reportOf({ stood: [], once: [empty], accessibility: true }).at(-1)).toBe(
      'Keine Seite ist breiter als ihr Fenster, jede stehende Tabellenspalte hat einen Grund, und keine verstößt gegen eine Regel der Barrierefreiheit.',
    )
  })
})

describe('the photograph of a failure', () => {
  it('is named after the kind, the width and the theme', () => {
    expect(fileFor('report', '/notizen/:id (Bearbeiten)', 390, 'dark')).toBe(
      join('report', 'notizen-id (Bearbeiten)-390-dark.png'),
    )
    expect(fileFor('report', '/', 1280, 'light')).toBe(join('report', 'start-1280-light.png'))
    expect(fileFor('report', '//konto//', 320, 'light')).toBe(join('report', 'konto-320-light.png'))
  })

  it('is named in one pass, however many slashes a kind has', () => {
    const started = performance.now()

    expect(fileFor('report', `${'/'.repeat(100_000)}x`, 320, 'dark')).toBe(
      join('report', 'x-320-dark.png'),
    )
    expect(fileFor('report', '/'.repeat(100_000), 320, 'dark')).toBe(
      join('report', 'start-320-dark.png'),
    )
    expect(performance.now() - started).toBeLessThan(1000)
  })

  /** The head of a PNG that many pixels wide, which is all the check reads of a picture. */
  function pictureOf(width, height = 844) {
    const head = Buffer.alloc(24)

    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head)
    head.writeUInt32BE(13, 8)
    head.write('IHDR', 12, 'latin1')
    head.writeUInt32BE(width, 16)
    head.writeUInt32BE(height, 20)

    return head
  }

  /**
   * A page as the photograph meets it: a session of the DevTools protocol
   * that takes the picture, and a window that reports its width afterwards.
   */
  function photographed({ picture, windowAfter }) {
    const sent = []
    const session = {
      send: (method, params) => {
        sent.push([method, params])

        return Promise.resolve({ data: picture.toString('base64') })
      },
    }

    return {
      sent,
      page: {
        context: () => ({ newCDPSession: () => Promise.resolve(session) }),
        evaluate: () => Promise.resolve(windowAfter),
        screenshot: () => {
          throw new Error('Playwright sizes the page to its own 1280 by 720 pixels for a picture.')
        },
      },
    }
  }

  /** Runs with a folder for the pictures that is gone afterwards. */
  async function inFolder(run) {
    const folder = mkdtempSync(join(tmpdir(), 'widths-'))

    try {
      await run(folder)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }

  it('is taken through the session the window is sized through, as wide as the window (opengewerk-haustechnik#280)', async () => {
    await inFolder(async (folder) => {
      const { page, sent } = photographed({ picture: pictureOf(320), windowAfter: 320 })
      const file = join(folder, 'report', 'konto-320-dark.png')

      await photograph(page, file, 320)

      expect(sent).toEqual([['Page.captureScreenshot', { format: 'png' }]])
      expect(readFileSync(file).readUInt32BE(16)).toBe(320)
    })
  })

  it('stops the check when the picture is not as wide as the window was (opengewerk-haustechnik#280)', async () => {
    await inFolder(async (folder) => {
      const file = join(folder, 'konto-320-dark.png')

      await expect(
        photograph(photographed({ picture: pictureOf(1280), windowAfter: 320 }).page, file, 320),
      ).rejects.toThrow('Das Foto sollte 320 Pixel breit sein, es ist 1280 Pixel breit.')
      await expect(
        photograph(
          photographed({ picture: Buffer.from('kein Bild'), windowAfter: 320 }).page,
          file,
          320,
        ),
      ).rejects.toThrow('Das Foto sollte 320 Pixel breit sein, es ist kein Bild.')
    })
  })

  it('stops the check when the page reports another width after it, rather than measure on at that one (opengewerk-haustechnik#280)', async () => {
    await inFolder(async (folder) => {
      await expect(
        photograph(
          photographed({ picture: pictureOf(320), windowAfter: 1280 }).page,
          join(folder, 'konto-320-dark.png'),
          320,
        ),
      ).rejects.toThrow(
        'Nach dem Foto sollte das Fenster 320 Pixel breit sein, die Seite meldet 1280.',
      )
    })
  })
})

describe('the rules of accessibility a page is held to', () => {
  it('are those of WCAG 2.1 at A and AA and the best practice, without the experimental ones', () => {
    expect(
      accessibilityRules([
        { ruleId: 'label', tags: ['cat.forms', 'wcag2a', 'wcag412'] },
        { ruleId: 'color-contrast', tags: ['cat.color', 'wcag2aa', 'wcag143'] },
        { ruleId: 'heading-order', tags: ['cat.semantics', 'best-practice'] },
        { ruleId: 'label-content-name-mismatch', tags: ['wcag21a', 'wcag253', 'experimental'] },
        { ruleId: 'color-contrast-enhanced', tags: ['cat.color', 'wcag2aaa', 'wcag146'] },
      ]),
    ).toEqual(['label', 'color-contrast', 'heading-order'])
  })

  it('are checked at the width of a telephone and of a desktop', () => {
    expect(accessibilityWidths).toEqual([390, 1280])
  })
})
