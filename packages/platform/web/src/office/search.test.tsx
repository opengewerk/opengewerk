import 'fake-indexeddb/auto'

import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Archive, StickyNote } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inFrame, signedIn, standInServer } from '../in-frame.js'
import type { SearchFound, SearchSource } from '../components/search.js'
import { RequestRefused } from '../sync/transport.js'
import { OfficeFrame } from './frame.js'
import type { NavigationGroup } from './navigation.js'

/**
 * The search in the header of the office (opengewerk-haustechnik#125). What
 * is searched is the application's: the one here keeps shelves and notes and
 * finds them by words, as no application does.
 */

const navigation: readonly NavigationGroup[] = [
  { title: 'Bestand', entries: [{ to: '/', label: 'Regale', icon: Archive }] },
]

const screens = {
  '/': () => <h1>Regale</h1>,
  '/regale/$shelfId': () => <h1>Ein Regal</h1>,
  '/notizen/$noteId': () => <h1>Eine Notiz</h1>,
}

const found: SearchFound = {
  // The notes first, as an answer may come: the groups stand in the order of the kinds.
  hits: [
    { kind: 'note', id: 'n1', title: 'Regalnotiz', detail: 'Am Fenster', to: '/notizen/n1' },
    { kind: 'shelf', id: 's1', title: 'Regal Nord', detail: 'Keller, Raum 2', to: '/regale/s1' },
    { kind: 'shelf', id: 's2', title: 'Regal Süd', detail: 'Keller, Raum 3', to: '/regale/s2' },
  ],
  more: [],
  note: null,
}

/** A source that answers with `answer` and keeps the words it was asked. */
function sourceOf(answer: (words: string) => Promise<SearchFound> = () => Promise.resolve(found)) {
  const asked: string[] = []
  const source: SearchSource = {
    key: 'probe',
    placeholder: 'Regal, Notiz …',
    about: 'Nach Name und Ort',
    shortest: 2,
    kinds: [
      { key: 'shelf', title: 'Regale', icon: Archive },
      { key: 'note', title: 'Notizen', icon: StickyNote },
    ],
    find: (words) => {
      asked.push(words)

      return answer(words)
    },
  }

  return { source, asked }
}

function frame(search?: SearchSource, at = '/') {
  return inFrame(() => <OfficeFrame navigation={navigation} {...(search ? { search } : {})} />, {
    screens,
    at,
  })
}

/** A window of this width, as far as `matchMedia` is asked about it. */
function windowOf(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const least = /min-width:\s*([\d.]+)rem/.exec(query)

    return {
      matches: least ? width >= Number(least[1]) * 16 : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  signedIn(standInServer())
})

afterEach(() => {
  onlineManager.setOnline(true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the search in the header of the office', () => {
  it('is not there for an application that hands in no source', async () => {
    await frame()
    await screen.findByRole('heading', { name: 'Regale' })

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Suche' })).toBeNull()
  })

  it('shows the hits in the order of the kinds, the words marked, the first chosen', async () => {
    const { source } = sourceOf()
    await frame(source)

    await userEvent.type(await screen.findByRole('combobox', { name: 'Suche' }), 'regal')

    const list = await screen.findByRole('listbox', { name: 'Treffer der Suche' })
    const groups = within(list).getAllByRole('group')

    expect(
      groups.map((group) =>
        within(group)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ),
    ).toEqual([['Regal NordKeller, Raum 2', 'Regal SüdKeller, Raum 3'], ['RegalnotizAm Fenster']])
    expect(within(groups[0] as HTMLElement).getByText('Regale')).toBeTruthy()
    expect(within(groups[1] as HTMLElement).getByText('Notizen')).toBeTruthy()
    // The words as typed, found regardless of case.
    expect([...list.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'Regal',
      'Regal',
      'Regal',
    ])
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.getAttribute('aria-selected')),
    ).toEqual(['true', 'false', 'false'])
    expect(
      within(list)
        .getByRole('option', { name: /Regal Süd/ })
        .getAttribute('href'),
    ).toBe('/regale/s2')
    expect(screen.getByText('Nach Name und Ort')).toBeTruthy()
  })

  it('asks the source with the words trimmed, and only from the fewest characters on', async () => {
    const { source, asked } = sourceOf()
    await frame(source)

    const field = await screen.findByRole('combobox', { name: 'Suche' })

    await userEvent.type(field, 'r')
    // Longer than typing rests: a single character is never asked.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(asked).toEqual([])
    expect(screen.queryByRole('listbox')).toBeNull()

    await userEvent.type(field, 'e   ')
    await screen.findByRole('listbox', { name: 'Treffer der Suche' })

    expect(asked).toEqual(['re'])
  })

  it('asks the source without a network as well, which then searches the device', async () => {
    const { source, asked } = sourceOf(() =>
      Promise.resolve({
        ...found,
        hits: found.hits.slice(0, 1),
        note: 'Ohne Netz: auf dem Gerät gesucht.',
      }),
    )
    await frame(source)
    onlineManager.setOnline(false)

    await userEvent.type(await screen.findByRole('combobox', { name: 'Suche' }), 'regal')

    expect(await screen.findByRole('option', { name: /notiz/ })).toBeTruthy()
    expect(asked).toEqual(['regal'])
    // The note of the source in place of what it looks for.
    expect(screen.getByText('Ohne Netz: auf dem Gerät gesucht.')).toBeTruthy()
    expect(screen.queryByText('Nach Name und Ort')).toBeNull()
  })

  it('chooses with the arrow keys and opens the chosen hit with Enter', async () => {
    const { source } = sourceOf()
    await frame(source)

    const field = await screen.findByRole('combobox', { name: 'Suche' })

    await userEvent.type(field, 'regal')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{ArrowDown}')

    const chosen = screen.getByRole('option', { name: /Regal Süd/ })

    expect(chosen.getAttribute('aria-selected')).toBe('true')
    expect(field.getAttribute('aria-activedescendant')).toBe(chosen.id)

    await userEvent.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Ein Regal' })).toBeTruthy()
    // The search closes and empties on the way.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('closes with Escape', async () => {
    const { source } = sourceOf()
    await frame(source)

    await userEvent.type(await screen.findByRole('combobox', { name: 'Suche' }), 'regal')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('goes into the field with Strg K from anywhere', async () => {
    const { source } = sourceOf()
    await frame(source)
    await screen.findByRole('heading', { name: 'Regale' })

    await userEvent.keyboard('{Control>}k{/Control}')

    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Suche' }))
  })

  it('says when nothing was found, that a kind has more without how many, and why a search failed', async () => {
    let answer: (words: string) => Promise<SearchFound> = () =>
      Promise.resolve({ hits: [], more: [], note: null })
    const { source } = sourceOf((words) => answer(words))
    await frame(source)

    const field = await screen.findByRole('combobox', { name: 'Suche' })

    await userEvent.type(field, 'xy')
    expect(await screen.findByText('Nichts gefunden für „xy“.')).toBeTruthy()

    answer = () => Promise.resolve({ ...found, more: ['shelf'] })
    await userEvent.type(field, 'z')

    const list = await screen.findByRole('listbox')

    expect(within(list).getByText('Weitere Treffer: genauer suchen.')).toBeTruthy()
    expect(list.textContent).not.toMatch(/\d+ weitere/)

    answer = () =>
      Promise.reject(new RequestRefused(400, 'Gesucht wird nach höchstens 100 Zeichen.'))
    await userEvent.type(field, 'w')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Gesucht wird nach höchstens 100 Zeichen.',
    )
  })

  it('leaves the entry with a plain link for a hit that opens elsewhere, and says where', async () => {
    const { source } = sourceOf(() =>
      Promise.resolve({
        hits: [
          {
            kind: 'note',
            id: 'n9',
            title: 'Regalnotiz alt',
            detail: 'Archiv',
            to: '/m/notizen/n9',
            away: 'Öffnet vor Ort',
          },
        ],
        more: [],
        note: null,
      }),
    )
    await frame(source)

    await userEvent.type(await screen.findByRole('combobox', { name: 'Suche' }), 'regal')

    const hit = await screen.findByRole('option', { name: /notiz alt/ })

    expect(hit.getAttribute('href')).toBe('/m/notizen/n9')
    expect(hit.textContent).toContain('Öffnet vor Ort')
  })

  it('shows no hit and goes nowhere whose address leads off this server', async () => {
    const away = { away: 'Öffnet vor Ort', detail: 'Archiv', kind: 'note' } as const
    const { source } = sourceOf(() =>
      Promise.resolve({
        hits: [
          { ...away, id: 'x1', title: 'Regal mit Skript', to: 'javascript:alert(1)' },
          { ...away, id: 'x2', title: 'Regal anderswo', to: '//fremd.example/regal' },
          { ...away, id: 'x3', title: 'Regal mit Schrägstrich', to: '/\\fremd.example/regal' },
          { ...away, id: 'x4', title: 'Regal mit Adresse', to: 'https://fremd.example/regal' },
          { ...away, id: 'n9', title: 'Regal hier', to: '/m/notizen/n9' },
        ],
        more: [],
        note: null,
      }),
    )
    const assign = vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})

    await frame(source)
    await userEvent.type(await screen.findByRole('combobox', { name: 'Suche' }), 'regal')

    const list = await screen.findByRole('listbox')

    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.getAttribute('href')),
    ).toEqual(['/m/notizen/n9'])

    await userEvent.keyboard('{Enter}')

    expect(assign.mock.calls).toEqual([['/m/notizen/n9']])
  })
})

describe('the search of the office below 1024 pixels', () => {
  it('opens over the screen from the magnifier, keeps the name for the ear, and closes with Escape', async () => {
    windowOf(390)
    const { source } = sourceOf()
    await frame(source)

    const header = await screen.findByRole('banner')

    // The name beside the mark makes room for the magnifier and stays the name of the link.
    expect(within(header).getByRole('link', { name: 'Probewerk' })).toBeTruthy()

    await userEvent.click(within(header).getByRole('button', { name: 'Suche' }))

    const dialog = screen.getByRole('dialog', { name: 'Suche' })
    const field = within(dialog).getByRole('combobox', { name: 'Suche' })

    await waitFor(() => {
      expect(document.activeElement).toBe(field)
    })

    await userEvent.type(field, 'regal')

    expect(await within(dialog).findByRole('option', { name: /Regal Nord/ })).toBeTruthy()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Suche' })).toBeNull()
  })
})
