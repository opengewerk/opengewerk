import {
  BadGatewayException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import { type IsoDate, type JobId } from '@opengewerk/domain'
import {
  addressLines,
  Database,
  isUuid,
  present,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { customers, jobs, letterheads, sites, tenants } from '../database/schema/index.js'
import { acceptanceRequestJob } from '../forms/acceptance-request.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { pdf, safe } from './pv-documents.controller.js'

const calendarDay = /^\d{4}-\d{2}-\d{2}$/

/** Whether a text is a day of the calendar, "2026-11-19", and not "2026-02-30". */
function isDay(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !calendarDay.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * The request to accept a job within a deadline (#310, § 640 Abs. 2 BGB), as
 * a letter on the letterhead of the business. To a private customer it tells
 * the consequences of letting the deadline pass, which the law asks in text
 * form for a consumer. Printed on every request and kept nowhere: the letter
 * goes out by the business's own way, by post or by mail.
 */
@Controller('jobs/:jobId')
export class AcceptanceRequestController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get('acceptance-request')
  @RequiresPermission('job.read')
  async request(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('jobId') jobId: string,
    @Query('until') until: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(jobId)) {
      throw new NotFoundException()
    }

    const on = todayInGermany()

    if (!isDay(until) || until < on) {
      throw new UnprocessableEntityException(
        'Die Frist zur Abnahme ist ein Tag, heute oder später.',
      )
    }

    const request = await this.database.forTenant(identity, async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, jobId as JobId), isNull(jobs.deletedAt)))

      if (!job) {
        throw new NotFoundException()
      }

      const [customer] = await tx.select().from(customers).where(eq(customers.id, job.customerId))
      const [site] = job.siteId ? await tx.select().from(sites).where(eq(sites.id, job.siteId)) : []
      const [letterhead] = await tx
        .select()
        .from(letterheads)
        .where(eq(letterheads.tenantId, identity.tenantId))
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants)
      const companyName = letterhead?.companyName ?? null

      return {
        keeper: {
          name: present(companyName) ? companyName : (tenant?.name ?? ''),
          address: letterhead ? addressLines(letterhead, 'DE').join(', ') : '',
          phone: letterhead?.phone ?? null,
          email: letterhead?.email ?? null,
        },
        customer: {
          name: customer?.name ?? '',
          addressLines: customer ? addressLines(customer, 'DE') : [],
          consumer: customer?.kind === 'private',
        },
        job: { designation: job.designation, number: job.number },
        site: site
          ? [site.designation, ...addressLines(site, 'DE')].filter(present).join(', ')
          : null,
        until,
      }
    })

    let bytes: Uint8Array

    try {
      bytes = await this.render(acceptanceRequestJob(request, on), identity)
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    return pdf(response, bytes, `Aufforderung zur Abnahme ${safe(request.job.designation)}`)
  }
}
