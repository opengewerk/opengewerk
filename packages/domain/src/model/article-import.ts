import { isCalendarDay } from './article.js'
import type { LineUnit, PriceBase } from './document-line.js'
import type { Id, IsoDate } from './identifier.js'
import type { SupplierId } from './supplier.js'

export type ArticleImportId = Id<'article-import'>

/**
 * An import of articles and prices from DATANORM (#297), from the files the
 * office uploads to the preview and the takeover.
 *
 * `reading`: the files are read and compared with the catalogue; `ready`: the
 * preview stands and waits for a decision; `applying`: the takeover runs;
 * `applied`; `failed`, reading or taking over broke off and left nothing
 * half, which `problem` says in words; `discarded`, the preview was thrown
 * away. The change log holds an import as one record, the changes of this
 * row, and not field by field for every article (decided on 28.09.2026): the
 * files stay stored unchanged and prove every value.
 */
export const articleImportStatuses = [
  'reading',
  'ready',
  'applying',
  'applied',
  'failed',
  'discarded',
] as const

export type ArticleImportStatus = (typeof articleImportStatuses)[number]

/** The characters a file is read in; null in the options is: as the bytes show. */
export type ImportCharset = 'utf-8' | 'cp850' | 'windows-1252'

export interface ImportedFile {
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

/** A price as the preview shows it: the amount and how many units it is for. */
export interface ImportPrice {
  readonly cents: number
  readonly priceBase: PriceBase
}

/**
 * One article of the preview. `created`: new in the catalogue; `linked`: an
 * article of the business with the same EAN, which the supplier is added to;
 * `updated`: sold by the supplier already, with a new price; `removed`: the
 * supplier no longer sells it. `renumbered` says that the supplier's number
 * was taken, and the own one got the short code.
 */
export interface ImportSample {
  readonly kind: 'created' | 'linked' | 'updated' | 'removed'
  readonly supplierNumber: string
  readonly number: string
  readonly renumbered: boolean
  readonly designation: string
  readonly unit: LineUnit
  readonly listPrice: ImportPrice | null
  readonly netPrice: ImportPrice | null
  /** The list price the supplier had before, for an update. */
  readonly previousListPrice: ImportPrice | null
}

/** What reading found, and after the takeover what it did. */
export interface ImportSummary {
  readonly articles: number
  readonly created: number
  readonly linked: number
  readonly updated: number
  readonly unchanged: number
  readonly removed: number
  readonly renumbered: number
  /** The short code a renumbered article got, the supplier's own or one from its name. */
  readonly shortCode: string
  readonly unknownUnits: readonly { readonly text: string; readonly articles: number }[]
  readonly problems: number
  /** The first lines that could not be read, with their file and reason. */
  readonly problemLines: readonly {
    readonly file: string
    readonly line: number
    readonly reason: string
  }[]
  readonly files: readonly {
    readonly name: string
    readonly charset: ImportCharset
    readonly lines: number
  }[]
  /** Files that are no DATANORM file. */
  readonly skipped: readonly string[]
  /** Kinds of record not taken over, such as the surcharges of Z. */
  readonly ignored: readonly { readonly letter: string; readonly lines: number }[]
  /** The day the header of the files names. */
  readonly fileDate: IsoDate | null
  /** The first articles of each kind, for the table of the preview. */
  readonly samples: readonly ImportSample[]
}

export interface ArticleImport {
  readonly id: ArticleImportId
  readonly supplierId: SupplierId
  readonly status: ArticleImportStatus
  readonly files: readonly ImportedFile[]
  /** Null: as the bytes of each file show. */
  readonly charset: ImportCharset | null
  /** From when the prices apply, never before the day of the takeover. */
  readonly validFrom: IsoDate
  /** Whether a list price becomes the selling price as well (proposed on). */
  readonly listAsSelling: boolean
  readonly summary: ImportSummary | null
  readonly problem: string | null
  readonly createdAt: string
  readonly appliedAt: string | null
  /** While it is taken over: how many rows are written, of how many. */
  readonly progress: { readonly done: number; readonly total: number } | null
}

/** How many files one import takes, and how long a name of one may be. */
export const importFileLimits = { files: 20, name: 200 } as const

/** How many lines a summary names at most, of problems and of samples each. */
export const importSummaryLimits = { problemLines: 200, samplesPerKind: 20 } as const

/**
 * The day prices of a delivery are proposed to apply from: the later of the
 * day its header names and today. A price never applies backwards, so an
 * old file does not rewrite the price of a document already written.
 */
export function proposedValidFrom(fileDate: IsoDate | null, today: IsoDate): IsoDate {
  return fileDate !== null && fileDate > today ? fileDate : today
}

/** What is wrong with the day chosen for the prices, or null. */
export function validFromProblem(value: unknown, today: IsoDate): string | null {
  if (!isCalendarDay(value)) {
    return 'Die Preise gelten ab einem Tag des Kalenders.'
  }

  return value < today ? 'Ein Preis gilt nicht rückwirkend, frühestens ab heute.' : null
}
