import type { AccountDay, FederalState, IsoDate } from '@opengewerk/domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * The time account (#289) as the server works it out: its target comes from
 * the file, the absences and the holidays, none of which are on a device.
 * Every count is the server's, from `domain`; a screen only adds up days.
 */

export interface TimeAccount {
  readonly hasFile: boolean
  readonly startsOn: IsoDate | null
  readonly countedUntil: IsoDate | null
  readonly state: FederalState | null
  readonly balanceBeforeMinutes: number
  readonly balanceMinutes: number
  readonly days: readonly AccountDay[]
}

const stretch = (from: IsoDate, to: IsoDate) => `from=${from}&to=${to}`

/** The account of somebody whose time the office reads, by the account they sign in with. */
export function timeAccountOf(userId: string, from: IsoDate, to: IsoDate): Promise<TimeAccount> {
  return request<TimeAccount>(
    `/time-account?userId=${encodeURIComponent(userId)}&${stretch(from, to)}`,
  )
}

/** One's own account. */
export function ownTimeAccount(from: IsoDate, to: IsoDate): Promise<TimeAccount> {
  return request<TimeAccount>(`/time-account/mine?${stretch(from, to)}`)
}
