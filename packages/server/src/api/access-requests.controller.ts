import { Readable } from 'node:stream'

import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type AccessRequestInput,
  accessFileName,
  accessRequestProblem,
  type AccessRequestView,
  type AccessSubjectHit,
  answerDueOf,
  berlinClock,
  recipientsFor,
} from '@opengewerk/domain'
import {
  accountsOf,
  addressLines,
  Database,
  isUuid,
  listColleagues,
  present,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import { eq, sql } from 'drizzle-orm'
import type { Response } from 'express'

import { accessRequests, letterheads, people, tenants } from '../database/schema/index.js'
import { type AccessAnswer, accessEntries, accessPrintJob } from '../privacy/access-answer.js'
import { gatherAccessReport, gridOperatorsOf } from '../privacy/access-report.js'
import {
  accessRequestOf,
  accessRequestsOf,
  findSubjects,
  subjectOf,
} from '../privacy/access-requests.js'
import { recordInputsOf, usedActivitiesOf } from '../privacy/documents.js'
import { dosMoment, zipPieces } from '../privacy/zip.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { DocumentFiles } from './document-files.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** The reasons the change log gives the three steps of a request. */
const recordReason = 'privacy.access_request'
const reportReason = 'privacy.access_report'
const answerReason = 'privacy.access_answer'

/** Why a second request for the same person is refused while one runs. */
const oneAtATime = 'Für diese Person läuft schon eine Auskunftsanfrage.'

/**
 * Requests for access (#318, Art. 15 and 20 DSGVO) under "Einstellungen,
 * Datenschutz": recording one, drawing the answer as one ZIP, and marking it
 * answered. Every route asks for `privacy.access`, which only the owner has:
 * the answer holds every value about a person and leaves the business as a
 * file. Access is given only to a recorded request (Moritz, 05.11.2026), and
 * drawing it stands in the change log with who drew it.
 */
@Controller('privacy/access-requests')
export class AccessRequestsController {
  constructor(
    private readonly database: Database,
    private readonly files: DocumentFiles,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  /** The requests that run, and those answered in the last twelve months. */
  @Get()
  @RequiresPermission('privacy.access')
  async list(
    @CurrentIdentity() identity: RequestIdentity,
  ): Promise<{ readonly requests: readonly AccessRequestView[] }> {
    const today = todayInGermany()

    return {
      requests: await this.database.forTenant(identity, (tx) => accessRequestsOf(tx, today)),
    }
  }

  /** The customers, contacts, leads and files a name finds, from two letters on. */
  @Get('subjects')
  @RequiresPermission('privacy.access')
  async subjects(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('q') typed: unknown,
  ): Promise<{ readonly hits: readonly AccessSubjectHit[] }> {
    if (typeof typed !== 'string' || typed.trim().length < 2 || typed.length > 100) {
      return { hits: [] }
    }

    return { hits: await this.database.forTenant(identity, (tx) => findSubjects(tx, typed)) }
  }

  /**
   * Records a request: whom it is about, the day it came in and how. The
   * answer is due a month later, and a deadline says so. One runs per person
   * at a time, as the indexes of the table say.
   */
  @Post()
  @RequiresPermission('privacy.access')
  async record(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<AccessRequestView> {
    const problem = accessRequestProblem(body, todayInGermany())

    if (problem !== null) {
      throw new UnprocessableEntityException(problem)
    }

    const input = body as AccessRequestInput
    const recording = { tenantId: identity.tenantId, userId: identity.userId, reason: recordReason }

    return this.database.forTenant(recording, async (tx) => {
      const named = await subjectOf(tx, input.subject, input.subjectId)

      if (named === null) {
        throw new NotFoundException()
      }

      const key = named.id
      const inserted = await tx
        .insert(accessRequests)
        .values({
          tenantId: identity.tenantId,
          subject: input.subject,
          customerId: input.subject === 'customer' ? (key as never) : null,
          contactId: input.subject === 'contact' ? (key as never) : null,
          prospectId: input.subject === 'prospect' ? (key as never) : null,
          personId: input.subject === 'person' ? (key as never) : null,
          receivedOn: input.receivedOn,
          channel: input.channel,
          answerDueOn: answerDueOf(input.receivedOn),
          // Set by `record_note_author` from the person of the transaction.
          createdBy: identity.userId,
        })
        .onConflictDoNothing()
        .returning()

      const [row] = inserted

      if (row === undefined) {
        throw new ConflictException(oneAtATime)
      }

      return { request: accessRequestOf(row), name: named.name, detail: named.detail }
    })
  }

  /**
   * The answer as one ZIP (Moritz, 05.11.2026): the PDF, the JSON and the
   * stored files of the person. Gathered and printed first; only then does
   * the request say when and by whom it was drawn, so that a failed print
   * leaves no trace of an answer nobody got.
   */
  @Post(':id/report')
  @RequiresPermission('privacy.access')
  async report(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(id)) {
      throw new NotFoundException()
    }

    const on = todayInGermany()
    const found = await this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.id, id as never))

      if (row === undefined) {
        throw new NotFoundException()
      }

      const request = accessRequestOf(row)

      if (request.subjectId === null) {
        throw new ConflictException(
          'Die Person ist nach dem Löschkonzept gelöscht; zu ihr gibt es keine Daten mehr.',
        )
      }

      const named = await subjectOf(tx, request.subject, request.subjectId)
      const [person] =
        request.subject === 'person'
          ? await tx
              .select({ userId: people.userId })
              .from(people)
              .where(eq(people.id, request.subjectId as never))
          : []

      return { request, named, userId: person?.userId ?? null }
    })

    if (found.named === null) {
      throw new NotFoundException()
    }

    // The address of the account, for the invitation; the id comes from the
    // file of this business, as `accountsOf` asks.
    const account =
      found.userId === null
        ? undefined
        : (await accountsOf(this.database, [found.userId], identity.userId)).get(found.userId)
    const colleagues = await listColleagues(this.database, identity)
    const gathered = await this.database.forTenant(identity, async (tx) => {
      const report = await gatherAccessReport(
        tx,
        found.request.subject,
        found.request.subjectId as string,
        account?.email ?? null,
      )

      if (report === null) {
        throw new NotFoundException()
      }

      const missing = report.accounts.filter(
        (userId) => !colleagues.some((colleague) => colleague.userId === userId),
      )
      const { rows: former } =
        missing.length === 0
          ? { rows: [] }
          : await tx.execute<{ user_id: string; name: string }>(sql`
              select user_id, name from people
               where user_id = any(${sql.param(missing)}::text[]) and name is not null`)
      const [letterhead] = await tx.select().from(letterheads).limit(1)
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants).limit(1)

      return {
        report,
        former,
        gridOperators: await gridOperatorsOf(tx, report),
        recipients: recipientsFor(
          found.request.subject,
          await recordInputsOf(tx),
          await usedActivitiesOf(tx),
        ),
        keeper: {
          name: present(letterhead?.companyName) ? letterhead.companyName : (tenant?.name ?? ''),
          address: letterhead ? addressLines(letterhead, 'DE').join(', ') : '',
          phone: letterhead?.phone ?? null,
          email: letterhead?.email ?? null,
        },
      }
    })
    const names = new Map<string, string>([
      ...gathered.former.map((row) => [row.user_id, row.name] as [string, string]),
      ...colleagues.map((colleague) => [colleague.userId, colleague.name] as [string, string]),
    ])
    const createdAt = new Date()
    const answer: AccessAnswer = {
      keeper: gathered.keeper,
      name: found.named.name,
      request: { receivedOn: found.request.receivedOn, channel: found.request.channel },
      on,
      createdAt: createdAt.toISOString(),
      report: gathered.report,
      names,
      gridOperators: gathered.gridOperators,
      recipients: gathered.recipients,
      account: account === undefined ? null : { name: account.name, email: account.email },
    }

    let pdf: Uint8Array

    try {
      pdf = await this.render(accessPrintJob(answer), identity)
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    const drawing = { tenantId: identity.tenantId, userId: identity.userId, reason: reportReason }

    await this.database.forTenant(drawing, (tx) =>
      tx
        .update(accessRequests)
        .set({ producedAt: createdAt, updatedAt: createdAt })
        .where(eq(accessRequests.id, found.request.id as never)),
    )

    const clock = berlinClock(createdAt)
    const [year, month, day] = clock.day.split('-').map(Number) as [number, number, number]
    const moment = dosMoment({
      year,
      month,
      day,
      hour: Math.floor(clock.minute / 60),
      minute: clock.minute % 60,
      second: createdAt.getUTCSeconds(),
    })
    const entries = accessEntries(answer, pdf, (sha256) => this.files.read(sha256))
    const name = accessFileName(found.named.name, on)

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Readable.from(zipPieces(entries, moment)), {
      type: 'application/zip',
      disposition: `attachment; filename="Auskunft.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
  }

  /** Marks a request answered, once its answer was drawn. The deadline drops. */
  @Post(':id/answer')
  @RequiresPermission('privacy.access')
  async answer(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<AccessRequestView> {
    if (!isUuid(id)) {
      throw new NotFoundException()
    }

    const answering = { tenantId: identity.tenantId, userId: identity.userId, reason: answerReason }

    return this.database.forTenant(answering, async (tx) => {
      const [row] = await tx
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.id, id as never))
        .for('update')

      if (row === undefined) {
        throw new NotFoundException()
      }

      if (row.status === 'answered') {
        throw new ConflictException('Diese Auskunftsanfrage ist schon beantwortet.')
      }

      if (row.producedAt === null) {
        throw new ConflictException(
          'Beantwortet ist eine Anfrage erst, wenn die Auskunft erstellt ist.',
        )
      }

      const now = new Date()
      const [updated] = await tx
        .update(accessRequests)
        .set({ status: 'answered', answeredAt: now, updatedAt: now })
        .where(eq(accessRequests.id, row.id))
        .returning()

      if (updated === undefined) {
        throw new NotFoundException()
      }

      const request = accessRequestOf(updated)
      const named =
        request.subjectId === null ? null : await subjectOf(tx, request.subject, request.subjectId)

      return {
        request,
        name: named?.name ?? null,
        detail: named?.detail ?? 'Gelöscht nach dem Löschkonzept',
      }
    })
  }
}
