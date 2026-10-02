import { Body, Controller, Post } from '@nestjs/common'
import { createOwnTenant, Database } from '@opengewerk/platform-server'

import { access } from '../authentication/access.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * A further business for the owner asking (#142), under "Konto". The owner is
 * its owner from the first moment, with the second factor already set up, and
 * switches to it without signing in again (#242).
 *
 * How a further business comes to be is the foundation's (ADR 0010). That
 * somebody may create one for themselves, and behind which right, is this
 * application's, and so the route is here.
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

    return createOwnTenant(this.database, access, identity.userId, name)
  }
}
