/**
 * What the office is told about the backups of its instance (#130), by the
 * server, which alone can read the record a backup leaves behind. Here and
 * not in the server because the screen reads the same shape.
 *
 * `unknown` when the instance does not know where that record is, which is a
 * development machine or the preview, and nothing to warn about. `none` when
 * it knows and there is no record yet. `recorded` with the last backup that
 * finished.
 */
export type BackupStatus =
  | { readonly state: 'unknown' }
  | { readonly state: 'none'; readonly overdue: boolean; readonly time: string }
  | {
      readonly state: 'recorded'
      /** When it finished, as an ISO timestamp in UTC. */
      readonly finishedAt: string
      readonly archive: string
      readonly bytes: number
      readonly encrypted: boolean
      readonly overdue: boolean
      /** When the nightly backup runs, "HH:MM", as the operators of the instance set it (#188). */
      readonly time: string
    }

/** When the nightly backup runs until an operator chooses another time. */
export const defaultBackupTime = '02:30'

/**
 * After this long without a backup the office warns. Two nights: one missed
 * night is a machine that was off, two are something to look at.
 */
export const backupOverdueAfterHours = 48
