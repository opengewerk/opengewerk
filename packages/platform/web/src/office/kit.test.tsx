import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { InRouter } from '../in-router.js'
import {
  Chip,
  Crumbs,
  Empty,
  FactList,
  FilterSelect,
  NoteBox,
  PageHead,
  RecordColumns,
} from './kit.js'

/**
 * The pieces every office screen is built from (#219). What is held here is
 * what a reader and a keyboard get from them: one title to a screen, a path
 * that is a list of links, facts as terms and values, a filter that says
 * whether it is on.
 */

async function shown(node: ReactNode) {
  const result = render(
    <InRouter>
      <div data-testid="shown">{node}</div>
    </InRouter>,
  )

  await screen.findByTestId('shown')

  return result
}

describe('the head of a screen', () => {
  it('has one title, the path above it as links, and the actions beside it', async () => {
    await shown(
      <PageHead
        title="Regal am Fenster"
        crumbs={[
          { to: '/regale', label: 'Regale' },
          { to: '/regale/werkstatt', label: 'Werkstatt' },
        ]}
        badges={<span>voll</span>}
        count="5 Böden"
        sub="seit dem 12.03.2024"
        actions={<button type="button">Bearbeiten</button>}
      />,
    )

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Regal am Fenster')

    const path = screen.getByRole('navigation', { name: 'Pfad' })

    expect(
      within(path)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Regale', '/regale'],
      ['Werkstatt', '/regale/werkstatt'],
    ])
    expect(screen.getByText('voll')).toBeTruthy()
    expect(screen.getByText('5 Böden')).toBeTruthy()
    expect(screen.getByText('seit dem 12.03.2024')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeTruthy()
  })

  it('has the way back to the list for a phone, beside the path for a desk', async () => {
    await shown(
      <PageHead
        title="Regal am Fenster"
        crumbs={[{ to: '/regale', label: 'Regale' }]}
        phoneBack={{ to: '/regale', label: 'Regale' }}
      />,
    )

    // Both are in the page; the stylesheet shows one of them at a width.
    expect(screen.getAllByRole('link', { name: 'Regale' })).toHaveLength(2)
  })

  it('has no path where a screen gives none', async () => {
    await shown(<PageHead title="Regale" />)

    expect(screen.queryByRole('navigation', { name: 'Pfad' })).toBeNull()
  })

  it('names every step of a path by itself too', async () => {
    await shown(<Crumbs items={[{ to: '/regale', label: 'Regale' }]} />)

    expect(screen.getByRole('link', { name: 'Regale' }).getAttribute('href')).toBe('/regale')
  })
})

describe('the facts of a record', () => {
  it('are terms with their values, and say in words where one is missing', () => {
    render(
      <FactList
        facts={[
          { label: 'Raum', value: 'Werkstatt' },
          { label: 'Schlüssel bei', value: '' },
          { label: 'Seit', value: null },
          { label: 'Böden', value: <strong>5</strong> },
        ]}
      />,
    )

    const terms = screen.getAllByRole('term').map((term) => term.textContent)
    const values = screen.getAllByRole('definition').map((value) => value.textContent)

    expect(terms).toEqual(['Raum', 'Schlüssel bei', 'Seit', 'Böden'])
    // A word and not a dash: a dash in a value is a placeholder.
    expect(values).toEqual(['Werkstatt', 'nicht angegeben', 'nicht angegeben', '5'])
  })

  it('stand beside the tables of a record, after them in the page', () => {
    render(<RecordColumns main={<p>Tabellen</p>} side={<p>Angaben</p>} />)

    const main = screen.getByText('Tabellen')
    const side = screen.getByText('Angaben')

    // The order a reader and the Tab key follow, at every width.
    expect(main.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the filters of a list', () => {
  it('say whether they are on, and tell the screen when they are pressed', async () => {
    const pressed = vi.fn()

    render(
      <>
        <Chip pressed onPress={() => {}}>
          Alle
        </Chip>
        <Chip pressed={false} onPress={pressed}>
          Keller
        </Chip>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Alle' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Keller' }).getAttribute('aria-pressed')).toBe(
      'false',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Keller' }))

    expect(pressed).toHaveBeenCalledOnce()
  })

  it('offer a choice under a label that is heard and not shown', async () => {
    const chosen = vi.fn()

    render(
      <FilterSelect
        label="Zeitraum"
        width="w-[176px]"
        value="week"
        options={[
          { value: 'week', label: 'Diese Woche' },
          { value: 'month', label: 'Dieser Monat' },
        ]}
        onChange={chosen}
      />,
    )

    await userEvent.selectOptions(screen.getByLabelText('Zeitraum'), 'month')

    expect(chosen).toHaveBeenCalledWith('month')
  })
})

describe('what a card says when there is something to say', () => {
  it('is a sentence, with an action where one is given', () => {
    render(
      <>
        <Empty action={<button type="button">Anlegen</button>}>Noch nichts hier.</Empty>
        <NoteBox tone="waiting" icon={TriangleAlert} action={<button type="button">Los</button>}>
          Das wartet.
        </NoteBox>
      </>,
    )

    expect(screen.getByText('Noch nichts hier.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeTruthy()
    expect(screen.getByText('Das wartet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Los' })).toBeTruthy()
  })
})
