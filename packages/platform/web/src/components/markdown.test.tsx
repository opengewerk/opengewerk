import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { InRouter } from '../in-router.js'
import { Markdown, markdownProblems, markdownTitle, readInline, readMarkdown } from './markdown.js'
import type { MarkdownProps } from './markdown.js'

/**
 * A text an application ships as Markdown (opengewerk-haustechnik#131). What
 * these hold is the part of Markdown that is read, that a text never becomes
 * HTML, and what a test of an application is told about a text that uses more.
 */

const text = [
  '# Regale',
  '',
  'Hier stehen die **Regale** des Lagers,',
  'eines je Zeile.',
  '',
  '## Kurzanleitung',
  '',
  '1. Ein Regal anlegen.',
  '2. Die Nummer `R-12` vergeben.',
  '',
  '- Ein Punkt',
  '- Noch einer, mit [den Notizen](/notizen)',
  '',
  '### Sonderfall',
  '',
  'Mehr steht im [Handbuch](https://example.org/handbuch).',
].join('\n')

describe('a text read into its blocks', () => {
  it('reads headings of three levels, paragraphs and both kinds of list', () => {
    expect(readMarkdown(text).map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'list',
      'heading',
      'paragraph',
    ])
    expect(
      readMarkdown(text).flatMap((block) => (block.kind === 'heading' ? [block.level] : [])),
    ).toEqual([1, 2, 3])
  })

  it('takes lines that follow each other as one paragraph', () => {
    const [, paragraph] = readMarkdown(text)

    expect(paragraph).toEqual({
      kind: 'paragraph',
      line: [
        { kind: 'text', text: 'Hier stehen die ' },
        { kind: 'strong', text: 'Regale' },
        { kind: 'text', text: ' des Lagers, eines je Zeile.' },
      ],
    })
  })

  it('keeps a numbered list and one with dashes apart, although no empty line stands between them', () => {
    const lists = readMarkdown('1. Eins\n2. Zwei\n- Drei\n- Vier').flatMap((block) =>
      block.kind === 'list' ? [{ ordered: block.ordered, items: block.items.length }] : [],
    )

    expect(lists).toEqual([
      { ordered: true, items: 2 },
      { ordered: false, items: 2 },
    ])
  })

  it('reads the line ends of every system', () => {
    expect(readMarkdown('# Titel\r\n\r\nEin Absatz.\r\n')).toEqual(
      readMarkdown('# Titel\n\nEin Absatz.\n'),
    )
  })

  it('cuts a line into text, bold, code and links', () => {
    expect(readInline('Die Nummer `R-12` steht **vorn**, siehe [Notizen](/notizen).')).toEqual([
      { kind: 'text', text: 'Die Nummer ' },
      { kind: 'code', text: 'R-12' },
      { kind: 'text', text: ' steht ' },
      { kind: 'strong', text: 'vorn' },
      { kind: 'text', text: ', siehe ' },
      { kind: 'link', text: 'Notizen', to: '/notizen' },
      { kind: 'text', text: '.' },
    ])
  })

  it('calls a text by its first heading, and by nothing where it has none', () => {
    expect(markdownTitle(text)).toBe('Regale')
    expect(markdownTitle('## Nur ein Abschnitt\n\nEin Absatz.')).toBeNull()
  })
})

/** A text on a screen, once the router around it stands. */
async function drawn(source: string, props: Partial<MarkdownProps> = {}) {
  const shown = render(
    <InRouter>
      <Markdown source={source} {...props} />
    </InRouter>,
  )

  await waitFor(() => {
    expect(shown.container.textContent).not.toBe('')
  })

  return shown
}

describe('a text drawn on a screen', () => {
  it('draws the headings, the paragraphs and the lists as what they are', async () => {
    await drawn(text)

    expect(screen.getByRole('heading', { level: 2, name: 'Regale' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Kurzanleitung' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 4, name: 'Sonderfall' })).toBeTruthy()

    const [numbered, dashed] = screen.getAllByRole('list')

    expect(numbered?.tagName).toBe('OL')
    expect(dashed?.tagName).toBe('UL')
    expect(
      within(numbered as HTMLElement)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Ein Regal anlegen.', 'Die Nummer R-12 vergeben.'])
    expect(screen.getByText('Regale', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText('R-12', { selector: 'code' })).toBeTruthy()
  })

  it('leaves the first heading out where the place says what the text is called', async () => {
    await drawn(text, { withoutTitle: true })

    expect(screen.queryByRole('heading', { name: 'Regale' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Kurzanleitung' })).toBeTruthy()
  })

  it('puts its headings right under the head of a screen where the text is the screen', async () => {
    // The head of the screen is the first level and says what the text is
    // called; a section of the text is the second then, and not the third,
    // which would leave a level out for a reader who goes by headings.
    await drawn(text, { withoutTitle: true, level: 1 })

    expect(screen.getByRole('heading', { level: 2, name: 'Kurzanleitung' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Sonderfall' })).toBeTruthy()
    expect(screen.getAllByRole('heading').map((heading) => heading.tagName)).toEqual(['H2', 'H3'])
  })

  it('leads into the application by its router and out of it without handing the page over', async () => {
    await drawn(text)

    const inside = screen.getByRole('link', { name: 'den Notizen' })
    const outside = screen.getByRole('link', { name: 'Handbuch' })

    expect(inside.getAttribute('href')).toBe('/notizen')
    expect(inside.getAttribute('rel')).toBeNull()
    expect(outside.getAttribute('href')).toBe('https://example.org/handbuch')
    // Another site opens beside the application, which keeps what is on its
    // screen, and learns nothing of the page it was opened from.
    expect(outside.getAttribute('target')).toBe('_blank')
    expect(outside.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('never makes an element out of what a text says', async () => {
    // Whoever writes a text, it brings no script, no picture and no style
    // with it: what looks like HTML stays the signs it was typed with.
    const { container } = await drawn(
      [
        '# Titel <img src=x onerror=alert(1)>',
        '',
        '<script>alert(1)</script> und <b>fett</b>',
        '',
        '- <iframe src="https://example.org"></iframe>',
        '',
        '[Verweis](javascript:alert(1)) und [nach draußen](//example.org) und [auch](/\\example.org)',
      ].join('\n'),
    )

    // Neither a script behind a link nor an address a browser would read as
    // another site: such a link is no link.
    expect(container.querySelector('script, img, iframe, b, a')).toBeNull()
    expect(container.textContent).toContain('[Verweis](javascript:alert(1)')
    expect(container.textContent).toContain('<script>alert(1)</script> und <b>fett</b>')
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('what a text uses beyond the part that is read', () => {
  it('finds nothing in a text that keeps to it', () => {
    expect(markdownProblems(text)).toEqual([])
  })

  it('names the line and what stands there', () => {
    expect(
      markdownProblems(
        [
          '# Titel',
          '> Ein Zitat',
          '| a | b |',
          '![Bild](/bild.png)',
          '```',
          '<b>fett</b>',
          '- Punkt',
          '  - darunter',
          '#### Zu tief',
          '* Stern',
          '[weg](http://example.org)',
          '[böse](javascript:alert)',
        ].join('\n'),
      ),
    ).toEqual([
      'Zeile 2: ein Zitat',
      'Zeile 3: eine Tabelle',
      'Zeile 4: ein Bild',
      'Zeile 5: ein Block Code',
      'Zeile 6: HTML',
      'Zeile 8: eine Liste in einer Liste',
      'Zeile 9: eine Überschrift unter der dritten Ebene',
      'Zeile 10: ein Listenpunkt ohne Bindestrich',
      'Zeile 11: ein Verweis, der weder in die Anwendung noch auf https zeigt',
      'Zeile 12: ein Verweis, der weder in die Anwendung noch auf https zeigt',
    ])
  })
})
