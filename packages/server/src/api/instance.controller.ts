import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import type {
  InstanceAccess,
  InstanceLogPage,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
} from '@opengewerk/domain'

import { Database } from '../database/database.js'
import { readInstanceLog } from '../instance/log.js'
import {
  appointOperator,
  listOperators,
  operatorAccess,
  removeOperator,
} from '../instance/operators.js'
import {
  checkedChange,
  type InstanceSettingsCache,
  readInstanceSettings,
  saveInstanceSettings,
} from '../instance/settings.js'
import { createTenantFor, listInstanceTenants } from '../instance/tenants.js'
import { RequiresOperator, RequiresSession } from './authorization.js'
import { CurrentUser, type SignedInUser } from './identity.js'

/** What the server hands the area of the instance: the settings every connection reads. */
export const INSTANCE = Symbol('Instance')

export interface InstanceContext {
  readonly settings: InstanceSettingsCache
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined
}

/**
 * The area of the instance (#188), for its operators: the businesses on it
 * (#142), its settings, its operators and its log. Not the office of any
 * business; every route but the first asks for an operator with a second
 * factor, and nothing here reads what is in a business.
 */
@Controller('instance')
export class InstanceController {
  constructor(
    private readonly database: Database,
    @Optional() @Inject(INSTANCE) private readonly instance?: InstanceContext,
  ) {}

  /** Whether the person asking may enter, for the entry in the menu under the name. */
  @Get('access')
  @RequiresSession()
  access(@CurrentUser() user: SignedInUser): Promise<InstanceAccess> {
    return operatorAccess(this.database, user.userId)
  }

  @Get('settings')
  @RequiresOperator()
  settings(): Promise<InstanceSettingsView> {
    return readInstanceSettings(this.database)
  }

  @Put('settings')
  @RequiresOperator()
  async saveSettings(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<InstanceSettingsView> {
    const saved = await saveInstanceSettings(this.database, user.userId, checkedChange(body))

    // At once for the mail server a business is checking right now, not in half a minute.
    await this.instance?.settings.refresh()

    return saved
  }

  @Get('operators')
  @RequiresOperator()
  operators(@CurrentUser() user: SignedInUser): Promise<OperatorView[]> {
    return listOperators(this.database, user.userId)
  }

  @Post('operators')
  @RequiresOperator()
  appoint(@CurrentUser() user: SignedInUser, @Body() body: unknown): Promise<OperatorView> {
    const email = field(body, 'email')

    if (typeof email !== 'string') {
      throw new BadRequestException('Die E-Mail-Adresse fehlt.')
    }

    return appointOperator(this.database, user.userId, email)
  }

  @Delete('operators/:userId')
  @RequiresOperator()
  async remove(
    @CurrentUser() user: SignedInUser,
    @Param('userId') userId: string,
  ): Promise<{ readonly removed: string }> {
    await removeOperator(this.database, user.userId, userId)

    return { removed: userId }
  }

  @Get('log')
  @RequiresOperator()
  log(
    @CurrentUser() user: SignedInUser,
    @Query('before') before: unknown,
  ): Promise<InstanceLogPage> {
    if (before !== undefined && (typeof before !== 'string' || !uuidPattern.test(before))) {
      throw new BadRequestException('before ist die Kennung eines Eintrags.')
    }

    return readInstanceLog(this.database, user.userId, typeof before === 'string' ? before : null)
  }

  @Get('tenants')
  @RequiresOperator()
  tenants(@CurrentUser() user: SignedInUser): Promise<InstanceTenantView[]> {
    return listInstanceTenants(this.database, user.userId)
  }

  /**
   * A business for somebody else (#142): the business and an invitation to be
   * its owner. The link is in this answer and nowhere else, as when the
   * office invites somebody.
   */
  @Post('tenants')
  @RequiresOperator()
  async createFor(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<{ readonly tenantId: string; readonly token: string; readonly expiresAt: string }> {
    const created = await createTenantFor(this.database, user.userId, {
      name: field(body, 'name'),
      ownerName: field(body, 'ownerName'),
      ownerEmail: field(body, 'ownerEmail'),
    })

    return { tenantId: created.tenantId, token: created.token, expiresAt: created.expiresAt.toISOString() }
  }
}
