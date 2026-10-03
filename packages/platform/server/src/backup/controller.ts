import { Controller, Get, Inject, type Provider, type Type } from '@nestjs/common'
import type { BackupStatus } from '@opengewerk/platform-domain'
import { eq } from 'drizzle-orm'

import { RequiresPermission } from '../api/authorization.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database } from '../database/database.js'
import { tenants } from '../database/schema/tenants.js'
import { readInstanceSettings } from '../instance/settings.js'
import { backupStatus } from './status.js'

/**
 * The directory the backups record their last run in (#130), or null where
 * the instance does not know one: a development machine, a preview, a test.
 */
export const BACKUP_STATUS = Symbol('BackupStatus')

/**
 * When the last backup of the instance finished (#130), for the screen that
 * shows it and the warning at the top of the office of a tenant.
 *
 * Under the right the application gives it, the one its settings are read
 * with: whoever looks after a tenant is the one to notice that nothing was
 * backed up for two days. It says nothing about the data of anybody else,
 * only when a backup ran. Under `settings`, beside the settings of the
 * application, because that is where a person looks for it.
 */
function backupStatusController(right: string): Type<unknown> {
  @Controller('settings/backup')
  class BackupStatusController {
    constructor(
      readonly database: Database,
      @Inject(BACKUP_STATUS) readonly directory: string | null,
    ) {}

    @Get()
    @RequiresPermission(right)
    async status(@CurrentIdentity() identity: RequestIdentity): Promise<BackupStatus> {
      const since = await this.database.forTenant(identity, async (tx) => {
        const [tenant] = await tx
          .select({ createdAt: tenants.createdAt })
          .from(tenants)
          .where(eq(tenants.id, identity.tenantId))

        return tenant?.createdAt ?? new Date()
      })

      // The hour is the instance's, set by whoever runs it (#188), and only named here.
      const { backupTime } = await readInstanceSettings(this.database)

      return backupStatus(this.directory, since, new Date(), backupTime)
    }
  }

  return BackupStatusController
}

/** What the route of the last backup is put together from. */
export interface BackupStatusParts<Right extends string> {
  /** The rights of the application, which have to hold the one named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  /** The right a person needs to see when the last backup ran. */
  readonly read: Right
  /** Where the backups record their last run, or null where the instance knows nothing of them. */
  readonly directory: string | null
}

/**
 * The route of the last backup and what it is handed, for the module of an
 * application, the way `fileParts` hands the route of the file store.
 */
export function backupStatusParts<Right extends string>(
  parts: BackupStatusParts<Right>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  if (!parts.access.catalogue.isRight(parts.read)) {
    throw new Error(`The catalogue lacks the right to see the last backup: ${parts.read}`)
  }

  return {
    controllers: [backupStatusController(parts.read)],
    providers: [{ provide: BACKUP_STATUS, useValue: parts.directory }],
  }
}
