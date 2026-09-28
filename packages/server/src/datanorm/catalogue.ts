import { eanProblem, type LineUnit, type PriceBase } from '@opengewerk/domain'

import {
  type ArticleRecord,
  type Header,
  headerOf,
  type LineProblem,
  type PriceKind,
  recordOf,
} from './records.js'
import { unitOf } from './units.js'

/**
 * What the files of one supplier say (#297), read and put together, before a
 * single row is written: the articles with their texts, prices and groups,
 * the price changes of a price file, the articles to delete, and every line
 * that could not be read. A delivery is often several files, the articles in
 * DATANORM.001, the prices in DATPREIS.001, the groups in DATANORM.WRG and
 * the discounts in DATANORM.RAB, and they are read in that order.
 */

export interface CatalogueArticle {
  /** The supplier's number, which the next file finds the article by. */
  readonly number: string
  /** The line of the file, for the preview. */
  readonly file: string
  readonly line: number
  readonly processing: 'new' | 'change'
  /** Both short text lines, the second usually the type. */
  readonly designation: string
  /** Dimension text and long text, a line each. */
  readonly description: string | null
  readonly unit: LineUnit
  /** As the file writes it, when it was not recognised. */
  readonly unknownUnit: string | null
  readonly price: {
    readonly kind: PriceKind
    readonly cents: number
    readonly priceBase: PriceBase
  } | null
  readonly discountGroup: string | null
  /** The group of goods by name, where the file names it, else by its code. */
  readonly groupOfGoods: string | null
  readonly ean: string | null
}

export interface CatalogueFile {
  readonly name: string
  readonly text: string
}

export interface Catalogue {
  readonly header: Header | null
  readonly articles: ReadonlyMap<string, CatalogueArticle>
  /** New prices from a price file, by the supplier's number. */
  readonly priceChanges: ReadonlyMap<
    string,
    {
      readonly kind: PriceKind
      readonly cents: number
      readonly file: string
      readonly line: number
    }
  >
  /** The numbers the supplier no longer sells. */
  readonly deletions: ReadonlySet<string>
  readonly problems: readonly (LineProblem & { readonly file: string })[]
  /** Kinds of record not taken over, by letter, and how many lines. */
  readonly ignored: ReadonlyMap<string, number>
  /** How many lines each file had, the header included. */
  readonly lines: number
}

interface Pending {
  article: ArticleRecord & { readonly file: string }
  ean: string | null
  /** The line of the second record, which the EAN came in. */
  eanLine: number
  group: string
  dimension: { index: number; text: string }[]
}

/** The lines of a text, whatever ends them, without the end-of-file byte of DOS. */
function linesOf(text: string): string[] {
  let end = text.length

  while (end > 0 && text.charCodeAt(end - 1) === endOfFile) {
    end -= 1
  }

  return text.slice(0, end).split(/\r\n|\n|\r/)
}

/** SUB, which DOS wrote at the end of a text file. */
const endOfFile = 0x1a

/** Reads the files of one delivery into one catalogue. */
export function readCatalogue(files: readonly CatalogueFile[]): Catalogue {
  let header: Header | null = null
  const pending = new Map<string, Pending>()
  const longTexts = new Map<string, { index: number; text: string }[]>()
  const groupNames = new Map<string, string>()
  const priceChanges = new Map<
    string,
    { kind: PriceKind; cents: number; file: string; line: number }
  >()
  const deletions = new Set<string>()
  const problems: (LineProblem & { file: string })[] = []
  const ignored = new Map<string, number>()
  let lines = 0

  for (const file of files) {
    const all = linesOf(file.text)

    for (const [index, text] of all.entries()) {
      const line = index + 1

      lines += text === '' ? 0 : 1

      if (text.startsWith('V')) {
        const found = headerOf(text, line)

        if (found.version !== '04') {
          problems.push({
            file: file.name,
            line,
            reason:
              found.version === '05'
                ? 'Die Datei ist DATANORM 5. Gelesen wird bisher DATANORM 4.'
                : `Die Datei nennt die Fassung "${found.version}". Gelesen wird DATANORM 4.`,
          })

          // A file of another version is not read at all: its fields sit
          // elsewhere, and reading it anyway would fill articles with rubbish.
          break
        }

        header ??= found
        continue
      }

      const record = recordOf(text, line)

      if (record === null) {
        continue
      }

      if (!('kind' in record)) {
        problems.push({ ...record, file: file.name })
        continue
      }

      switch (record.kind) {
        case 'article':
          if (record.processing === 'delete') {
            deletions.add(record.number)
            pending.delete(record.number)
          } else {
            pending.set(record.number, {
              article: { ...record, file: file.name },
              ean: null,
              eanLine: record.line,
              group: '',
              dimension: [],
            })
          }

          break

        case 'extra': {
          // The second record of an article follows its first one; one for an
          // article this delivery does not bring changes nothing here.
          const entry = pending.get(record.number)

          if (entry) {
            entry.ean = record.ean === '' ? null : record.ean
            entry.eanLine = record.line
            entry.group = record.group
          }

          break
        }

        case 'dimension': {
          const entry = pending.get(record.key)

          if (entry) {
            entry.dimension.push(...record.lines)
          }

          break
        }

        case 'long-text':
          longTexts.set(record.key, [...(longTexts.get(record.key) ?? []), ...record.lines])
          break

        case 'prices':
          for (const change of record.changes) {
            priceChanges.set(change.number, {
              kind: change.kind,
              cents: change.cents,
              file: file.name,
              line,
            })
          }

          break

        case 'group':
          groupNames.set(
            record.group === '' ? record.mainGroup : `${record.mainGroup}:${record.group}`,
            record.name,
          )
          break

        case 'discount':
          // The names of the discount groups; their rates come with
          // purchasing and costing in Phase 4 (decided on 27.09.2026).
          break

        case 'ignored':
          ignored.set(record.letter, (ignored.get(record.letter) ?? 0) + 1)
          break
      }
    }
  }

  const articles = new Map<string, CatalogueArticle>()

  for (const [number, { article, ean, eanLine, group, dimension }] of pending) {
    const { unit, known } = unitOf(article.unit)
    const long = article.longTextKey === '' ? [] : (longTexts.get(article.longTextKey) ?? [])
    const inOrder = (lines: readonly { index: number; text: string }[]) =>
      [...lines].sort((left, right) => left.index - right.index).map((entry) => entry.text)
    // The long text before the dimension text, as the descriptions order them.
    const text = [...inOrder(long), ...inOrder(dimension)].filter((entry) => entry !== '')
    const validEan = ean !== null && eanProblem(ean) === null ? ean : null

    if (ean !== null && validEan === null) {
      problems.push({
        file: article.file,
        line: eanLine,
        reason: `Die EAN von ${number} stimmt nicht und wird nicht übernommen.`,
      })
    }

    // A group by its name where the group file has one, the group of the
    // second record before the main group of the first.
    const groupKey = group !== '' ? `${article.mainGroup}:${group}` : article.mainGroup
    const groupOfGoods =
      groupNames.get(groupKey) ??
      (group !== '' ? groupNames.get(article.mainGroup) : undefined) ??
      (group !== '' ? group : article.mainGroup !== '' ? article.mainGroup : null)

    articles.set(number, {
      number,
      file: article.file,
      line: article.line,
      processing: article.processing === 'change' ? 'change' : 'new',
      designation: [article.shortText1, article.shortText2].filter((part) => part !== '').join(' '),
      description: text.length > 0 ? text.join('\n') : null,
      unit,
      unknownUnit: known ? null : article.unit,
      price: article.price,
      discountGroup: article.discountGroup === '' ? null : article.discountGroup,
      groupOfGoods,
      ean: validEan,
    })
  }

  return { header, articles, priceChanges, deletions, problems, ignored, lines }
}
