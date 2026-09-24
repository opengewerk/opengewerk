import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { JobId } from '@opengewerk/domain'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { Database, type TenantTransaction } from '../database/database.js'
import { assignNumber } from '../database/number-ranges.js'
import { jobAssignments, jobs, memberships } from '../database/schema/index.js'
import { followUpRefusal } from '../jobs/follow-up.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { requireReferences } from './references.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * What a caller may set. Not the number: it is drawn from the job number
 * range when the job is created (#145) and stays what it was drawn as. The
 * predecessor of a follow-up is set with the job and refused afterwards (#170).
 */
const writableFields = [
  'customerId',
  'siteId',
  'installationId',
  'parentJobId',
  'predecessorJobId',
  'kind',
  'status',
  'designation',
  'description',
] as const

/**
 * Refuses a write that would break a job's place among follow-ups (#170), with
 * the sentence of `followUpProblem`. A 422 for both kinds of refusal the sync
 * tells apart: a route answers the person who is looking at the form.
 */
async function requireFollowUp(
  tx: TenantTransaction,
  id: string | null,
  values: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
): Promise<void> {
  const refusal = await followUpRefusal(tx, id, values, current)

  if (refusal) {
    throw new UnprocessableEntityException(refusal.message)
  }
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('job.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(jobs).where(isNull(jobs.deletedAt)),
    )
  }

  @Post()
  @RequiresPermission('job.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['customerId', 'kind', 'designation'])

    const [created] = await this.database.forTenant(identity, async (tx) => {
      await requireReferences(tx, jobs, values, true)
      await requireFollowUp(tx, null, values, null)

      return tx
        .insert(jobs)
        .values({
          ...(values as typeof jobs.$inferInsert),
          tenantId: identity.tenantId,
          number: await assignNumber(tx, identity.tenantId, 'job', new Date()),
        })
        .returning()
    })

    return created
  }

  @Patch(':id')
  @RequiresPermission('job.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity, async (tx) => {
      await requireReferences(tx, jobs, values, false)

      const [current] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, id as JobId), isNull(jobs.deletedAt)))

      if (current) {
        await requireFollowUp(tx, id, values, current)
      }

      return tx
        .update(jobs)
        .set(values as Partial<typeof jobs.$inferInsert>)
        .where(and(eq(jobs.id, id as JobId), isNull(jobs.deletedAt)))
        .returning()
    })

    if (!updated) {
      // Either it does not exist or it belongs to somebody else. The answer is
      // the same on purpose: anything else would tell a caller which ids exist
      // in other tenants.
      throw new NotFoundException()
    }

    return updated
  }

  /**
   * Who is on the job (#140), as the whole list: whoever is in it and was not
   * is added, whoever was and is not any more is removed, marked deleted so
   * that every device learns it. A person added has to work in the business
   * and not be shut out of it, the question a task asks of its assignee; the
   * key onto the memberships holds the first half behind this.
   *
   * What it decides is what the device of each of them holds, for a person
   * without `job.read.all`: at their next exchange the device finds its part
   * of the business changed, drops it and fetches it anew.
   */
  @Put(':id/assignees')
  @RequiresPermission('job.write')
  async assign(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { userIds } = pick(body, ['userIds'] as const)

    if (
      !Array.isArray(userIds) ||
      !userIds.every((userId) => typeof userId === 'string' && userId.length > 0)
    ) {
      throw new BadRequestException('userIds ist die Liste der Personen auf dem Auftrag.')
    }

    const wanted = [...new Set(userIds as string[])].sort()

    return this.database.forTenant(identity, async (tx) => {
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, id as JobId), isNull(jobs.deletedAt)))

      if (!job) {
        throw new NotFoundException()
      }

      const current = await tx
        .select({ id: jobAssignments.id, userId: jobAssignments.userId })
        .from(jobAssignments)
        .where(and(eq(jobAssignments.jobId, job.id), isNull(jobAssignments.deletedAt)))
      const held = new Set(current.map((row) => row.userId))
      const adding = wanted.filter((userId) => !held.has(userId))

      if (adding.length > 0) {
        const able = new Set(
          (
            await tx
              .select({ userId: memberships.userId, blockedAt: memberships.blockedAt })
              .from(memberships)
              .where(
                and(
                  eq(memberships.tenantId, identity.tenantId),
                  inArray(memberships.userId, adding),
                ),
              )
          )
            .filter((member) => member.blockedAt === null)
            .map((member) => member.userId),
        )

        if (adding.some((userId) => !able.has(userId))) {
          throw new UnprocessableEntityException(
            'Einem Auftrag wird nur zugeordnet, wer in diesem Betrieb arbeitet und nicht ' +
              'gesperrt ist.',
          )
        }

        await tx
          .insert(jobAssignments)
          .values(adding.map((userId) => ({ tenantId: identity.tenantId, jobId: job.id, userId })))
      }

      const removing = current.filter((row) => !wanted.includes(row.userId))

      if (removing.length > 0) {
        await tx
          .update(jobAssignments)
          .set({ deletedAt: new Date() })
          .where(
            inArray(
              jobAssignments.id,
              removing.map((row) => row.id),
            ),
          )
      }

      return { userIds: wanted }
    })
  }

  /**
   * Marked as deleted, not removed. A row that is gone is a row a device that
   * was offline never hears about, because a delta pull delivers what changed
   * and a row that is no longer there is not among it.
   */
  @Delete(':id')
  @RequiresPermission('job.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(jobs)
        .set({ deletedAt: new Date() })
        .where(and(eq(jobs.id, id as JobId), isNull(jobs.deletedAt)))
        .returning(),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
