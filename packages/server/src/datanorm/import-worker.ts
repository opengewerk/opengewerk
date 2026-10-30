import { parentPort } from 'node:worker_threads'

import { newId } from '@opengewerk/platform-server'

import type { DatanormCharset } from './charset.js'
import { type Holdings, ImportRefused, type ImportPlan, planImport } from './plan.js'
import { type ReadDelivery, readDelivery } from './read.js'
import { ZipRefused } from './zip.js'

/**
 * Reading and planning an import from DATANORM (#297) in a thread of its
 * own. Reading the assortment of one wholesaler took 5.2 seconds of the
 * processor on 30.10.2026 and planning it about one more; in the thread of
 * the server, every other request waited that long.
 *
 * The conversation, one delivery per thread: `read` with the files, answered
 * with the day of the files; then `plan` with what the business holds,
 * answered with the summary, or with the whole plan in pieces when it is to
 * be taken over. A refusal comes back with its sentence.
 */

/** What the thread is told. */
export type WorkerRequest =
  | {
      readonly kind: 'read'
      readonly files: readonly { readonly name: string; readonly bytes: Uint8Array }[]
      readonly charset: DatanormCharset | undefined
    }
  | {
      readonly kind: 'plan'
      readonly holdings: Holdings
      readonly validFrom: string
      readonly shortCode: string
      readonly markup: number | null
      /** The whole plan, for a takeover; otherwise the summary alone. */
      readonly whole: boolean
    }

/** The arrays of a plan, sent piece by piece. */
export type PlanPart = Exclude<keyof ImportPlan, 'summary'>

/** What the thread answers. */
export type WorkerAnswer =
  | {
      readonly kind: 'read'
      readonly fileDate: string | null
      /** The supplier's numbers the files name, where they hold no article; see `numbersOnly`. */
      readonly numbers: readonly string[] | null
    }
  | { readonly kind: 'part'; readonly part: PlanPart; readonly rows: readonly unknown[] }
  | { readonly kind: 'planned'; readonly summary: ImportPlan['summary'] }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

/** Rows of a plan in one message: small enough that taking one in holds the server only briefly. */
export const rowsPerPart = 2000

const parts: readonly PlanPart[] = [
  'articles',
  'links',
  'discountGroups',
  'coppers',
  'removedLinks',
  'listPrices',
  'purchasePrices',
  'sellingPrices',
]

let delivery: ReadDelivery | null = null

/**
 * The supplier's numbers a delivery names, where it holds prices and
 * deletions only (#297): a plan of those looks up nothing but the links under
 * these numbers, so the server loads no more of what the business holds.
 * Null where an article comes with the files, whose number and EAN the plan
 * holds against every article of the business.
 */
export function numbersOnly(read: ReadDelivery): readonly string[] | null {
  const { catalogue } = read

  if (catalogue.articles.size > 0) {
    return null
  }

  return [...new Set([...catalogue.priceChanges.keys(), ...catalogue.deletions])]
}

function answer(message: WorkerAnswer): void {
  parentPort?.postMessage(message)
}

function handle(request: WorkerRequest): void {
  if (request.kind === 'read') {
    delivery = readDelivery(request.files, request.charset)
    answer({
      kind: 'read',
      fileDate: delivery.catalogue.header?.date ?? null,
      numbers: numbersOnly(delivery),
    })

    return
  }

  if (delivery === null) {
    throw new Error('Planned before the files were read')
  }

  const plan = planImport(delivery, request.holdings, {
    validFrom: request.validFrom as never,
    shortCode: request.shortCode,
    markup: request.markup,
    newId: () => newId(),
  })

  if (request.whole) {
    for (const part of parts) {
      const rows: readonly unknown[] = plan[part]

      for (let start = 0; start < rows.length; start += rowsPerPart) {
        answer({ kind: 'part', part, rows: rows.slice(start, start + rowsPerPart) })
      }
    }
  }

  answer({ kind: 'planned', summary: plan.summary })
}

parentPort?.on('message', (request: WorkerRequest) => {
  try {
    handle(request)
  } catch (error) {
    answer(
      error instanceof ImportRefused || error instanceof ZipRefused
        ? { kind: 'refused', message: error.message }
        : { kind: 'failed', message: error instanceof Error ? error.message : String(error) },
    )
  }
})
