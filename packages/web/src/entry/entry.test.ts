import { describe, expect, it } from 'vitest'

import {
  entryChoiceKey,
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
    expect(suggestedEntry({ coarsePointer: true, finePointer: false })).toBe('site')
  })

  it('is the office as soon as a mouse is available at all', () => {
    // A laptop with a touchscreen answers yes to both. It is a desk, and the
    // office has the density a desk wants.
    expect(suggestedEntry({ coarsePointer: true, finePointer: true })).toBe('office')
  })

  it('is the office when the browser answers neither question', () => {
    // The safe guess of the two: the office has every screen the site entry
    // has and more, so nobody is stuck. The other way round somebody would be.
    expect(suggestedEntry({ coarsePointer: false, finePointer: false })).toBe('office')
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
  const phone = { coarsePointer: true, finePointer: false }
  const desk = { coarsePointer: false, finePointer: true }

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

describe('the remembered choice', () => {
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
