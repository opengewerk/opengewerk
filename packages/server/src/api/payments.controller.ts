import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { DocumentId } from '@opengewerk/domain'

import { Database } from '../database/database.js'
import {
  openAmounts,
  PaymentRefused,
  paymentsOf,
  recordPayment,
  removePayment,
} from '../payments/payments.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { pick } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * What came in on an invoice (#189), recorded by hand in the office.
 *
 * Three routes and no more: the payments of an invoice with what it asks for,
 * recording one, and removing one recorded by mistake. There is no change to a
 * payment; a wrong one is removed and recorded again, and the audit log keeps
 * both steps. What they are for now is the final invoice, which takes off what
 * came in on each progress invoice before it.
 */
@Controller('documents/:documentId/payments')
export class PaymentsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('payment.read')
  async list(@CurrentIdentity() identity: RequestIdentity, @Param('documentId') id: string) {
    const found = await this.database.forTenant(identity, (tx) => paymentsOf(tx, id as DocumentId))

    if (!found) {
      // A document that takes no payments, one that is not issued, one of
      // another business and one that is not there: the same answer for all.
      throw new NotFoundException()
    }

    return found
  }

  @Post()
  @RequiresPermission('payment.write')
  async record(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, ['amountCents', 'receivedOn'] as const)

    try {
      return await this.database.forTenant(identity, (tx) =>
        recordPayment(
          tx,
          identity.tenantId,
          id as DocumentId,
          { amountCents: values['amountCents'], receivedOn: values['receivedOn'] },
          todayInGermany(),
        ),
      )
    } catch (error) {
      if (error instanceof PaymentRefused) {
        throw new UnprocessableEntityException(error.message)
      }

      throw error
    }
  }

  @Delete(':paymentId')
  @RequiresPermission('payment.write')
  @HttpCode(204)
  async remove(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    const removed = await this.database.forTenant(identity, (tx) =>
      removePayment(tx, id as DocumentId, paymentId),
    )

    if (!removed) {
      throw new NotFoundException()
    }
  }
}

/**
 * What is still open on every issued invoice, for the list of documents in
 * the office and its chip "Offen" (#219). A list of what each asks for and
 * what came in, so the office works out the rest the way it shows it.
 */
@Controller('payments')
export class OpenPaymentsController {
  constructor(private readonly database: Database) {}

  @Get('open')
  @RequiresPermission('payment.read')
  open(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) => openAmounts(tx))
  }
}
