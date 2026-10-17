import { describe, expect, it, vi } from 'vitest'

import { choiceKey, followEntry, officePath, sitePath, viewKey } from '../../tools/entry-guard.js'
import {
  entryChoiceKey,
  entryPath,
  phoneIn,
  rememberedEntry,
  rememberEntry,
  suggestedEntry,
  suggestionFor,
} from './entry.js'

/** A `localStorage` that works, and one that refuses, which some browsers do. */
function workingStorage(): Storage {
  const held = new Map<string, string>()

  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value)
    },
    removeItem: (key) => {
      held.delete(key)
    },
    clear: () => {
      held.clear()
    },
    key: () => null,
    get length() {
      return held.size
    },
  }
}

function refusingStorage(): Storage {
  return {
    ...workingStorage(),
    getItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
    setItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  }
}

describe('which entry a device suits', () => {
  it('is the site when the only pointer is a finger', () => {
    expect(suggestedEntry({ coarsePointer: true, finePointer: false, phone: false })).toBe('site')
  })

  it('is the office as soon as a mouse is available at all', () => {
    // A laptop with a touchscreen answers yes to both. It is a desk, and the
    // office has the density a desk wants.
    expect(suggestedEntry({ coarsePointer: true, finePointer: true, phone: false })).toBe('office')
  })

  it('is the site on a phone, also one that says a fine pointer is available', () => {
    // Some phones answer yes to "(any-pointer: fine)", for the stylus they
    // take, and were offered nothing but the office.
    expect(suggestedEntry({ coarsePointer: true, finePointer: true, phone: true })).toBe('site')
    expect(suggestedEntry({ coarsePointer: false, finePointer: true, phone: true })).toBe('site')
  })

  it('is the office when the browser answers neither question', () => {
    // The safe guess of the two: the office has every screen the site entry
    // has and more, so nobody is stuck. The other way round somebody would be.
    expect(suggestedEntry({ coarsePointer: false, finePointer: false, phone: false })).toBe(
      'office',
    )
  })

  it('does not depend on how wide the screen is', () => {
    // ADR 0004 settles this in as many words. The two entries are two input
    // devices, not two screen sizes, and a wide tablet on a roof is still a
    // building site. There is no width in the question at all, and this test
    // is here so that nobody adds one without meaning to.
    expect(suggestedEntry).toHaveLength(1)
  })
})

describe('the suggestion on screen', () => {
  const phone = { coarsePointer: true, finePointer: false, phone: false }
  const desk = { coarsePointer: false, finePointer: true, phone: false }

  it('offers the site entry to a phone that opened the office', () => {
    expect(suggestionFor('office', phone, null)).toBe('site')
  })

  it('offers the office to a desk that landed on the site entry', () => {
    expect(suggestionFor('site', desk, null)).toBe('office')
  })

  it('says nothing when the device already has the entry that suits it', () => {
    expect(suggestionFor('office', desk, null)).toBeNull()
    expect(suggestionFor('site', phone, null)).toBeNull()
  })

  it('never asks again once somebody has decided', () => {
    // Including when they decided against what the device suggests. Being
    // offered the site app every morning at a desk is how a suggestion turns
    // into something people learn to click away without reading.
    expect(suggestionFor('office', phone, 'office')).toBeNull()
    expect(suggestionFor('office', phone, 'site')).toBeNull()
  })
})

/** User agents of phones, of a tablet and of desks, as browsers send them. */
const agents = [
  'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
]

describe('whether a browser runs on a phone', () => {
  it('is what the browser answers itself, where it does', () => {
    expect(phoneIn(true, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(true)
    expect(phoneIn(false, 'Mozilla/5.0 (Linux; Android 14; SM-S918B) Mobile Safari/537.36')).toBe(
      false,
    )
  })

  it('is read from the user agent otherwise: a phone says so, a tablet and a desk do not', () => {
    expect(
      phoneIn(undefined, 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0'),
    ).toBe(true)
    expect(
      phoneIn(
        undefined,
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(true)
    expect(
      phoneIn(
        undefined,
        'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      ),
    ).toBe(false)
    expect(
      phoneIn(
        undefined,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      ),
    ).toBe(false)
  })
})

describe('the remembered choice', () => {
  it('is kept under the key and followed to the address the page before the office knows', () => {
    // `tools/entry-guard.js` follows a choice of the site before the office
    // has loaded, with its own copy of both.
    expect(choiceKey).toBe(entryChoiceKey)
    expect(sitePath).toBe(entryPath.site)
    expect(officePath).toBe(entryPath.office)
  })

  it('takes a page there for the browsers this calls a phone, and for no other', () => {
    // The file before the entry asks the same question in its own words: a
    // fresh browser at the address of the instance goes to the site exactly
    // when it is a phone here.
    for (const userAgent of agents) {
      const replace = vi.fn()
      const held = new Map<string, string>()

      followEntry(
        {
          location: { pathname: '/', search: '', hash: '', replace } as unknown as Location,
          navigator: { userAgent } as Navigator,
          localStorage: {
            getItem: (key: string) => held.get(key) ?? null,
            setItem: (key: string, value: string) => held.set(key, value),
            removeItem: (key: string) => held.delete(key),
          } as unknown as Storage,
        },
        { choiceKey, viewKey, office: officePath, site: sitePath },
      )

      expect(`${userAgent}: ${String(replace.mock.calls.length > 0)}`).toBe(
        `${userAgent}: ${String(phoneIn(undefined, userAgent))}`,
      )
    }
  })

  it('comes back the way it went in', () => {
    const storage = workingStorage()

    rememberEntry('site', storage)

    expect(storage.getItem(entryChoiceKey)).toBe('site')
    expect(rememberedEntry(storage)).toBe('site')
  })

  it('is nothing when nobody has chosen', () => {
    expect(rememberedEntry(workingStorage())).toBeNull()
  })

  it('is nothing when the browser refuses storage, instead of taking the app down', () => {
    // A browser set to block site data throws from `localStorage` rather than
    // answering nothing. An unhandled throw here would stop the application
    // before it rendered anything, over a preference.
    const storage = refusingStorage()

    expect(rememberedEntry(storage)).toBeNull()
    expect(() => {
      rememberEntry('site', storage)
    }).not.toThrow()
  })
})
