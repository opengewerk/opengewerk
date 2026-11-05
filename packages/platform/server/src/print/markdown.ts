import type { PrintJob } from './renderer.js'
import { fontFaces, text, typeface } from './helpers.js'

/**
 * A document made as Markdown, turned into a page for the renderer: the
 * documents on data protection an application makes from a template and from
 * what its business entered. It reads exactly what such a template uses:
 * headings of three levels, paragraphs, lists of one line per item, numbered
 * lists, tables, a rule, strong text, code and links to pages on the web.
 * Every character of the text is escaped, and what a person entered comes
 * escaped into the Markdown already (`plainInMarkdown`), so nothing of it
 * becomes a mark, a tag or a link.
 */

/** The marks within a line: `**strong**`, `` `code` ``, `[words](https://…)` and a mark escaped by a backslash. */
export function inlineHtml(line: string): string {
  let html = ''
  let at = 0

  while (at < line.length) {
    const rest = line.slice(at)

    if (rest.startsWith('\\') && rest.length > 1) {
      html += text(rest.charAt(1))
      at += 2
      continue
    }

    if (rest.startsWith('**')) {
      const end = line.indexOf('**', at + 2)

      if (end > at + 2) {
        html += `<strong>${inlineHtml(line.slice(at + 2, end))}</strong>`
        at = end + 2
        continue
      }
    }

    if (rest.startsWith('`')) {
      const end = line.indexOf('`', at + 1)

      if (end > at) {
        html += `<code>${text(line.slice(at + 1, end))}</code>`
        at = end + 1
        continue
      }
    }

    const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/.exec(rest)

    if (link !== null) {
      html += `<a href="${text(link[2] ?? '')}">${inlineHtml(link[1] ?? '')}</a>`
      at += link[0].length
      continue
    }

    // Up to the next character that may begin a mark.
    const next = rest.slice(1).search(/[\\*`[]/)
    const run = next < 0 ? rest : rest.slice(0, next + 1)

    html += text(run)
    at += run.length
  }

  return html
}

/** The cells of a line of a table, split at every `|` that no backslash escapes. */
function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''

  for (let at = 0; at < inner.length; at += 1) {
    const character = inner.charAt(at)

    if (character === '\\' && at + 1 < inner.length) {
      cell += character + inner.charAt(at + 1)
      at += 1
    } else if (character === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }

  cells.push(cell.trim())

  return cells
}

/** Markdown of a document as HTML, block by block. */
export function markdownHtml(source: string): string {
  const lines = source.split('\n')
  const blocks: string[] = []
  let at = 0
  const run = (test: (line: string) => boolean): string[] => {
    const found: string[] = []

    while (at < lines.length && test(lines[at] ?? '')) {
      found.push(lines[at] ?? '')
      at += 1
    }

    return found
  }

  while (at < lines.length) {
    const line = lines[at] ?? ''
    const heading = /^(#{1,3}) (.*)$/.exec(line)

    if (line.trim() === '') {
      at += 1
    } else if (line === '---') {
      blocks.push('<hr>')
      at += 1
    } else if (heading !== null) {
      const level = String(heading[1]?.length ?? 1)

      blocks.push(`<h${level}>${inlineHtml(heading[2] ?? '')}</h${level}>`)
      at += 1
    } else if (line.startsWith('|')) {
      const [head = '', , ...body] = run((each) => each.startsWith('|'))

      blocks.push(
        `<table><thead><tr>${cellsOf(head)
          .map((cell) => `<th>${inlineHtml(cell)}</th>`)
          .join('')}</tr></thead><tbody>${body
          .map(
            (row) =>
              `<tr>${cellsOf(row)
                .map((cell) => `<td>${inlineHtml(cell)}</td>`)
                .join('')}</tr>`,
          )
          .join('')}</tbody></table>`,
      )
    } else if (line.startsWith('- ')) {
      const items = run((each) => each.startsWith('- '))

      blocks.push(
        `<ul>${items.map((item) => `<li>${inlineHtml(item.slice(2))}</li>`).join('')}</ul>`,
      )
    } else if (/^\d+\. /.test(line)) {
      const items = run((each) => /^\d+\. /.test(each))

      blocks.push(
        `<ol>${items.map((item) => `<li>${inlineHtml(item.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`,
      )
    } else {
      const paragraph = run(
        (each) => each.trim() !== '' && each !== '---' && !/^(#{1,3} |\||- |\d+\. )/.test(each),
      )

      blocks.push(`<p>${inlineHtml(paragraph.join(' '))}</p>`)
    }
  }

  return blocks.join('\n')
}

/** A document made as Markdown, printed A4 upright with a sentence and the page count in the footer. */
export function markdownPrintJob(markdown: string, footer: string): PrintJob {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<style>
${fontFaces([400, 600])}
* { box-sizing: border-box; }
body { margin: 0; font-family: ${typeface}; font-size: 9.5pt; line-height: 1.4; color: #1b2430; }
h1 { margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1.5px solid #1b2430; font-size: 17pt; font-weight: 600; }
h2 { margin: 16px 0 6px; font-size: 12pt; font-weight: 600; break-after: avoid; }
h3 { margin: 12px 0 4px; font-size: 10.5pt; font-weight: 600; break-after: avoid; }
p { margin: 0 0 6px; }
ul, ol { margin: 0 0 6px; padding-left: 18px; }
li { margin: 0 0 3px; }
hr { border: 0; border-top: 1px solid #ddd6cc; margin: 12px 0; }
code { font-family: ui-monospace, monospace; font-size: 8.5pt; }
a { color: #1b2430; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
th { text-align: left; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #555; padding: 4px 6px; border-bottom: 1px solid #8a8178; background: #f1ede6; }
td { padding: 3px 6px; border-bottom: 1px solid #ddd6cc; vertical-align: top; font-size: 8.5pt; }
tr { break-inside: avoid; }
</style>
</head>
<body>${markdownHtml(markdown)}</body>
</html>`
  const footerHtml = `<style>${fontFaces([400])}</style><div style="font-family: ${typeface}; font-size: 7pt; color: #555; width: 100%; padding: 0 14mm; display: flex; justify-content: space-between; align-items: flex-end;"><div>${text(footer)}</div><div>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div></div>`

  return {
    html,
    footerHtml,
    margin: { top: '14mm', right: '14mm', bottom: '18mm', left: '14mm' },
  }
}
