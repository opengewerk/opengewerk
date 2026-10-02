import { act, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Shell } from '../components/surface.js'
import type { Entry } from '../components/surface.js'
import { InProbe } from '../probe-application.js'
import { entryChoiceKey } from './entry.js'
import { EntrySuggestion } from './suggestion.js'
import { UpdateBar } from './update-bar.js'
import { offerUpdate, updateWaiting } from './updates.js'

/**
 * The two offers over a screen: the entry a device suits better, and a new
 * version that waits.
 *
 * What the two entries are called is the application's (ADR 0010), which
 * names the second one after where its people work. The one in these tests
 * belongs to nobody.
 */

/** A device with only a finger, or with a mouse: happy-dom answers no to every query. */
function device(traits: { readonly coarse: boolean; readonly fine: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(pointer: coarse)'
        ? traits.coarse
        : query === '(any-pointer: fine)'
          ? traits.fine
          : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const phone = { coarse: true, fine: false }
const desk = { coarse: false, fine: true }

function suggestion(here: Entry) {
  return render(
    <InProbe>
      <Shell entry={here}>
        <EntrySuggestion here={here} />
      </Shell>
    </InProbe>,
  )
}

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the suggestion to switch entry', () => {
  it('offers the site entry to something with only a finger, in the words of the application', () => {
    device(phone)
    suggestion('office')

    expect(screen.getByText('Das sieht nach einem Gerät für unterwegs aus.')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Zur Ansicht für unterwegs' }).getAttribute('href'),
    ).toBe('/m/')
  })

  it('offers the office to a desk that landed on the site entry', () => {
    device(desk)
    suggestion('site')

    expect(screen.getByText('Das sieht nach einem Schreibtisch aus.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zum Schreibtisch' }).getAttribute('href')).toBe('/')
  })

  it('says nothing to a device that has the entry it suits', () => {
    device(desk)
    const { container } = suggestion('office')

    expect(container.textContent).toBe('')
  })

  it('never asks again once somebody has said they want to stay', async () => {
    device(phone)
    const { unmount } = suggestion('office')

    await userEvent.click(screen.getByRole('button', { name: 'Hier bleiben' }))

    expect(globalThis.localStorage.getItem(entryChoiceKey)).toBe('office')
    expect(screen.queryByRole('link', { name: 'Zur Ansicht für unterwegs' })).toBeNull()

    unmount()
    suggestion('office')

    expect(screen.queryByRole('link', { name: 'Zur Ansicht für unterwegs' })).toBeNull()
  })

  /**
   * A link and not a navigation, because the two entries are two documents.
   * Following it is a decision as well, and is remembered as one: the entry
   * it leads to does not offer the way back the next morning.
   */
  it('remembers the other entry for somebody who follows the link', async () => {
    device(phone)
    suggestion('office')

    const link = screen.getByRole('link', { name: 'Zur Ansicht für unterwegs' })

    // The page stays where it is: a test has no second document to go to.
    link.addEventListener('click', (event) => {
      event.preventDefault()
    })
    await userEvent.click(link)

    expect(globalThis.localStorage.getItem(entryChoiceKey)).toBe('site')
  })
})

describe('the offer of a new version', () => {
  /**
   * A module holds the offer for as long as the page is open, and nothing
   * takes it back. So the one test that needs a page without an offer comes
   * before every other that makes one, and says so.
   */
  it('is not there until the service worker has one, appears on a screen that is open, and takes it when asked', async () => {
    expect(updateWaiting()).toBe(false)

    render(
      <Shell entry="office">
        <UpdateBar />
      </Shell>,
    )

    expect(screen.queryByText('Eine neue Fassung liegt bereit.')).toBeNull()

    const swap = vi.fn()

    // The version arrives while the screen is shown: nothing renders it again
    // but the offer itself.
    act(() => {
      offerUpdate(swap)
    })

    expect(await screen.findByText('Eine neue Fassung liegt bereit.')).toBeTruthy()
    // Waiting, not applied: swapping the code under somebody who is typing
    // loses what they typed.
    expect(swap).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Jetzt übernehmen' }))

    expect(swap).toHaveBeenCalledOnce()
  })

  it('stands on a screen that is opened after the version arrived', async () => {
    const swap = vi.fn()

    offerUpdate(swap)
    render(
      <Shell entry="site">
        <UpdateBar />
      </Shell>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Jetzt übernehmen' }))

    expect(swap).toHaveBeenCalledOnce()
  })
})
