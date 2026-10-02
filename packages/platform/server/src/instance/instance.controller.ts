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
} from '@opengewerk/platform-domain'

import { RequiresOperator, RequiresSession } from '../api/authorization.js'
import { CurrentUser, type SignedInUser } from '../api/identity.js'
import { ACCESS_RULES, type AccessRules } from '../authentication/access.js'
import { Database } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { operatorAccess } from './access.js'
import { readInstanceLog } from './log.js'
import { appointOperator, listOperators, removeOperator } from './operators.js'
import {
  checkedChange,
  type InstanceSettingsCache,
  readInstanceSettings,
  saveInstanceSettings,
} from './settings.js'
import { createTenantFor, listInstanceTenants } from './tenants.js'

/**
 * The settings of the instance in memory, handed in by an application that
 * keeps them there: a change made in the area then reaches whatever reads
 * them on the next request, and not on the next refresh.
 */
export const INSTANCE_SETTINGS = Symbol('InstanceSettings')

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined
}

/**
 * The area of the instance (#188), for whoever runs it: the tenants on it
 * (#142), its settings, the accounts that run it and its log. Not the
 * workplace of any tenant; every route but the first asks for somebody who
 * runs the instance and has a second factor, and nothing here reads what is
 * in a tenant.
 */
@Controller('instance')
export class InstanceController {
  constructor(
    private readonly database: Database,
    @Inject(ACCESS_RULES) private readonly access: AccessRules,
    @Optional()
    @Inject(INSTANCE_SETTINGS)
    private readonly settingsInMemory?: InstanceSettingsCache | null,
  ) {}

  /** Whether the person asking may enter, for the entry in the menu under the name. */
  @Get('access')
  @RequiresSession()
  entry(@CurrentUser() user: SignedInUser): Promise<InstanceAccess> {
    return operatorAccess(this.database, user.userId, user.sessionId)
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

    // At once for the mail server a tenant is checking right now, not in half a minute.
    await this.settingsInMemory?.refresh()

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

    return appointOperator(this.database, this.access.sentences.instance, user.userId, email)
  }

  @Delete('operators/:userId')
  @RequiresOperator()
  async remove(
    @CurrentUser() user: SignedInUser,
    @Param('userId') userId: string,
  ): Promise<{ readonly removed: string }> {
    await removeOperator(this.database, this.access.sentences.instance, user.userId, userId)

    return { removed: userId }
  }

  @Get('log')
  @RequiresOperator()
  log(
    @CurrentUser() user: SignedInUser,
    @Query('before') before: unknown,
  ): Promise<InstanceLogPage> {
    if (before !== undefined && (typeof before !== 'string' || !isUuid(before))) {
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
   * A tenant for somebody else (#142): the tenant and an invitation to lead
   * it. The link is in this answer and nowhere else, as when somebody is
   * invited into a tenant.
   */
  @Post('tenants')
  @RequiresOperator()
  async createFor(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<{ readonly tenantId: string; readonly token: string; readonly expiresAt: string }> {
    const created = await createTenantFor(this.database, this.access, user.userId, {
      name: field(body, 'name'),
      leadName: field(body, 'leadName'),
      leadEmail: field(body, 'leadEmail'),
    })

    return {
      tenantId: created.tenantId,
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
    }
  }
}
