import 'fake-indexeddb/auto'

import { onlineManager } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Archive, StickyNote } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchFound, SearchSource } from '../components/search.js'
import { inFrame, signedIn, standInServer } from '../in-frame.js'
import { SiteSearch } from './search.js'

/**
 * The search on site (opengewerk-haustechnik#125): a field over what a screen
 * shows, and the hits in place of it while words are typed. The application
 * here keeps shelves and notes, as no application does.
 */

function sourceOf(answer: (words: string) => Promise<SearchFound>) {
  const asked: string[] = []
  const source: SearchSource = {
    key: 'probe-site',
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

const found: SearchFound = {
  hits: [
    { kind: 'note', id: 'n1', title: 'Regalnotiz', detail: 'Am Fenster', to: '/notizen/n1' },
    {
      kind: 'note',
      id: 'n2',
      title: 'Alte Regalnotiz',
      detail: 'Archiv',
      to: '/notizen/n2',
      away: 'Öffnet im Büro',
    },
    { kind: 'shelf', id: 's1', title: 'Regal Nord', detail: 'Keller', to: '/m/regale/s1' },
  ],
  more: ['note'],
  note: 'Auf dem Server gesucht.',
}

function start(source: SearchSource) {
  return inFrame(() => <Outlet />, {
    screens: {
      '/': () => (
        <SiteSearch source={source}>
          <p>Was heute ansteht</p>
        </SiteSearch>
      ),
      '/m/regale/$shelfId': () => <h1>Ein Regal</h1>,
    },
  })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  signedIn(standInServer())
})

afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

describe('the search on site', () => {
  it('shows the hits in place of what stood under the field, and brings it back when emptied', async () => {
    const { source, asked } = sourceOf(() => Promise.resolve(found))
    await start(source)

    expect(await screen.findByText('Was heute ansteht')).toBeTruthy()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Suche' }), 'regal')

    const hits = await screen.findByRole('region', { name: 'Treffer der Suche' })

    await within(hits).findByRole('link', { name: /Nord/ })
    expect(screen.queryByText('Was heute ansteht')).toBeNull()
    expect(asked).toEqual(['regal'])
    expect(
      within(hits)
        .getAllByRole('list')
        .map((list) => [
          list.getAttribute('aria-labelledby') === null
            ? null
            : document.getElementById(String(list.getAttribute('aria-labelledby')))?.textContent,
          within(list)
            .getAllByRole('link')
            .map((link) => link.getAttribute('href')),
        ]),
    ).toEqual([
      ['Regale', ['/m/regale/s1']],
      ['Notizen', ['/notizen/n1', '/notizen/n2']],
    ])
    // A hit the entry cannot show says where it opens; the kind with more says so without a number.
    expect(within(hits).getByRole('link', { name: /Alte/ }).textContent).toContain('Öffnet im Büro')
    expect(within(hits).getByText('Weitere Treffer: genauer suchen.')).toBeTruthy()
    expect(within(hits).getByText('Auf dem Server gesucht.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Suche leeren' }))

    expect(await screen.findByText('Was heute ansteht')).toBeTruthy()
    expect((screen.getByRole('searchbox', { name: 'Suche' }) as HTMLInputElement).value).toBe('')
  })

  it('opens a hit of this entry on its page', async () => {
    const { source } = sourceOf(() => Promise.resolve(found))
    await start(source)

    await userEvent.type(await screen.findByRole('searchbox', { name: 'Suche' }), 'regal')
    await userEvent.click(await screen.findByRole('link', { name: /Nord/ }))

    expect(await screen.findByRole('heading', { name: 'Ein Regal' })).toBeTruthy()
  })

  it('asks without a network as well, and says when nothing was found', async () => {
    const { source, asked } = sourceOf(() => Promise.resolve({ hits: [], more: [], note: null }))
    await start(source)
    onlineManager.setOnline(false)

    await userEvent.type(await screen.findByRole('searchbox', { name: 'Suche' }), 'xy')

    expect(await screen.findByText('Nichts gefunden für „xy“.')).toBeTruthy()
    expect(asked).toEqual(['xy'])
  })
})
