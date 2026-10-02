import { Controller, Get, Inject } from '@nestjs/common'
import type { BackupStatus } from '@opengewerk/domain'
import { Database, readInstanceSettings } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { tenants } from '../database/schema/index.js'
import { backupStatus } from '../operations/backup-status.js'
import { RequiresPermission } from './authorization.js'
import { BACKUP_STATUS } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * When the last backup of the instance finished (#130), for the screen
 * "Sicherung" and the warning at the top of the office.
 *
 * Under `settings.read`, like the other settings: the owner and the office see
 * it, because both are the ones to notice that nothing was backed up for two
 * days. It says nothing about the data of anybody else, only when a backup ran.
 */
@Controller('settings/backup')
export class BackupStatusController {
  constructor(
    private readonly database: Database,
    @Inject(BACKUP_STATUS) private readonly directory: string | null,
  ) {}

  @Get()
  @RequiresPermission('settings.read')
  async status(@CurrentIdentity() identity: RequestIdentity): Promise<BackupStatus> {
    const since = await this.database.forTenant(identity, async (tx) => {
      const [tenant] = await tx
        .select({ createdAt: tenants.createdAt })
        .from(tenants)
        .where(eq(tenants.id, identity.tenantId))

      return tenant?.createdAt ?? new Date()
    })

    // The hour is the instance's, set by its operators (#188), and only named here.
    const { backupTime } = await readInstanceSettings(this.database)

    return backupStatus(this.directory, since, new Date(), backupTime)
  }
}
