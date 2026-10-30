import { fileURLToPath } from 'node:url'
import { getHeapStatistics } from 'node:v8'
import { Worker } from 'node:worker_threads'

import type { ImportSummary, IsoDate } from '@opengewerk/domain'

import type { DatanormCharset } from './charset.js'
import type { PlanPart, WorkerAnswer, WorkerRequest } from './import-worker.js'
import { type Holdings, ImportRefused, type ImportPlan } from './plan.js'
import type { DeliveredFile } from './read.js'

/**
 * One delivery read in a thread of its own (`import-worker.ts`), and planned
 * there against what the business holds. The server's thread only waits for
 * the answers and takes the plan in piece by piece.
 *
 * The thread runs the built file in `dist`, from the sources as from the
 * build; the tests of the server build first.
 */
const workerFile = fileURLToPath(new URL('../../dist/datanorm/import-worker.js', import.meta.url))

/**
 * The heap of the thread: half of the server's own. The two together stay
 * within the limit of the container (`docs/betrieb.md`), and a delivery too
 * large for it ends the thread with a sentence and not the server.
 */
function threadHeapMb(): number {
  return Math.max(256, Math.floor(getHeapStatistics().heap_size_limit / 2 / 1024 / 1024))
}

const outOfMemory =
  'Für diese Lieferung reicht der Speicher dieser Instanz nicht. Eingelesen wurde nichts; ' +
  'kleinere Teile der Lieferung lassen sich einzeln einlesen.'

export interface PlanFor {
  readonly validFrom: IsoDate
  readonly shortCode: string
}

export interface PlanningSession {
  /** The day the header of the files names, null where none does. */
  readonly fileDate: IsoDate | null
  /** What the import would do, for the preview. */
  summaryOf(holdings: Holdings, options: PlanFor): Promise<ImportSummary>
  /** The whole plan, for the takeover. */
  planOf(holdings: Holdings, options: PlanFor): Promise<ImportPlan>
  /** Ends the thread; called once the session is no longer needed, whatever happened. */
  close(): Promise<void>
}

/** Reads the files in a new thread and answers once they are read. */
export async function startPlanning(
  files: readonly DeliveredFile[],
  charset: DatanormCharset | undefined,
): Promise<PlanningSession> {
  const worker = new Worker(workerFile, {
    resourceLimits: { maxOldGenerationSizeMb: threadHeapMb() },
  })
  const received: WorkerAnswer[] = []
  const waiting: { resolve: (answer: WorkerAnswer) => void; reject: (error: Error) => void }[] = []
  let broken: Error | null = null

  const fail = (error: Error) => {
    broken = error

    for (const waiter of waiting.splice(0)) {
      waiter.reject(error)
    }
  }

  worker.on('message', (message: WorkerAnswer) => {
    const waiter = waiting.shift()

    if (waiter) {
      waiter.resolve(message)
    } else {
      received.push(message)
    }
  })
  worker.on('error', (error: Error & { code?: string }) => {
    fail(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ImportRefused(outOfMemory) : error)
  })
  worker.on('exit', (code) => {
    fail(new Error(`The import thread ended with code ${String(code)}`))
  })

  const next = (): Promise<WorkerAnswer> => {
    const ready = received.shift()

    if (ready) {
      return Promise.resolve(ready)
    }

    if (broken) {
      return Promise.reject(broken)
    }

    return new Promise((resolve, reject) => {
      waiting.push({ resolve, reject })
    })
  }

  /** The next answer, with a refusal or a failure of the thread thrown as such. */
  const expect = async (): Promise<WorkerAnswer> => {
    const answer = await next()

    if (answer.kind === 'refused') {
      throw new ImportRefused(answer.message)
    }

    if (answer.kind === 'failed') {
      throw new Error(answer.message)
    }

    return answer
  }

  const ask = (request: WorkerRequest) => {
    worker.postMessage(request)
  }

  const close = async () => {
    await worker.terminate()
  }

  try {
    ask({ kind: 'read', files: files.map(({ name, bytes }) => ({ name, bytes })), charset })

    const read = await expect()

    if (read.kind !== 'read') {
      throw new Error(`The import thread answered ${read.kind} to read`)
    }

    const planned = async (holdings: Holdings, options: PlanFor, whole: boolean) => {
      ask({ kind: 'plan', holdings, ...options, whole })

      const pieces = new Map<PlanPart, unknown[]>()

      for (;;) {
        const answer = await expect()

        if (answer.kind === 'part') {
          const rows = pieces.get(answer.part) ?? []

          // One piece at a time, each taken in by itself: the server's thread
          // is free again between two of them.
          for (const row of answer.rows) {
            rows.push(row)
          }

          pieces.set(answer.part, rows)
          continue
        }

        if (answer.kind === 'planned') {
          return { pieces, summary: answer.summary }
        }

        throw new Error(`The import thread answered ${answer.kind} to plan`)
      }
    }

    return {
      fileDate: read.fileDate as IsoDate | null,
      summaryOf: async (holdings, options) => (await planned(holdings, options, false)).summary,
      planOf: async (holdings, options) => {
        const { pieces, summary } = await planned(holdings, options, true)
        const part = <Rows>(name: PlanPart) => (pieces.get(name) ?? []) as Rows

        return {
          articles: part('articles'),
          links: part('links'),
          discountGroups: part('discountGroups'),
          coppers: part('coppers'),
          removedLinks: part('removedLinks'),
          listPrices: part('listPrices'),
          purchasePrices: part('purchasePrices'),
          sellingPrices: part('sellingPrices'),
          summary,
        }
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
