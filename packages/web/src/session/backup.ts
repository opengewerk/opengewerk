import type { BackupStatus } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * When the last backup of the instance finished, and whether that is too long
 * ago (#130). Read straight at the route, like the other settings: a device
 * without a network has no backup to report on.
 */
export function backupStatus(): Promise<BackupStatus> {
  return request<BackupStatus>('/settings/backup')
}
