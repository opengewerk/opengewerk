import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  type Type,
} from '@nestjs/common'

import { RequiresPermission } from '../api/authorization.js'
import { pick } from '../api/body.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database } from '../database/database.js'
import {
  NumberRangeRefused,
  type NumberRangeStore,
  type NumberRangeView,
} from '../database/number-ranges.js'

/**
 * The number ranges of a tenant, under "Einstellungen" in the office
 * (opengewerk-haustechnik#127). The pattern of each sequence is a setting from the start, one row
 * per tenant, and a setting only reachable with SQL is not one a tenant has.
 *
 * Read with one right and changed with another, both the application's: the
 * numbers end up on what the tenant hands out, so whoever writes the settings
 * decides how they look. A changed pattern applies from the next number, and
 * the counter only goes up (`numberRangeStore`), so that no number is handed
 * out twice.
 */
function numberRangesController<Key extends string>(
  parts: NumberRangeParts<Key, string>,
): Type<unknown> {
  const { keys, store } = parts

  @Controller('settings/number-ranges')
  class NumberRangesController {
    constructor(readonly database: Database) {}

    @Get()
    @RequiresPermission(parts.read)
    list(@CurrentIdentity() identity: RequestIdentity): Promise<NumberRangeView<Key>[]> {
      return this.database.forTenant(identity, (tx) => store.numberRangesOf(tx, identity.tenantId))
    }

    @Put(':key')
    @RequiresPermission(parts.write)
    async change(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('key') key: string,
      @Body() body: unknown,
    ): Promise<NumberRangeView<Key>> {
      if (!(keys as readonly string[]).includes(key)) {
        throw new NotFoundException('Diesen Nummernkreis gibt es nicht.')
      }

      const values = pick(body ?? {}, ['pattern', 'nextValue'] as const)

      if (typeof values.pattern !== 'string') {
        throw new BadRequestException('Das Muster fehlt.')
      }

      if (values.nextValue !== undefined && typeof values.nextValue !== 'number') {
        throw new BadRequestException('Die nächste Nummer ist eine Zahl.')
      }

      const pattern = values.pattern.trim()
      const nextValue = values.nextValue

      try {
        return await this.database.forTenant(identity, (tx) =>
          store.changeNumberRange(tx, identity.tenantId, key as Key, {
            pattern,
            ...(nextValue === undefined ? {} : { nextValue }),
          }),
        )
      } catch (error) {
        if (error instanceof NumberRangeRefused) {
          throw new BadRequestException(error.message)
        }

        throw error
      }
    }
  }

  return NumberRangesController
}

/** What the routes of the number ranges are put together from. */
export interface NumberRangeParts<Key extends string, Right extends string> {
  /** The rights of the application, which have to hold the two named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  /** The right a person needs to see the number ranges. */
  readonly read: Right
  /** The right a person needs to change a pattern or raise a counter. */
  readonly write: Right
  /** The sequences of the application; any other key is a route that does not exist. */
  readonly keys: readonly Key[]
  /** The store of the application's sequences (`numberRangeStore`). */
  readonly store: Pick<NumberRangeStore<Key>, 'numberRangesOf' | 'changeNumberRange'>
}

/**
 * The routes of the number ranges, for the module of an application, the way
 * `backupStatusParts` hands the route of the last backup.
 */
export function numberRangeParts<const Key extends string, Right extends string>(
  parts: NumberRangeParts<Key, Right>,
): { readonly controllers: Type<unknown>[] } {
  for (const right of [parts.read, parts.write]) {
    if (!parts.access.catalogue.isRight(right)) {
      throw new Error(`The catalogue lacks a right of the number ranges: ${right}`)
    }
  }

  return { controllers: [numberRangesController(parts)] }
}
