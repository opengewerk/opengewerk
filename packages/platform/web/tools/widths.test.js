// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { storedTheme } from '../src/components/theme.ts'
import {
  accessibilityRules,
  accessibilityWidths,
  alsoReached,
  bandOf,
  fileFor,
  heightFor,
  inLanes,
  kindOf,
  stepsIn,
  themeKeyIn,
  themeProblem,
  walkThrough,
  widths,
  worthFollowing,
} from './widths.js'

/**
 * What the check of the widths decides before a browser is involved: which
 * pages are of one kind, which a scan stands for, which links are followed
 * and when the walk gives up, how the pages measuring at once share the
 * kinds, where the layouts change, which theme a pass runs in, and where a
 * photograph of a failure goes. The walk through a real
 * browser runs in the CI against the preview of an application.
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
