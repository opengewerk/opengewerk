import { Link } from '@tanstack/react-router'
import { Fragment } from 'react'
import type { ReactNode } from 'react'

/**
 * A text an application ships as Markdown, read into elements
 * (opengewerk-haustechnik#131): the help beside a screen, a quick guide, a
 * chapter of a manual.
 *
 * A fixed part of Markdown and nothing else: headings of three levels,
 * paragraphs, lists with a dash or a number, and inside a line bold, code and
 * links. That is what a text about a screen needs, and it is little enough to
 * read without a library. Nothing in a text ever becomes HTML: a line is cut
 * into pieces and every piece is a text node, so a text cannot bring a script
 * or a style with it, whoever wrote it. A link leads to a path of the
 * application or to another site over https and nowhere else; one that names
 * anything else stays the signs it was typed with.
 *
 * What a text may not use is named by `markdownProblems`, for the test of an
 * application that holds its texts to this part: a table or a quotation would
 * otherwise show up on a screen as the signs it was typed with.
 */

/** A piece of a line. */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly to: string }
  /** The end of a line inside a paragraph, for a text whose lines are kept as typed. */
  | { readonly kind: 'break' }

/** A block of a text. */
export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: 'paragraph'; readonly line: readonly Inline[] }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly items: readonly (readonly Inline[])[]
    }

const inlinePattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)/g

/**
 * A path of the application: one slash and then no second one and no
 * backslash, which a browser reads as the start of another site.
 */
const insidePattern = /^\/(?![/\\])/
const outsidePattern = /^https:\/\//

/** Whether a link of a text leads where one may: into the application or out over https. */
function leadsSomewhere(to: string): boolean {
  return insidePattern.test(to) || outsidePattern.test(to)
}

/** A line cut into text, bold, code and links. */
export function readInline(line: string): readonly Inline[] {
  const pieces: Inline[] = []
  let from = 0

  for (const found of line.matchAll(inlinePattern)) {
    if (found.index > from) {
      pieces.push({ kind: 'text', text: line.slice(from, found.index) })
    }

    const [whole, strong, code, label, to] = found

    if (strong !== undefined) {
      pieces.push({ kind: 'strong', text: strong })
    } else if (code !== undefined) {
      pieces.push({ kind: 'code', text: code })
    } else if (label !== undefined && to !== undefined) {
      // A script, a file or an address without a scheme is no link: it stays
      // what was typed, so that nobody is led by it.
      pieces.push(
        leadsSomewhere(to) ? { kind: 'link', text: label, to } : { kind: 'text', text: whole },
      )
    }

    from = found.index + whole.length
  }

  if (from < line.length) {
    pieces.push({ kind: 'text', text: line.slice(from) })
  }

  return pieces
}

const headingPattern = /^(#{1,3}) +(.+)$/
const bulletPattern = /^- +(.+)$/
const numberPattern = /^\d+\. +(.+)$/

/**
 * A text read into its blocks. Lines that follow each other without an empty
 * one between them are one paragraph, as in Markdown; an item of a list is one
 * line.
 *
 * With `breaks` the lines of a paragraph keep their ends, for a text typed
 * into a field rather than written as Markdown: an address stands line by
 * line, as its writer sees it in the field (opengewerk-haustechnik#129).
 */
export function readMarkdown(
  source: string,
  { breaks = false }: { readonly breaks?: boolean } = {},
): readonly Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: (readonly Inline[])[] } | null = null

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({
        kind: 'paragraph',
        line: breaks
          ? paragraph.flatMap((line, index): readonly Inline[] =>
              index === 0 ? readInline(line) : [{ kind: 'break' }, ...readInline(line)],
            )
          : readInline(paragraph.join(' ')),
      })
      paragraph = []
    }
  }
  const closeList = () => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
      list = null
    }
  }

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const heading = headingPattern.exec(line)
    const bullet = bulletPattern.exec(line)
    const number = numberPattern.exec(line)

    if (line === '') {
      closeParagraph()
      closeList()
    } else if (heading) {
      closeParagraph()
      closeList()
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length as 1 | 2 | 3,
        text: heading[2] ?? '',
      })
    } else if (bullet || number) {
      const ordered = number !== null

      closeParagraph()

      if (list && list.ordered !== ordered) {
        closeList()
      }

      list ??= { ordered, items: [] }
      list.items.push(readInline((bullet ?? number)?.[1] ?? ''))
    } else {
      closeList()
      paragraph.push(line)
    }
  }

  closeParagraph()
  closeList()

  return blocks
}

/** The first heading of a text, which is what it is called, or null. */
export function markdownTitle(source: string): string | null {
  const first = readMarkdown(source).find((block) => block.kind === 'heading' && block.level === 1)

  return first?.kind === 'heading' ? first.text : null
}

/**
 * What a text uses that is not read here, line by line, in words for a test:
 * a quotation, a table, a picture, a fence of code, HTML, a list inside a
 * list, a heading below the third level, and a link that leads neither into
 * the application nor out of it over `https://`.
 */
export function markdownProblems(source: string): readonly string[] {
  const problems: string[] = []

  source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((raw, index) => {
      const at = `Zeile ${String(index + 1)}`
      const line = raw.trimEnd()

      if (/^\s*>/.test(line)) {
        problems.push(`${at}: ein Zitat`)
      }

      if (/^\s*\|/.test(line)) {
        problems.push(`${at}: eine Tabelle`)
      }

      if (/!\[/.test(line)) {
        problems.push(`${at}: ein Bild`)
      }

      if (/^\s*(```|~~~)/.test(line)) {
        problems.push(`${at}: ein Block Code`)
      }

      if (/<\/?[a-zA-Z][^>]*>/.test(line)) {
        problems.push(`${at}: HTML`)
      }

      if (/^\s+(-|\d+\.) /.test(line)) {
        problems.push(`${at}: eine Liste in einer Liste`)
      }

      if (/^#{4,} /.test(line)) {
        problems.push(`${at}: eine Überschrift unter der dritten Ebene`)
      }

      if (/^(\*|\+) /.test(line)) {
        problems.push(`${at}: ein Listenpunkt ohne Bindestrich`)
      }

      for (const found of line.matchAll(linkPattern)) {
        if (!leadsSomewhere(found[2] ?? '')) {
          problems.push(`${at}: ein Verweis, der weder in die Anwendung noch auf https zeigt`)
        }
      }
    })

  return problems
}

function Line({
  pieces,
  onFollow,
}: {
  readonly pieces: readonly Inline[]
  readonly onFollow?: (() => void) | undefined
}) {
  return (
    <>
      {pieces.map((piece, index) => {
        switch (piece.kind) {
          case 'break':
            return <br key={index} />
          case 'strong':
            return <strong key={index}>{piece.text}</strong>
          case 'code':
            return (
              <code
                key={index}
                className="rounded-[3px] bg-surface-sunken px-1 py-px text-[0.92em] [overflow-wrap:anywhere]"
              >
                {piece.text}
              </code>
            )
          case 'link':
            // A path of the application goes through its router, anything else
            // is another site and says so to the browser.
            return insidePattern.test(piece.to) ? (
              <Link
                key={index}
                to={piece.to}
                className="text-copper-text underline"
                {...(onFollow ? { onClick: onFollow } : {})}
              >
                {piece.text}
              </Link>
            ) : (
              <a
                key={index}
                href={piece.to}
                target="_blank"
                rel="noopener noreferrer"
                className="text-copper-text underline"
              >
                {piece.text}
              </a>
            )
          default:
            return <Fragment key={index}>{piece.text}</Fragment>
        }
      })}
    </>
  )
}

const headingTags = ['h1', 'h2', 'h3', 'h4'] as const

/** A heading at its level in the screen; how it looks is the caller's, by what it is in the text. */
function Heading({
  level,
  className,
  children,
}: {
  readonly level: number
  readonly className: string
  readonly children: string
}) {
  const Tag = headingTags[level - 1] ?? 'h4'

  return <Tag className={className}>{children}</Tag>
}

export interface MarkdownProps {
  readonly source: string
  /**
   * Leaves the first heading out, for a place that shows what a text is
   * called by itself, as the head of a drawer does.
   */
  readonly withoutTitle?: boolean
  /** The type of the entry on site: 17 pixels and more room between the lines. */
  readonly large?: boolean
  /**
   * The type of a page that is read through, as a legal text of the
   * instance is: 15 pixels with room between the lines.
   */
  readonly reading?: boolean
  /** The lines of a paragraph keep their ends, as `readMarkdown` says. */
  readonly breaks?: boolean
  /**
   * The level of the heading the text is called by, which the headings below
   * it follow: 2 where the text stands under the heading of a screen, as in a
   * drawer, and 1 where the text is the screen and the head of the screen
   * says what it is called. A reader goes through a screen by its headings,
   * and a level that is skipped is a place they look for in vain.
   */
  readonly level?: 1 | 2
  /**
   * Told when a link into the application is followed, for a place that
   * lies over the screen and has to make way for it.
   */
  readonly onFollow?: () => void
}

/**
 * A text of the application, read and drawn in the type of a screen. A
 * heading of the second level is a label in small capitals, as over a card;
 * one of the third a line in bold. Which elements they are follows `level`,
 * so that the headings of the screen stay in order.
 */
export function Markdown({
  source,
  withoutTitle = false,
  large = false,
  reading = false,
  breaks = false,
  level = 2,
  onFollow,
}: MarkdownProps) {
  const blocks = readMarkdown(source, { breaks })
  const first = blocks.findIndex((block) => block.kind === 'heading' && block.level === 1)
  const shown = withoutTitle && first !== -1 ? blocks.filter((_, index) => index !== first) : blocks
  // The levels the text uses, in their order, so that a text somebody writes
  // from the second level on, or with one left out, still gives the screen
  // its headings without a gap. Counted before the title is left out, which
  // the head of the place stands in for.
  const used = [
    ...new Set(blocks.flatMap((block) => (block.kind === 'heading' ? [block.level] : []))),
  ].sort((one, other) => one - other)
  const text = large
    ? 'text-[17px] leading-[1.5]'
    : reading
      ? 'text-[15px] leading-[1.6]'
      : 'text-[13px] leading-[1.55]'
  const nodes: ReactNode[] = shown.map((block, index) => {
    switch (block.kind) {
      case 'heading':
        return (
          <Heading
            key={index}
            level={level + used.indexOf(block.level)}
            className={
              block.level === 1
                ? large || reading
                  ? 'text-[20px] font-semibold'
                  : 'text-[16px] font-semibold'
                : block.level === 2
                  ? 'mt-1 font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint'
                  : `${text} font-semibold`
            }
          >
            {block.text}
          </Heading>
        )
      case 'list': {
        const items = block.items.map((item, at) => (
          <li key={at} className="mb-1.5 last:mb-0">
            <Line pieces={item} onFollow={onFollow} />
          </li>
        ))

        return block.ordered ? (
          <ol key={index} className={`${text} list-decimal pl-[18px]`}>
            {items}
          </ol>
        ) : (
          <ul key={index} className={`${text} list-disc pl-[18px]`}>
            {items}
          </ul>
        )
      }
      default:
        return (
          <p key={index} className={text}>
            <Line pieces={block.line} onFollow={onFollow} />
          </p>
        )
    }
  })

  return <div className="flex flex-col gap-3 text-ink">{nodes}</div>
}
