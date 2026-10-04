import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useHeadingFocus } from './heading-focus.js'

/**
 * Where the focus stands after a change of page: at the heading of the new
 * page, so that it is read out and Tab goes on in the page, and not on the
 * link that led there.
 *
 * The frame here is the least a frame is: a navigation that stays, and the
 * content below it. The three frames of the foundation each hold in a test
 * of their own that they use the hook.
 */

/** Lets a test say when the heading of the late page comes. */
let arrive: () => void = () => {}

function Late() {
  const [there, setThere] = useState(false)

  useEffect(() => {
    arrive = () => {
      setThere(true)
    }
  }, [])

  return there ? <h1>Später</h1> : <p>Wird geladen.</p>
}

/** Lets a test say when the slow page has read what it waits for before it is drawn. */
let ready: () => void = () => {}

/**
 * A record with parts. The heading and the links to the parts are one page
 * that stays, and only what stands below them changes with the address.
 */
function Folder() {
  return (
    <>
      <h1>Akte</h1>
      <Link to="/akte/blatt">Blatt</Link>
      <Link to="/akte/anhang">Anhang</Link>
      <Outlet />
    </>
  )
}

/**
 * A list that stays beside what it opens, as on a wide screen: its heading
 * and its links are still there after one of them was followed, and what was
 * opened has a heading of its own.
 */
function Stock() {
  return (
    <>
      <h1>Lager</h1>
      <Link to="/lager/$compartment" params={{ compartment: 'a' }}>
        Fach a öffnen
      </Link>
      <Link to="/lager/$compartment" params={{ compartment: 'b' }}>
        Fach b öffnen
      </Link>
      <Outlet />
    </>
  )
}

function Compartment() {
  // Of the page that is drawn, as a screen reads what it shows.
  const opened = (useParams({ strict: false }) as { readonly compartment?: string }).compartment

  return <h1>{`Fach ${opened ?? ''}`}</h1>
}

const screens: Readonly<Record<string, () => ReactNode>> = {
  '/': () => <h1>Regale</h1>,
  '/notizen': () => (
    <>
      <h1>Notizen</h1>
      <input aria-label="Suche" />
      <Link to="/">Zurück zu den Regalen</Link>
    </>
  ),
  '/neu': () => (
    <>
      <h1>Neue Notiz</h1>
      {/* A form that begins in its first field, which is the page's choice. */}
      <input aria-label="Text" autoFocus />
    </>
  ),
  '/spaet': () => <Late />,
  '/ohne': () => <p>Eine Seite ohne Überschrift.</p>,
}

function Frame() {
  const frame = useRef<HTMLDivElement>(null)

  useHeadingFocus(frame)

  return (
    <div ref={frame}>
      <nav aria-label="Hauptnavigation">
        <Link to="/">Zu den Regalen</Link>
        <Link to="/notizen">Zu den Notizen</Link>
        <Link to="/neu">Notiz anlegen</Link>
        <Link to="/spaet">Zur späten Seite</Link>
        <Link to="/ohne">Zur Seite ohne Überschrift</Link>
        <Link to="/akte/blatt">Zur Akte</Link>
        <Link to="/langsam">Zur langsamen Seite</Link>
        <Link to="/lager">Zum Lager</Link>
        <button type="button">Menü</button>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}

async function started(at = '/') {
  const root = createRootRoute({ component: Frame })
  const folder = createRoute({ getParentRoute: () => root, path: '/akte', component: Folder })
  const stock = createRoute({ getParentRoute: () => root, path: '/lager', component: Stock })
  const router = createRouter({
    routeTree: root.addChildren([
      ...Object.entries(screens).map(([path, component]) =>
        createRoute({ getParentRoute: () => root, path, component }),
      ),
      // A page that reads before it is drawn: the address is ahead of what
      // stands on the screen for as long as that takes.
      createRoute({
        getParentRoute: () => root,
        path: '/langsam',
        loader: () =>
          new Promise<void>((resolve) => {
            ready = resolve
          }),
        component: () => <h1>Langsam</h1>,
      }),
      folder.addChildren([
        createRoute({
          getParentRoute: () => folder,
          path: 'blatt',
          component: () => <p>Das Blatt.</p>,
        }),
        createRoute({
          getParentRoute: () => folder,
          path: 'anhang',
          component: () => <p>Der Anhang.</p>,
        }),
      ]),
      stock.addChildren([
        createRoute({ getParentRoute: () => stock, path: '/', component: () => null }),
        createRoute({ getParentRoute: () => stock, path: '$compartment', component: Compartment }),
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  render(<RouterProvider router={router} />)
  await screen.findByRole('navigation', { name: 'Hauptnavigation' })

  return router
}

function heading(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 1, name })
}

async function follow(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('link', { name }))
}

afterEach(() => {
  arrive = () => {}
  ready = () => {}
})

describe('the focus after a change of page', () => {
  it('stands at the heading of the page somebody goes to, which Tab does not stop at', async () => {
    await started()
    await follow('Zu den Notizen')

    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Notizen'))
    })
    expect(heading('Notizen').getAttribute('tabindex')).toBe('-1')

    await follow('Zu den Regalen')

    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Regale'))
    })
  })

  it('is left where the browser put it on the page somebody arrives at', async () => {
    await started('/notizen')

    expect(heading('Notizen')).toBeTruthy()
    expect(document.activeElement).toBe(document.body)
    expect(heading('Notizen').hasAttribute('tabindex')).toBe(false)
  })

  it('stands at the heading after the way back as well', async () => {
    const router = await started()

    await follow('Zu den Notizen')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Notizen'))
    })

    act(() => {
      router.history.back()
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Regale'))
    })
  })

  it('stays where it is when only the query of the address changes', async () => {
    const router = await started('/notizen')

    // On nothing, as after arriving, which a change of page would take to the
    // heading: a search or a filter in the address is no change of page.
    await act(() => router.navigate({ to: '/notizen', search: { suche: 'regal' } as never }))

    expect(router.state.location.searchStr).toContain('regal')
    expect(document.activeElement).toBe(document.body)

    const menu = screen.getByRole('button', { name: 'Menü' })

    menu.focus()
    await act(() => router.navigate({ to: '/notizen', search: { suche: 'fenster' } as never }))

    expect(router.state.location.searchStr).toContain('fenster')
    expect(document.activeElement).toBe(menu)
  })

  it('stays in the field a page begins in', async () => {
    await started()
    await follow('Notiz anlegen')

    await screen.findByRole('heading', { level: 1, name: 'Neue Notiz' })
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Text' }))
    })
  })

  it('stays on a link of the page that is still there when only a part below it changes', async () => {
    await started()
    await follow('Zur Akte')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Akte'))
    })

    await follow('Anhang')

    expect(await screen.findByText('Der Anhang.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Anhang' }))
  })

  /**
   * The link that was followed is still there and still has the focus, as
   * under the tabs of a record, and the heading over the list is the first
   * of the page as before. What tells the two apart is a heading that was not
   * there: it names what was opened, and a reader should hear that.
   */
  it('goes to the heading of what a list opened that stays beside it', async () => {
    await started()
    await follow('Zum Lager')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Lager'))
    })

    await follow('Fach a öffnen')

    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Fach a'))
    })
    // The list is where it was, with its own heading ahead of the new one.
    expect(heading('Lager')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Fach a öffnen' })).toBeTruthy()

    // And from one to the next, where the heading stays the element it was
    // and says something else.
    await follow('Fach b öffnen')

    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Fach b'))
    })
  })

  it('goes to the heading from a link of the page that went with it', async () => {
    await started('/notizen')
    await follow('Zurück zu den Regalen')

    // The link is gone with its page, and the focus would be on nothing.
    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Regale'))
    })
  })

  it('goes to a heading that comes late, once it is there', async () => {
    await started()
    await follow('Zur späten Seite')

    expect(await screen.findByText('Wird geladen.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Zur späten Seite' }))

    act(() => {
      arrive()
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Später'))
    })
  })

  it('does not fetch somebody back who went on before a late heading came', async () => {
    await started()
    await follow('Zur späten Seite')
    await screen.findByText('Wird geladen.')

    const menu = screen.getByRole('button', { name: 'Menü' })

    menu.focus()
    act(() => {
      arrive()
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Später' })).toBeTruthy()
    // The observer has had its turn by the time something else is found.
    await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    expect(document.activeElement).toBe(menu)
  })

  /**
   * The address changes when somebody sets out, the screen when the page has
   * read what it needs. Asked of the address, the frame would find the heading
   * of the page that is about to go and put the focus there.
   */
  it('waits for a page that reads before it is drawn, and leaves the heading of the one that goes alone', async () => {
    const router = await started()

    await follow('Zur langsamen Seite')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/langsam')
    })

    // On its way, and the old page still stands.
    expect(heading('Regale')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Zur langsamen Seite' }))

    act(() => {
      ready()
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(heading('Langsam'))
    })
  })

  it('does not fetch somebody back who went on while the page was on its way', async () => {
    const router = await started()

    await follow('Zur langsamen Seite')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/langsam')
    })

    const menu = screen.getByRole('button', { name: 'Menü' })

    menu.focus()
    act(() => {
      ready()
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Langsam' })).toBeTruthy()
    // The frame has had its turn by the time something else is found.
    await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    expect(document.activeElement).toBe(menu)
  })

  it('leaves the focus alone on a page without a heading', async () => {
    await started()
    await follow('Zur Seite ohne Überschrift')

    expect(await screen.findByText('Eine Seite ohne Überschrift.')).toBeTruthy()
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: 'Zur Seite ohne Überschrift' }),
    )
  })
})
