import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common'
import {
  type IsoDate,
  paymentTermProblem,
  type TenantParameterKey,
  tenantParameterKeys,
  tenantParameterUnits,
} from '@opengewerk/domain'

import { Database } from '../database/database.js'
import {
  ParameterError,
  parameterAt,
  parameterHistory,
  setParameter,
} from '../database/parameters.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

function asKey(value: unknown): TenantParameterKey {
  if (typeof value !== 'string' || !(tenantParameterKeys as readonly string[]).includes(value)) {
    throw new BadRequestException(`Unbekannte Einstellung: ${String(value)}`)
  }

  return value as TenantParameterKey
}

function asDate(value: unknown, what: string): IsoDate {
  if (typeof value !== 'string' || !isoDate.test(value)) {
    throw new BadRequestException(`${what} muss ein Datum der Form 2026-01-01 sein.`)
  }

  return value as IsoDate
}

/**
 * The settings a business makes about itself.
 *
 * Deliberately not a place where the legal parameters can be reached. Those
 * ship as data packages and are the same for everybody; what is here is the
 * handful of decisions a business makes about itself, its taxation and the
 * payment term it gives its customers, and each one carries the period it
 * applied to.
 */
@Controller('settings/parameters')
export class SettingsController {
  constructor(private readonly database: Database) {}

  /** Every period of every setting, so that old documents stay explainable. */
  @Get()
  @RequiresPermission('settings.read')
  history(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) => parameterHistory(tx))
  }

  /** What applied on a given day, which is the only useful way to ask. */
  @Get('on')
  @RequiresPermission('settings.read')
  async on(
    @CurrentIdentity() identity: RequestIdentity,
    @Query('key') key: string,
    @Query('date') date: string,
  ) {
    const wanted = asKey(key)
    const day = asDate(date, 'Der Stichtag')

    return {
      key: wanted,
      on: day,
      parameter: await this.database.forTenant(identity, (tx) => parameterAt(tx, wanted, day)),
    }
  }

  /**
   * Sets a parameter from a day onwards. Nothing is edited: the period that
   * was open is closed the day before, a new one begins, and what applied last
   * year keeps applying to last year.
   */
  @Post()
  @RequiresPermission('settings.write')
  async set(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const fields = (body ?? {}) as Record<string, unknown>
    const key = asKey(fields['key'])
    const from = asDate(fields['from'], 'Der Beginn')
    const value = fields['value']

    if (!Number.isInteger(value)) {
      throw new BadRequestException(
        `Der Wert muss eine ganze Zahl sein, gezählt in ${tenantParameterUnits[key]}.`,
      )
    }

    // The payment term goes onto every document that states none of its own,
    // so the range a document may state is the range the setting may have,
    // refused with the same sentence the forms show.
    if (key === 'invoice.payment_term_days') {
      const problem = paymentTermProblem(value)

      if (problem !== null) {
        throw new BadRequestException(problem)
      }
    }

    const note = fields['note']

    try {
      return await this.database.forTenant(identity, (tx) =>
        setParameter(tx, identity.tenantId, {
          key,
          from,
          value: value as number,
          note: typeof note === 'string' ? note : null,
        }),
      )
    } catch (error) {
      if (error instanceof ParameterError) {
        throw new BadRequestException(error.message)
      }

      throw error
    }
  }
}
