import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common'
import {
  berlinClock,
  type DueErasure,
  type Erasure,
  type ErasureAutomation,
  type ErasureKind,
  erasureKinds,
  erasureKindWords,
  erasureRequestProblem,
  type ErasureRequest,
  isAllowed,
  missingPermission,
} from '@opengewerk/domain'
import { Database } from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'

import { deadlines, erasureAutomations } from '../database/schema/index.js'
import {
  automationReason,
  automationsOf,
  dueErasuresOf,
  eraseRecords,
  ErasureRefused,
  erasureReason,
  erasuresOf,
  leadersOnly,
  personLeads,
} from '../privacy/erasure.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** What the screen "Datenschutz" shows, in one answer. */
export interface PrivacyOverview {
  /**
   * What is due and not yet deleted, with who each record is; null for
   * somebody who may not read the records of the kinds that are due.
   */
  readonly due: readonly DueErasure[] | null
  /** The protocol, newest first. */
  readonly erasures: readonly Erasure[]
  /** The kinds that go by themselves. */
  readonly automations: readonly ErasureAutomation[]
  /** Whether the person asking leads the business, and so may delete and switch. */
  readonly leads: boolean
}

function kindOf(value: string): ErasureKind {
  if (!erasureKinds.includes(value as ErasureKind)) {
    throw new NotFoundException()
  }

  return value as ErasureKind
}

function today() {
  return berlinClock(new Date()).day
}

/**
 * The deletion concept in the office (#317): what is due, the protocol and
 * the kinds that go by themselves, read by whoever reads the settings.
 * Deleting and switching a kind are for whoever leads the business, as the
 * policies of `erasures`, `erasure_automations` and `audit_redactions` say;
 * the routes ask first, so that a refusal is a sentence and not a failed
 * statement. No right of its own, for the reason ADR 0013 gives: leading is a
 * property of a role, not a right a role of a business's own could be given.
 */
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  overview(@CurrentIdentity() identity: RequestIdentity): Promise<PrivacyOverview> {
    const day = today()

    return this.database.forTenant(identity, async (tx) => ({
      due: isAllowed(identity, erasureKindWords.prospect.read)
        ? await dueErasuresOf(tx, day)
        : null,
      erasures: await erasuresOf(tx),
      automations: await automationsOf(tx),
      leads: await personLeads(tx, identity.userId, day),
    }))
  }

  /**
   * Deletes what the office confirmed: records of one kind, each due today.
   * All of them or none, in one transaction with the protocol and the
   * blacked out values of the change log.
   */
  @Post('erasures')
  @RequiresPermission('settings.read')
  async erase(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<readonly Erasure[]> {
    const problem = erasureRequestProblem(body)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    const { kind, ids } = body as ErasureRequest
    const read = erasureKindWords[kind].read

    // Nobody confirms what she may not see.
    if (!isAllowed(identity, read)) {
      throw new ForbiddenException(missingPermission(read))
    }
    const day = today()
    const erasing = { tenantId: identity.tenantId, userId: identity.userId, reason: erasureReason }

    try {
      return await this.database.forTenant(erasing, async (tx) => {
        if (!(await personLeads(tx, identity.userId, day))) {
          throw new ForbiddenException(leadersOnly)
        }

        return eraseRecords(tx, {
          tenantId: identity.tenantId,
          userId: identity.userId,
          kind,
          ids,
          automatic: false,
          today: day,
        })
      })
    } catch (error) {
      if (error instanceof ErasureRefused) {
        throw new ConflictException(error.message)
      }

      throw error
    }
  }

  /**
   * Switches a kind to go by itself, in the name of the person asking. What
   * is due already goes with the next pass as well: the deadlines of the kind
   * are marked as not yet acted on, so that their action runs once more.
   */
  @Put('automations/:kind')
  @RequiresPermission('settings.read')
  async switchOn(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('kind') value: string,
  ): Promise<readonly ErasureAutomation[]> {
    const kind = kindOf(value)
    const switching = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      reason: automationReason,
    }

    return this.database.forTenant(switching, async (tx) => {
      if (!(await personLeads(tx, identity.userId, today()))) {
        throw new ForbiddenException(leadersOnly)
      }

      await tx
        .insert(erasureAutomations)
        .values({ tenantId: identity.tenantId, kind, createdBy: identity.userId })
        .onConflictDoNothing({ target: [erasureAutomations.tenantId, erasureAutomations.kind] })

      await tx
        .update(deadlines)
        .set({ remindedFor: null, updatedAt: new Date() })
        .where(
          and(eq(deadlines.kind, erasureKindWords[kind].deadline), eq(deadlines.status, 'open')),
        )

      return automationsOf(tx)
    })
  }

  /** Switches a kind back to proposals only. */
  @Delete('automations/:kind')
  @RequiresPermission('settings.read')
  async switchOff(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('kind') value: string,
  ): Promise<readonly ErasureAutomation[]> {
    const kind = kindOf(value)
    const switching = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      reason: automationReason,
    }

    return this.database.forTenant(switching, async (tx) => {
      if (!(await personLeads(tx, identity.userId, today()))) {
        throw new ForbiddenException(leadersOnly)
      }

      await tx.delete(erasureAutomations).where(eq(erasureAutomations.kind, kind))

      return automationsOf(tx)
    })
  }
}
