import { plainInMarkdown } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { text } from './helpers.js'
import { inlineHtml, markdownHtml, markdownPrintJob } from './markdown.js'

/**
 * A document made as Markdown for the renderer (#319): the marks a template
 * uses become tags, every character of text is escaped, and a text a person
 * typed, escaped with `plainInMarkdown`, comes out as exactly that text.
 */
describe('a document made as Markdown', () => {
  it('reads the marks of a line and escapes every character of text', () => {
    expect(inlineHtml('**Zusage:** `audit_entries` und <b>&')).toBe(
      '<strong>Zusage:</strong> <code>audit_entries</code> und &lt;b&gt;&amp;',
    )
    expect(inlineHtml('[Vorlage](https://opengewerk.de/auftragsverarbeitung/)')).toBe(
      '<a href="https://opengewerk.de/auftragsverarbeitung/">Vorlage</a>',
    )
    // A link anywhere else stays text, and an escaped mark is the character.
    expect(inlineHtml('[hier](javascript:alert(1))')).toBe('[hier](javascript:alert(1))')
    expect(inlineHtml('Elektro \\*Nord\\* \\| GmbH \\<script\\>')).toBe(
      'Elektro *Nord* | GmbH &lt;script&gt;',
    )
  })

  it('prints a typed text as that text, whatever marks it holds', () => {
    for (const typed of [
      '**fett** und _schräg_',
      '# Überschrift',
      '[DATEV](https://datev.example)',
      'A | B',
      '<img src=x onerror=alert(1)>',
      '`code` \\ Rückstrich',
    ]) {
      expect(inlineHtml(plainInMarkdown(typed))).toBe(text(typed))
    }
  })

  it('reads headings, paragraphs, lists and tables, with an escaped bar inside a cell', () => {
    expect(
      markdownHtml(
        [
          '# Titel',
          '',
          'Ein Absatz',
          '',
          '---',
          '',
          '- eins',
          '- zwei',
          '',
          '1. erst',
          '2. dann',
          '',
          '| Was | Stand |',
          '| --- | --- |',
          '| A \\| B | aus |',
        ].join('\n'),
      ),
    ).toBe(
      [
        '<h1>Titel</h1>',
        '<p>Ein Absatz</p>',
        '<hr>',
        '<ul><li>eins</li><li>zwei</li></ul>',
        '<ol><li>erst</li><li>dann</li></ol>',
        '<table><thead><tr><th>Was</th><th>Stand</th></tr></thead><tbody><tr><td>A | B</td><td>aus</td></tr></tbody></table>',
      ].join('\n'),
    )
  })

  it('escapes the sentence of the footer', () => {
    expect(markdownPrintJob('# Titel', 'Fuß <b>').footerHtml).toContain('Fuß &lt;b&gt;')
  })
})
