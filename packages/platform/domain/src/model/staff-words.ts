import type { IsoDate } from './identifier.js'
import type { RoleDefinition } from './rights.js'

/**
 * "Zugänge" in words, the same for the list and for its table
 * (opengewerk-haustechnik#236): what the roles of somebody are called, whether
 * they can work, and when this tenant last saw them.
 */

/** What the list of the staff says about one person, beside the name and the address. */
export interface StaffFacts {
  /** The keys of the roles, as the tenant has them. */
  readonly roles: readonly string[]
  readonly blockedAt: Date | string | null
  readonly lastSignInAt: Date | string | null
  readonly twoFactorEnabled: boolean
  readonly hasPasskey: boolean
  /** The last day they work here, none for an access without an end (for opengewerk-haustechnik#339). */
  readonly lastDay?: string | null
}

/** The columns of the staff as a table, as the list heads them. */
export const staffTableColumns = {
  access: 'Zugang',
  email: 'E-Mail',
  role: 'Rolle',
  state: 'Zustand',
  lastSeen: 'Zuletzt angemeldet',
} as const

/** The roles by the names the tenant gives them, and a key it has no row for as it is. */
export function roleNamesOf(
  keys: readonly string[],
  roles: readonly Pick<RoleDefinition, 'key' | 'label'>[],
): readonly string[] {
  return [
    ...roles.filter((role) => keys.includes(role.key)).map((role) => role.label),
    ...keys.filter((key) => !roles.some((role) => role.key === key)),
  ]
}

/** Whether one of these roles works only with a second factor, as the tenant has them. */
export function asksSecondFactor(
  keys: readonly string[],
  roles: readonly Pick<RoleDefinition, 'key' | 'secondFactor'>[],
): boolean {
  return roles.some((role) => role.secondFactor && keys.includes(role.key))
}

/**
 * Whether somebody can work: shut out, past the last day of their access,
 * with a second factor, without the one a role of theirs asks for, or simply
 * at work. The app or a passkey, which signs in only when confirmed on the
 * device, both count as the second factor.
 */
export type StaffState = 'blocked' | 'ended' | 'secured' | 'factorMissing' | 'active'

export function staffStateOf(
  person: StaffFacts,
  roles: readonly Pick<RoleDefinition, 'key' | 'secondFactor'>[],
  /** The day in Germany, against which a last day has passed. */
  today: IsoDate,
): StaffState {
  if (person.blockedAt) {
    return 'blocked'
  }

  if (person.lastDay !== undefined && person.lastDay !== null && person.lastDay < today) {
    return 'ended'
  }

  if (person.twoFactorEnabled || person.hasPasskey) {
    return 'secured'
  }

  return asksSecondFactor(person.roles, roles) ? 'factorMissing' : 'active'
}

/** The column "Zustand" in words, with the moment of a block as `moment` writes it. */
export function staffStateWords(
  person: StaffFacts,
  roles: readonly Pick<RoleDefinition, 'key' | 'secondFactor'>[],
  moment: (value: Date | string) => string,
  /** The day in Germany, against which a last day has passed. */
  today: IsoDate,
): string {
  const lastDay = person.lastDay ?? null
  // An access with an end says it: "Aktiv bis 30.11.2026".
  const until = lastDay === null ? '' : ` bis ${dayInWords(lastDay)}`

  switch (staffStateOf(person, roles, today)) {
    case 'blocked':
      return `Gesperrt seit ${moment(person.blockedAt ?? '')}`
    case 'ended':
      return `Abgelaufen, letzter Tag ${dayInWords(lastDay ?? '')}`
    case 'secured':
      return `Aktiv, zweiter Faktor eingerichtet${lastDay === null ? '' : ','}${until}`
    case 'factorMissing':
      return `Zweiter Faktor fehlt${lastDay === null ? '' : ','}${until}`
    case 'active':
      return `Aktiv${until}`
  }
}

/** A day as it is written in Germany, "30.11.2026". */
function dayInWords(day: string): string {
  const [year = '', month = '', date = ''] = day.split('-')

  return `${date}.${month}.${year}`
}

const inGermany = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
})

/**
 * A moment as somebody in Germany reads it, "11.10.2026, 14:05", whatever
 * the clock of the machine that writes it says: for a table the server
 * writes, where the screen takes the clock of the device.
 */
export function momentInGermany(value: Date | string): string {
  const at = typeof value === 'string' ? new Date(value) : value

  return Number.isNaN(at.getTime()) ? '' : inGermany.format(at)
}
