import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common'
import { isAllowed, type OnCallShiftId, onCallShiftProblem } from '@opengewerk/domain'
import {
  Database,
  isUuid,
  pick,
  stillWorks,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { and, asc, eq, gt, isNull, lt } from 'drizzle-orm'

import { onCallShifts } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** A time of the on-call plan as the office shows it. */
export interface OnCallShiftView {
  readonly id: string
  readonly userId: string
  readonly startsAt: string
  readonly endsAt: string
  readonly note: string | null
}

type Row = typeof onCallShifts.$inferSelect

function shown(row: Row): OnCallShiftView {
  return {
    id: row.id,
    userId: row.userId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    note: row.note,
  }
}

const fields = ['userId', 'startsAt', 'endsAt', 'note'] as const

/** The values of a time as the form sends them, checked, or refused with the sentence of the form. */
function valuesOf(body: unknown): {
  userId: string
  startsAt: Date
  endsAt: Date
  note: string | null
} {
  const values = pick(body ?? {}, fields)
  const note =
    typeof values.note === 'string' && values.note.trim() !== '' ? values.note.trim() : null
  const problem = onCallShiftProblem(values.startsAt, values.endsAt, note)

  if (typeof values.userId !== 'string' || values.userId === '') {
    throw new UnprocessableEntityException('Eine Bereitschaft braucht die Person, die sie hat.')
  }

  if (problem !== null) {
    throw new UnprocessableEntityException(problem)
  }

  return {
    userId: values.userId,
    startsAt: new Date(String(values.startsAt)),
    endsAt: new Date(String(values.endsAt)),
    note,
  }
}

/** Refuses a person who does not work in the business or is shut out of it. */
async function requireWorks(tx: TenantTransaction, identity: RequestIdentity, userId: string) {
  const [member] = await tx
    .select({ blockedAt: memberships.blockedAt, lastDay: memberships.lastDay })
    .from(memberships)
    .where(and(eq(memberships.tenantId, identity.tenantId), eq(memberships.userId, userId)))

  if (!member || !stillWorks(member, new Date())) {
    throw new UnprocessableEntityException('Bereitschaft hat nur, wer im Betrieb arbeitet.')
  }
}

async function rowOf(tx: TenantTransaction, id: string): Promise<Row> {
  if (!isUuid(id)) {
    throw new NotFoundException()
  }

  const [row] = await tx
    .select()
    .from(onCallShifts)
    .where(and(eq(onCallShifts.id, id as OnCallShiftId), isNull(onCallShifts.deletedAt)))
    .for('update')

  if (!row) {
    throw new NotFoundException()
  }

  return row
}

/**
 * The on-call plan (#293, Feature-Gliederung 4.1, 4.3): who is on call from
 * when until when. Kept in the office with "Aufträge bearbeiten", the right
 * of the planning board; a device holds the times of its person through the
 * sync and writes none. Two times swap their people in one step, and the
 * change log keeps who did.
 */
@Controller('on-call-shifts')
export class OnCallController {
  constructor(private readonly database: Database) {}

  /**
   * The times that overlap a span, the earliest first. Whoever sees every
   * job (the office) sees the whole plan; a technician sees their own times,
   * as their device holds them, and not the times and notes of colleagues.
   */
  @Get()
  @RequiresPermission('job.read')
  list(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ): Promise<readonly OnCallShiftView[]> {
    const start = new Date(String(from))
    const end = new Date(String(to))

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException('Von und bis sind Zeitpunkte, bis nach von.')
    }

    return this.database.forTenant(identity, async (tx) =>
      (
        await tx
          .select()
          .from(onCallShifts)
          .where(
            and(
              isNull(onCallShifts.deletedAt),
              lt(onCallShifts.startsAt, end),
              gt(onCallShifts.endsAt, start),
              isAllowed(identity, 'job.read.all')
                ? undefined
                : eq(onCallShifts.userId, identity.userId),
            ),
          )
          .orderBy(asc(onCallShifts.startsAt), asc(onCallShifts.id))
      ).map(shown),
    )
  }

  @Post()
  @RequiresPermission('job.write')
  create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = valuesOf(body)

    return this.database.forTenant(identity, async (tx) => {
      await requireWorks(tx, identity, values.userId)

      const [row] = await tx
        .insert(onCallShifts)
        .values({ tenantId: identity.tenantId, ...values })
        .returning()

      if (!row) {
        throw new Error('The time was written and is not readable afterwards.')
      }

      return shown(row)
    })
  }

  @Put(':id')
  @RequiresPermission('job.write')
  change(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = valuesOf(body)

    return this.database.forTenant(identity, async (tx) => {
      await rowOf(tx, id)
      await requireWorks(tx, identity, values.userId)

      const [row] = await tx
        .update(onCallShifts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(onCallShifts.id, id as OnCallShiftId))
        .returning()

      return shown(row as Row)
    })
  }

  /** Taken back by marking it deleted, so that every device learns it. */
  @Delete(':id')
  @RequiresPermission('job.write')
  remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
      await rowOf(tx, id)
      await tx
        .update(onCallShifts)
        .set({ deletedAt: new Date() })
        .where(eq(onCallShifts.id, id as OnCallShiftId))

      return { removed: id }
    })
  }

  /**
   * Two times swap their people, the times stay. Both rows are locked first,
   * so that a swap and a change of either wait for each other.
   */
  @Post(':id/swap')
  @RequiresPermission('job.write')
  swap(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { with: other } = pick(body ?? {}, ['with'] as const)

    if (typeof other !== 'string' || other === id) {
      throw new UnprocessableEntityException('Getauscht wird mit einer anderen Bereitschaft.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const first = await rowOf(tx, id)
      const second = await rowOf(tx, other)

      if (first.userId === second.userId) {
        throw new ConflictException('Beide Bereitschaften hat dieselbe Person.')
      }

      const now = new Date()

      await tx
        .update(onCallShifts)
        .set({ userId: second.userId, updatedAt: now })
        .where(eq(onCallShifts.id, first.id))
      await tx
        .update(onCallShifts)
        .set({ userId: first.userId, updatedAt: now })
        .where(eq(onCallShifts.id, second.id))

      return { swapped: [first.id, second.id] }
    })
  }
}
