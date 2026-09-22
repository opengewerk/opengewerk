import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common'
import { type NumberRangeKey, numberRangeKeys } from '@opengewerk/domain'

import { Database } from '../database/database.js'
import {
  changeNumberRange,
  NumberRangeRefused,
  numberRangesOf,
  type NumberRangeView,
} from '../database/number-ranges.js'
import { RequiresPermission } from './authorization.js'
import { pick } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * The number ranges of a business, under "Einstellungen" in the office.
 *
 * The pattern of each sequence was a setting from the start, one row per
 * business, and until now only reachable with SQL. The concept asks for it
 * to be configurable, and a setting a business can only change through a
 * database prompt is not one it has.
 *
 * Read by everybody who reads the settings, changed by whoever writes them,
 * which is the owner: like the letterhead, the numbers end up on every
 * document, and the office writes the documents without deciding how they
 * are numbered.
 */
@Controller('settings/number-ranges')
export class NumberRangesController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  list(@CurrentIdentity() identity: RequestIdentity): Promise<NumberRangeView[]> {
    return this.database.forTenant(identity, (tx) => numberRangesOf(tx, identity.tenantId))
  }

  @Put(':key')
  @RequiresPermission('settings.write')
  async change(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<NumberRangeView> {
    if (!(numberRangeKeys as readonly string[]).includes(key)) {
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
        changeNumberRange(tx, identity.tenantId, key as NumberRangeKey, {
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
