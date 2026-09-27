import { Body, Controller, Post } from '@nestjs/common'

import { Database } from '../database/database.js'
import { createOwnTenant } from '../instance/tenants.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * A further business for the owner asking (#142), under "Konto". The owner is
 * its owner from the first moment, with the second factor already set up, and
 * switches to it without signing in again (#242).
 */
@Controller('tenants')
export class TenantsController {
  constructor(private readonly database: Database) {}

  @Post()
  @RequiresPermission('tenant.create')
  create(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<{ readonly tenantId: string; readonly name: string }> {
    const name =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['name']
        : undefined

    return createOwnTenant(this.database, identity.userId, name)
  }
}
