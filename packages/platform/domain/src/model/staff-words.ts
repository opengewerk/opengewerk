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
 * Whether somebody can work: shut out, with a second factor, without the one
 * a role of theirs asks for, or simply at work. The app or a passkey, which
 * signs in only when confirmed on the device, both count as the second
 * factor.
 */
export type StaffState = 'blocked' | 'secured' | 'factorMissing' | 'active'

export function staffStateOf(
  person: StaffFacts,
  roles: readonly Pick<RoleDefinition, 'key' | 'secondFactor'>[],
): StaffState {
  if (person.blockedAt) {
    return 'blocked'
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
): string {
  switch (staffStateOf(person, roles)) {
    case 'blocked':
      return `Gesperrt seit ${moment(person.blockedAt ?? '')}`
    case 'secured':
      return 'Aktiv, zweiter Faktor eingerichtet'
    case 'factorMissing':
      return 'Zweiter Faktor fehlt'
    case 'active':
      return 'Aktiv'
  }
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
