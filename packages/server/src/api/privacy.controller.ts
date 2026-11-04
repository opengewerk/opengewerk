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
  Query,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  berlinClock,
  type DueErasure,
  type Erasure,
  answerDueOf,
  type CustomerId,
  type ErasureAutomation,
  type ErasureConfirmation,
  erasureConfirmationProblem,
  type ErasureKind,
  erasureKinds,
  erasureKindWords,
  type ErasureRequestChannel,
  erasureRequestProblem,
  type ErasureRequestView,
  type IsoDate,
  isAllowed,
  missingPermission,
} from '@opengewerk/domain'
import { Database } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import {
  customers,
  deadlines,
  erasureAutomations,
  erasureRequests,
} from '../database/schema/index.js'
import { restrictCustomer } from '../privacy/customer-erasure.js'
import { finishErasedAccounts } from '../privacy/staff-erasure.js'
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
import { runningRequestsOf } from '../privacy/requests.js'
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
  /**
   * The requests for deletion that run (#845), open and restricted, with what
   * holds each customer; null for somebody who may not read customers.
   */
  readonly requests: readonly ErasureRequestView[] | null
  /** Whether the person asking leads the business, and so may delete and switch. */
  readonly leads: boolean
}

/** Why a request is refused while one runs for the customer. */
const oneAtATime = 'Für diesen Kunden läuft schon eine Löschanfrage.'

/** The reasons the change log gives a request recorded and a customer restricted. */
const requestReason = 'privacy.request'
const restrictReason = 'privacy.restrict'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

    // Of each kind only what the person may read; nothing when that is no kind.
    const readable = erasureKinds.filter((kind) => isAllowed(identity, erasureKindWords[kind].read))

    return this.database.forTenant(identity, async (tx) => ({
      due: readable.length > 0 ? await dueErasuresOf(tx, day, readable) : null,
      erasures: await erasuresOf(tx),
      automations: await automationsOf(tx),
      requests: isAllowed(identity, 'customer.read') ? await runningRequestsOf(tx, day) : null,
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
    const problem = erasureConfirmationProblem(body)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    const { kind, ids } = body as ErasureConfirmation
    const read = erasureKindWords[kind].read

    // Nobody confirms what she may not see.
    if (!isAllowed(identity, read)) {
      throw new ForbiddenException(missingPermission(read))
    }
    const day = today()
    const erasing = { tenantId: identity.tenantId, userId: identity.userId, reason: erasureReason }

    try {
      const erased = await this.database.forTenant(erasing, async (tx) => {
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

      // The account behind a file that went, outside the transaction (#846).
      if (kind === 'person' || kind === 'staff_year') {
        await finishErasedAccounts(this.database, identity.tenantId)
      }

      return erased
    } catch (error) {
      if (error instanceof ErasureRefused) {
        throw new ConflictException(error.message)
      }

      throw error
    }
  }

  /**
   * The request that runs for a customer, for its file (#845), or null in
   * `running`. Read with the customers.
   */
  @Get('requests')
  @RequiresPermission('customer.read')
  async request(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('customerId') customerId: unknown,
  ): Promise<{ readonly running: ErasureRequestView | null }> {
    if (typeof customerId !== 'string' || !uuidPattern.test(customerId)) {
      throw new BadRequestException('Welcher Kunde, fehlt.')
    }

    const [running] = await this.database.forTenant(identity, (tx) =>
      runningRequestsOf(tx, today(), customerId),
    )

    return { running: running ?? null }
  }

  /**
   * Records a request of a customer to be deleted (Art. 17 DSGVO), by
   * whoever may change customers: the day it came in and how. The answer is
   * due a month later, and a deadline says so. One runs per customer at a
   * time, as the index of the table says.
   */
  @Post('requests')
  @RequiresPermission('customer.write')
  async record(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<ErasureRequestView> {
    const day = today()
    const problem = erasureRequestProblem(body, day)
    const { customerId } =
      typeof body === 'object' && body !== null ? (body as { customerId?: unknown }) : {}

    if (problem !== null) {
      throw new UnprocessableEntityException(problem)
    }

    if (typeof customerId !== 'string' || !uuidPattern.test(customerId)) {
      throw new UnprocessableEntityException('Welcher Kunde, fehlt.')
    }

    const { receivedOn, channel } = body as { receivedOn: IsoDate; channel: ErasureRequestChannel }
    const recording = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      reason: requestReason,
    }

    return this.database.forTenant(recording, async (tx) => {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, customerId.toLowerCase() as CustomerId),
            isNull(customers.deletedAt),
          ),
        )
        .for('no key update')

      if (customer === undefined) {
        throw new NotFoundException()
      }

      const inserted = await tx
        .insert(erasureRequests)
        .values({
          tenantId: identity.tenantId,
          customerId: customer.id,
          receivedOn,
          channel,
          answerDueOn: answerDueOf(receivedOn),
          // Set by `record_note_author` from the person of the transaction.
          createdBy: identity.userId,
        })
        .onConflictDoNothing()
        .returning({ id: erasureRequests.id })

      if (inserted.length === 0) {
        throw new ConflictException(oneAtATime)
      }

      const [view] = await runningRequestsOf(tx, day, customer.id)

      if (view === undefined) {
        throw new Error('A request just recorded is not there')
      }

      return view
    })
  }

  /**
   * Answers an open request by restricting its customer (Art. 18 DSGVO),
   * while only documents to keep or a warranty hold it. Only whoever leads
   * the business answers, as the policy of the table says; the route asks
   * first, so that a refusal is a sentence.
   */
  @Post('requests/:id/restriction')
  @RequiresPermission('customer.read')
  async restrict(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<ErasureRequestView> {
    if (!uuidPattern.test(id)) {
      throw new NotFoundException()
    }

    const day = today()
    const restricting = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      reason: restrictReason,
    }

    return this.database.forTenant(restricting, async (tx) => {
      if (!(await personLeads(tx, identity.userId, day))) {
        throw new ForbiddenException(leadersOnly)
      }

      const [row] = await tx
        .select({ customerId: erasureRequests.customerId, status: erasureRequests.status })
        .from(erasureRequests)
        .where(eq(erasureRequests.id, id.toLowerCase() as never))
        .for('update')

      if (row === undefined || row.status !== 'open') {
        throw new NotFoundException()
      }

      const [view] = await runningRequestsOf(tx, day, row.customerId)

      if (view?.answer !== 'restrict') {
        throw new ConflictException(
          view?.answer === 'erase'
            ? 'Mit diesem Kunden läuft nichts mehr; er wird gelöscht, nicht gesperrt.'
            : 'Solange ein Auftrag offen ist oder ein Wartungsvertrag läuft, wird der Kunde nicht gesperrt.',
        )
      }

      await restrictCustomer(tx, id.toLowerCase())

      const [restricted] = await runningRequestsOf(tx, day, row.customerId)

      if (restricted === undefined) {
        throw new Error('A request just restricted is not there')
      }

      return restricted
    })
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
