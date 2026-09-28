import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type ArticleImport,
  type ArticleImportId,
  fileHashProblem,
  type ImportCharset,
  type ImportedFile,
  importFileLimits,
  type IsoDate,
  proposedValidFrom,
  shortCodeFrom,
  type SupplierId,
  type TenantId,
  validFromProblem,
} from '@opengewerk/domain'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { isUniqueViolation } from '../api/database-errors.js'
import { FILE_STORE } from '../api/handed-in.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { everyTenant } from '../database/every-tenant.js'
import { newId } from '../database/identifier.js'
import { articleImports, files, suppliers } from '../database/schema/index.js'
import {
  type FileStorage,
  StoredFileDamagedError,
  StoredFileMissingError,
} from '../storage/file-store.js'
import { todayInGermany } from '../today.js'
import { holdingsOf } from './holdings.js'
import { ImportRefused, planImport } from './plan.js'
import { type DeliveredFile, readDelivery } from './read.js'
import { rowsOf, takeOver } from './take-over.js'
import { ZipRefused } from './zip.js'

/**
 * Imports from DATANORM (#297), from the files to the takeover.
 *
 * The office uploads the files as any other file and names them here; reading
 * and comparing them with what the business holds runs in the background and
 * ends in a preview, and the takeover, once the office confirms it, runs in
 * the background as well, with its progress kept here. Two transactions for
 * the takeover: a short one that says it is applying, which the log watches,
 * and the long one that writes, which the log and the stamp of the sync pass
 * over while that row says so (migration 0062). Either all of it is written or
 * nothing is; a takeover that breaks off leaves the articles as they were and
 * says so in the row of the import.
 */

/** Who starts an import, and in whose business. */
export interface Importer {
  readonly tenantId: TenantId
  readonly userId: string
}

type ImportRow = typeof articleImports.$inferSelect

const charsets: readonly ImportCharset[] = ['utf-8', 'cp850', 'windows-1252']

const runningElsewhere =
  'Es läuft schon ein Import. Erst wenn er gelesen oder übernommen ist, lässt sich ein weiterer starten.'

/** A charset as the body names it: null or absent for "as the bytes show". */
function charsetFrom(value: unknown): ImportCharset | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string' || !charsets.some((charset) => charset === value)) {
    throw new BadRequestException('Diesen Zeichensatz kennt der Import nicht.')
  }

  return value as ImportCharset
}

/** The files the body names, with a name each and the hash they were uploaded under. */
function filesFrom(value: unknown): readonly { readonly name: string; readonly sha256: string }[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('Ein Import braucht mindestens eine Datei.')
  }

  if (value.length > importFileLimits.files) {
    throw new BadRequestException(
      `Ein Import nimmt höchstens ${String(importFileLimits.files)} Dateien.`,
    )
  }

  return value.map((entry: unknown) => {
    const { name, sha256 } = (entry ?? {}) as { name?: unknown; sha256?: unknown }

    if (typeof name !== 'string' || name.trim() === '' || name.length > importFileLimits.name) {
      throw new BadRequestException('Jede Datei braucht ihren Namen.')
    }

    const wrong = fileHashProblem(sha256)

    if (wrong) {
      throw new BadRequestException(wrong)
    }

    return { name: name.trim(), sha256: sha256 as string }
  })
}

/** What went wrong while reading or taking over, in words for the office. */
function problemOf(error: unknown, taking: boolean): string {
  if (
    error instanceof ImportRefused ||
    error instanceof ZipRefused ||
    error instanceof StoredFileMissingError ||
    error instanceof StoredFileDamagedError
  ) {
    return error.message
  }

  if (isUniqueViolation(error, 'articles_number_once')) {
    return (
      'Während der Übernahme ist ein Artikel mit einer der neuen Nummern angelegt worden. ' +
      'Übernommen wurde nichts; wird der Import neu eingelesen, bekommt er eine freie Nummer.'
    )
  }

  console.error(
    `Ein Import aus DATANORM ist ${taking ? 'bei der Übernahme' : 'beim Lesen'} gescheitert.`,
    error,
  )

  return taking
    ? 'Die Übernahme ist abgebrochen. Übernommen wurde nichts, die Artikel sind, wie sie waren.'
    : 'Die Dateien ließen sich nicht lesen.'
}

function viewOf(
  row: ImportRow,
  progress: { readonly done: number; readonly total: number } | null,
): ArticleImport {
  return {
    id: row.id,
    supplierId: row.supplierId,
    status: row.status,
    files: row.files,
    charset: row.charset ?? null,
    validFrom: row.validFrom as IsoDate,
    listAsSelling: row.listAsSelling,
    summary: row.summary ?? null,
    problem: row.problem ?? null,
    createdAt: row.createdAt.toISOString(),
    appliedAt: row.appliedAt?.toISOString() ?? null,
    progress: row.status === 'applying' ? progress : null,
  }
}

async function supplierOf(tx: TenantTransaction, supplierId: SupplierId) {
  const [supplier] = await tx
    .select({ id: suppliers.id, name: suppliers.name, shortCode: suppliers.shortCode })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))

  if (!supplier) {
    throw new NotFoundException('Diesen Lieferanten gibt es nicht.')
  }

  return supplier
}

@Injectable()
export class ArticleImports {
  /** How far each takeover is, which is nowhere but here: it is written in one transaction. */
  private readonly progress = new Map<string, { done: number; total: number }>()
  private readonly running = new Set<Promise<void>>()

  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /** Today in Germany; a test moves it by replacing this. */
  today: () => IsoDate = () => todayInGermany()

  /** Waits for every reading and takeover that runs, for the tests and for a shutdown. */
  async settled(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running])
    }
  }

  private run(task: () => Promise<void>): void {
    const running = task().finally(() => {
      this.running.delete(running)
    })

    this.running.add(running)
  }

  list(importer: Importer, supplierId: SupplierId): Promise<readonly ArticleImport[]> {
    return this.database.forTenant(importer, async (tx) => {
      const rows = await tx
        .select()
        .from(articleImports)
        .where(eq(articleImports.supplierId, supplierId))
        .orderBy(desc(articleImports.createdAt))
        .limit(20)

      return rows.map((row) => viewOf(row, this.progress.get(row.id) ?? null))
    })
  }

  async get(
    importer: Importer,
    supplierId: SupplierId,
    importId: ArticleImportId,
  ): Promise<ArticleImport> {
    const row = await this.database.forTenant(importer, (tx) =>
      this.rowOf(tx, supplierId, importId),
    )

    return viewOf(row, this.progress.get(row.id) ?? null)
  }

  private async rowOf(
    tx: TenantTransaction,
    supplierId: SupplierId,
    importId: ArticleImportId,
    forUpdate = false,
  ): Promise<ImportRow> {
    const query = tx
      .select()
      .from(articleImports)
      .where(and(eq(articleImports.id, importId), eq(articleImports.supplierId, supplierId)))
    const [row] = forUpdate ? await query.for('update') : await query

    if (!row) {
      throw new NotFoundException('Diesen Import gibt es nicht.')
    }

    return row
  }

  /** Names the uploaded files of a delivery and starts reading them. */
  async start(importer: Importer, supplierId: SupplierId, body: unknown): Promise<ArticleImport> {
    const { files: named, charset } = (body ?? {}) as { files?: unknown; charset?: unknown }
    const requested = filesFrom(named)
    const chosen = charsetFrom(charset)

    const row = await this.database
      .forTenant({ ...importer, reason: 'article.import' }, async (tx) => {
        await supplierOf(tx, supplierId)
        await this.refuseWhileRunning(tx)

        const stored = await tx
          .select({ sha256: files.sha256, sizeBytes: files.sizeBytes })
          .from(files)
          .where(
            inArray(
              files.sha256,
              requested.map((file) => file.sha256),
            ),
          )
        const sizes = new Map(stored.map((file) => [file.sha256, file.sizeBytes]))
        const missing = requested.find((file) => !sizes.has(file.sha256))

        if (missing) {
          throw new UnprocessableEntityException(
            `Die Datei ${missing.name} ist nicht hochgeladen worden.`,
          )
        }

        const imported: ImportedFile[] = requested.map((file) => ({
          name: file.name,
          sha256: file.sha256,
          bytes: sizes.get(file.sha256) ?? 0,
        }))

        const [created] = await tx
          .insert(articleImports)
          .values({
            tenantId: importer.tenantId,
            supplierId,
            status: 'reading',
            files: imported,
            charset: chosen,
            validFrom: this.today(),
            createdBy: importer.userId,
          })
          .returning()

        if (!created) {
          throw new Error('The import did not come back')
        }

        return created
      })
      .catch((error: unknown) => {
        throw isUniqueViolation(error, 'article_imports_one_running')
          ? new ConflictException(runningElsewhere)
          : error
      })

    this.run(() => this.read(importer, row, true))

    return viewOf(row, null)
  }

  private async refuseWhileRunning(tx: TenantTransaction): Promise<void> {
    const [running] = await tx
      .select({ id: articleImports.id })
      .from(articleImports)
      .where(inArray(articleImports.status, ['reading', 'applying']))

    if (running) {
      throw new ConflictException(runningElsewhere)
    }
  }

  /**
   * Changes the options of a preview and reads it again, so that what the
   * office confirms is what it saw: the characters, the day the prices apply
   * from, and whether a list price becomes the selling price as well.
   */
  async change(
    importer: Importer,
    supplierId: SupplierId,
    importId: ArticleImportId,
    body: unknown,
  ): Promise<ArticleImport> {
    const values = (body ?? {}) as {
      charset?: unknown
      validFrom?: unknown
      listAsSelling?: unknown
    }
    const change: { charset?: ImportCharset | null; validFrom?: IsoDate; listAsSelling?: boolean } =
      {}

    if ('charset' in values) {
      change.charset = charsetFrom(values.charset)
    }

    if (values.validFrom !== undefined) {
      const wrong = validFromProblem(values.validFrom, this.today())

      if (wrong) {
        throw new UnprocessableEntityException(wrong)
      }

      change.validFrom = values.validFrom as IsoDate
    }

    if (values.listAsSelling !== undefined) {
      if (typeof values.listAsSelling !== 'boolean') {
        throw new BadRequestException('Listenpreis als Verkaufspreis ist ja oder nein.')
      }

      change.listAsSelling = values.listAsSelling
    }

    const row = await this.database
      .forTenant({ ...importer, reason: 'article.import' }, async (tx) => {
        const held = await this.rowOf(tx, supplierId, importId, true)

        if (held.status !== 'ready' && held.status !== 'failed') {
          throw new ConflictException('Dieser Import lässt sich nicht mehr ändern.')
        }

        await this.refuseWhileRunning(tx)

        const [changed] = await tx
          .update(articleImports)
          .set({
            ...change,
            status: 'reading',
            summary: null,
            problem: null,
            updatedAt: new Date(),
          })
          .where(eq(articleImports.id, importId))
          .returning()

        return changed ?? held
      })
      .catch((error: unknown) => {
        throw isUniqueViolation(error, 'article_imports_one_running')
          ? new ConflictException(runningElsewhere)
          : error
      })

    this.run(() => this.read(importer, row, false))

    return viewOf(row, null)
  }

  /** Reads the files and compares them with the catalogue, for the preview. */
  private async read(importer: Importer, row: ImportRow, propose: boolean): Promise<void> {
    try {
      const delivery = readDelivery(await this.bytesOf(row), row.charset ?? undefined)
      const today = this.today()
      const validFrom = propose
        ? proposedValidFrom(delivery.catalogue.header?.date ?? null, today)
        : (row.validFrom as IsoDate)

      const summary = await this.database.forTenant(importer, async (tx) => {
        const supplier = await supplierOf(tx, row.supplierId)
        const holdings = await holdingsOf(tx, row.supplierId, validFrom)

        return planImport(delivery, holdings, {
          validFrom,
          listAsSelling: row.listAsSelling,
          shortCode: supplier.shortCode ?? shortCodeFrom(supplier.name),
          newId: () => newId(),
        }).summary
      })

      await this.database.forTenant({ ...importer, reason: 'article.import' }, (tx) =>
        tx
          .update(articleImports)
          .set({ status: 'ready', summary, validFrom, updatedAt: new Date() })
          .where(and(eq(articleImports.id, row.id), eq(articleImports.status, 'reading'))),
      )
    } catch (error) {
      await this.fail(importer, row.id, 'reading', problemOf(error, false))
    }
  }

  private async bytesOf(row: ImportRow): Promise<readonly DeliveredFile[]> {
    return Promise.all(
      row.files.map(async (file) => ({
        name: file.name,
        bytes: await this.store.get(file.sha256),
      })),
    )
  }

  private async fail(
    importer: Importer,
    importId: string,
    from: 'reading' | 'applying',
    problem: string,
  ): Promise<void> {
    try {
      await this.database.forTenant({ ...importer, reason: 'article.import' }, (tx) =>
        tx
          .update(articleImports)
          .set({ status: 'failed', problem, updatedAt: new Date() })
          .where(
            and(
              eq(articleImports.id, importId as ArticleImportId),
              eq(articleImports.status, from),
            ),
          ),
      )
    } catch (error) {
      console.error('Ein gescheiterter Import ließ sich nicht als gescheitert eintragen.', error)
    }
  }

  /**
   * Takes over what the preview showed. The short transaction here says the
   * import is applying, the long one in the background writes it.
   */
  async apply(
    importer: Importer,
    supplierId: SupplierId,
    importId: ArticleImportId,
  ): Promise<ArticleImport> {
    const row = await this.database.forTenant(
      { ...importer, reason: 'article.import' },
      async (tx) => {
        const held = await this.rowOf(tx, supplierId, importId, true)

        if (held.status !== 'ready' || held.summary === null) {
          throw new ConflictException('Dieser Import ist nicht bereit zur Übernahme.')
        }

        const wrong = validFromProblem(held.validFrom, this.today())

        if (wrong) {
          throw new UnprocessableEntityException(wrong)
        }

        const { created, linked, updated, removed, renumbered, shortCode } = held.summary

        if (created + linked + updated + removed === 0) {
          throw new ConflictException('In diesem Import gibt es nichts zu übernehmen.')
        }

        await this.refuseWhileRunning(tx)

        // The short code a renumbered article gets becomes the supplier's, so
        // that the next import appends the same one; written here, in the
        // short transaction, and not in the long one, which would hold the
        // log and the counter of the sync for its whole length.
        if (renumbered > 0) {
          await tx
            .update(suppliers)
            .set({ shortCode, updatedAt: new Date() })
            .where(and(eq(suppliers.id, supplierId), isNull(suppliers.shortCode)))
        }

        const [applying] = await tx
          .update(articleImports)
          .set({ status: 'applying', appliedBy: importer.userId, updatedAt: new Date() })
          .where(eq(articleImports.id, importId))
          .returning()

        return applying ?? held
      },
    )

    this.progress.set(row.id, { done: 0, total: 0 })
    this.run(() => this.takeOver(importer, row))

    return viewOf(row, this.progress.get(row.id) ?? null)
  }

  private async takeOver(importer: Importer, row: ImportRow): Promise<void> {
    try {
      const delivery = readDelivery(await this.bytesOf(row), row.charset ?? undefined)
      const validFrom = row.validFrom as IsoDate

      await this.database.forTenant({ ...importer, reason: 'article.import' }, async (tx) => {
        // Names the import for the triggers of 0062. From here to the last
        // statement the log and the stamp of the sync pass over the article
        // tables, since the row of this import says it is applying.
        await tx.execute(sql`select set_config('app.article_import', ${row.id}, true)`)

        const supplier = await supplierOf(tx, row.supplierId)
        const plan = planImport(delivery, await holdingsOf(tx, row.supplierId, validFrom), {
          validFrom,
          listAsSelling: row.listAsSelling,
          shortCode: supplier.shortCode ?? shortCodeFrom(supplier.name),
          newId: () => newId(),
        })

        this.progress.set(row.id, { done: 0, total: rowsOf(plan) })

        await takeOver(tx, plan, {
          tenantId: importer.tenantId,
          importId: row.id,
          supplierId: row.supplierId,
          userId: importer.userId,
          validFrom,
          progress: (done, total) => this.progress.set(row.id, { done, total }),
        })

        // The one entry the log keeps of what was written, and the last
        // statement: after it, the row no longer says applying.
        await tx
          .update(articleImports)
          .set({
            status: 'applied',
            summary: plan.summary,
            appliedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(articleImports.id, row.id))
      })
    } catch (error) {
      await this.fail(importer, row.id, 'applying', problemOf(error, true))
    } finally {
      this.progress.delete(row.id)
    }
  }

  /** Throws a preview away, or a failed import, which the list then no longer offers. */
  async discard(
    importer: Importer,
    supplierId: SupplierId,
    importId: ArticleImportId,
  ): Promise<ArticleImport> {
    const row = await this.database.forTenant(
      { ...importer, reason: 'article.import' },
      async (tx) => {
        const held = await this.rowOf(tx, supplierId, importId, true)

        if (held.status !== 'ready' && held.status !== 'failed') {
          throw new ConflictException('Dieser Import lässt sich nicht mehr verwerfen.')
        }

        const [discarded] = await tx
          .update(articleImports)
          .set({ status: 'discarded', updatedAt: new Date() })
          .where(eq(articleImports.id, importId))
          .returning()

        return discarded ?? held
      },
    )

    return viewOf(row, null)
  }
}

/**
 * Ends the imports a restart cut off: their transaction is gone, and with it
 * everything they would have written, but their rows still say they run and
 * would keep every further import out.
 */
export async function endInterruptedImports(database: Database): Promise<void> {
  for (const tenantId of await everyTenant(database)) {
    await database.forTenant({ tenantId, reason: 'article.import.interrupted' }, async (tx) => {
      await tx
        .update(articleImports)
        .set({
          status: 'failed',
          problem: 'Der Server wurde neu gestartet, während die Dateien gelesen wurden.',
          updatedAt: new Date(),
        })
        .where(eq(articleImports.status, 'reading'))
      await tx
        .update(articleImports)
        .set({
          status: 'failed',
          problem:
            'Der Server wurde während der Übernahme neu gestartet. Übernommen wurde nichts, ' +
            'die Artikel sind, wie sie waren.',
          updatedAt: new Date(),
        })
        .where(eq(articleImports.status, 'applying'))
    })
  }
}
