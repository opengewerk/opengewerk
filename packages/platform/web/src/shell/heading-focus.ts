import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** How long the heading of a page is waited for, when the page draws it after something it reads. */
const patience = 2_000

/**
 * What had the focus, and which headings stood there saying what, at the
 * moment somebody set out for another page.
 */
interface Before {
  readonly focused: Element | null
  readonly headings: ReadonlyMap<Element, string>
}

/** The headings a page is called by, in the order of the page. */
function headingsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll('h1')]
}

/**
 * After a change of page the focus stands at its heading.
 *
 * An application that swaps the screen without loading a document leaves the
 * focus where it was: on a link of the navigation, which is still there, or
 * on nothing at all when the link went with the page or with the menu it
 * stood in. Somebody with a screen reader then hears nothing of the new page,
 * and somebody with a keyboard tabs on from the navigation through all of it
 * once more. So the frame puts the focus on the heading of the new page: it
 * is read out, and Tab goes on behind it.
 *
 * The heading of the new page is the first one that was not there before, or
 * that says something else now. Where a list stays beside what it opens, that
 * is the heading of what was opened, and not the one over the list.
 *
 * Four things it leaves alone. The page somebody arrives at, where the
 * browser begins at the top and the first Tab reaches "Zum Inhalt springen".
 * A change within a page, the search of a list or a filter in the address,
 * which changes the query and not the path. A focus that something took since
 * somebody set out: the page itself, as a form does that begins in its first
 * field, or the person, who went on to something else while the page was on
 * its way. And a page that is still the one it was: where the focus stayed
 * on what it was on and every heading says what it said before, only a part
 * below changed, as under the tabs of a record.
 *
 * The heading can be reached by a script and stays out of the order of Tab
 * (`tabindex="-1"`), and it is given the focus without the page being
 * scrolled to it. Where it is drawn only after something the page waits for,
 * it is given the focus when it comes, unless somebody has moved on in the
 * meantime.
 *
 * @param frame What the page and its heading stand in. On site the heading
 *   of a screen stands in the header above the content, so the whole frame
 *   is asked and not the content alone.
 */
export function useHeadingFocus(frame: RefObject<HTMLElement | null>): void {
  // Where somebody has set out for. The page that is about to go is still
  // drawn at that moment, and that is when it is asked what it is called and
  // what has the focus.
  const target = useRouterState({ select: (state) => state.location.pathname })
  // The path that is drawn, not the one a navigation has set out for: asked
  // of the latter, the heading found would still be the one of the page that
  // is about to go.
  const path = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  })
  const drawn = useRef(path)
  const before = useRef<Before>({ focused: null, headings: new Map() })

  useEffect(() => {
    before.current = {
      focused: document.activeElement,
      headings: new Map(
        (frame.current ? headingsIn(frame.current) : []).map((heading) => [
          heading,
          heading.textContent,
        ]),
      ),
    }
  }, [target, frame])

  useEffect(() => {
    if (drawn.current === path) {
      return
    }

    drawn.current = path

    const root = frame.current

    if (!root) {
      return
    }

    const held = document.activeElement
    const was = before.current
    /** The first heading that was not there before, or says something else now. */
    const fresh = (): HTMLElement | null =>
      headingsIn(root).find((heading) => was.headings.get(heading) !== heading.textContent) ?? null

    // On nothing means that what had the focus went with the page or the menu
    // it stood in, which is the first thing the frame is there for.
    if (held !== null && held !== document.body) {
      // Something took the focus since somebody set out, the page or the
      // person. Neither is fetched back.
      if (held !== was.focused) {
        return
      }

      // The focus stayed on what it was on, and every heading says what it
      // said before: a part of the page changed and not the page.
      if (headingsIn(root).length > 0 && fresh() === null) {
        return
      }
    }

    const toHeading = (): boolean => {
      const heading = fresh() ?? headingsIn(root)[0]

      if (!heading) {
        return false
      }

      if (!heading.hasAttribute('tabindex')) {
        heading.setAttribute('tabindex', '-1')
      }

      // The focus and nothing else: where the page is scrolled to stays the
      // matter of whoever scrolled it, and a heading pulled to the upper edge
      // would stand under the bar that sticks there.
      heading.focus({ preventScroll: true })

      return true
    }

    if (toHeading()) {
      return
    }

    const observer = new MutationObserver(() => {
      // Somebody who went on to something else is not fetched back.
      const moved = document.activeElement !== held && document.activeElement !== document.body

      if (moved || toHeading()) {
        observer.disconnect()
      }
    })
    const givenUp = setTimeout(() => {
      observer.disconnect()
    }, patience)

    observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      clearTimeout(givenUp)
    }
  }, [path, frame])
}
