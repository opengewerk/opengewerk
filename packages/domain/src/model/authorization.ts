import type { TenantId } from './identifier.js'

/**
 * What somebody is allowed to do. Rights are cut along actions, not along
 * screens: hiding a button is a courtesy, refusing the action is the rule.
 * The names are `subject.verb`, and `.own` narrows a right to the records the
 * person is assigned to.
 *
 * They are English like every other identifier in the code, although ADR 0006
 * writes its examples in German. That ADR predates the language rule by hours,
 * and these keys end up in the database next to English table names and in the
 * interface that lets a trade package register rights of its own.
 */
export const permissions = [
  'customer.read',
  'customer.write',
  'site.read',
  'site.write',
  'installation.read',
  'installation.write',
  'job.read',
  'job.write',
  'document.read',
  'document.write',
  /**
   * Issuing a document. Separate from writing one, and deliberately so: from
   * that moment the document is fixed, gets its number and can only be
   * corrected by a cancellation. That is the line between a draft somebody
   * fixes on site and a piece of bookkeeping.
   */
  'document.issue',
] as const

export type Permission = (typeof permissions)[number]

/**
 * The roles a business starts with. The full list in ADR 0006 is longer;
 * accounting, site manager and the read only role for the tax office arrive
 * with the phases that need them.
 */
export const roleKeys = ['owner', 'office', 'technician'] as const

export type RoleKey = (typeof roleKeys)[number]

export interface Role {
  readonly key: RoleKey
  /** The German label, because this one is read by a person. */
  readonly label: string
  readonly permissions: readonly Permission[]
}

const officePermissions: readonly Permission[] = [
  'customer.read',
  'customer.write',
  'site.read',
  'site.write',
  'installation.read',
  'installation.write',
  'job.read',
  'job.write',
  'document.read',
  'document.write',
  'document.issue',
]

/**
 * A technician records what happened: hours, readings, a report the customer
 * signs. Writing a document is part of that. Issuing one is not, and that is
 * the whole point of keeping the two rights apart.
 *
 * ADR 0006 also mentions a right narrowed to one's own jobs. It is not in the
 * list, because the assignment of a person to a job does not exist yet and a
 * right that grants everything while sounding narrow is worse than no right at
 * all. It arrives with that assignment.
 */
const technicianPermissions: readonly Permission[] = [
  'customer.read',
  'site.read',
  'installation.read',
  'installation.write',
  'job.read',
  'document.read',
  'document.write',
]

export const roles: Readonly<Record<RoleKey, Role>> = {
  owner: {
    key: 'owner',
    label: 'Inhaber',
    permissions: permissions,
  },
  office: {
    key: 'office',
    label: 'Büro',
    permissions: officePermissions,
  },
  technician: {
    key: 'technician',
    label: 'Monteur',
    permissions: technicianPermissions,
  },
}

/**
 * Who is asking. The tenant decides whose data is in reach, the roles decide
 * what may be done with it. Two questions, two mechanisms: row level security
 * answers the first in the database, this answers the second in the server.
 */
export interface Identity {
  readonly userId: string
  readonly tenantId: TenantId
  readonly roles: readonly RoleKey[]
}

/** Every right the roles of this identity add up to. */
export function permissionsOf(identity: Identity): ReadonlySet<Permission> {
  const granted = new Set<Permission>()

  for (const key of identity.roles) {
    for (const permission of roles[key].permissions) {
      granted.add(permission)
    }
  }

  return granted
}

export function isAllowed(identity: Identity, permission: Permission): boolean {
  return permissionsOf(identity).has(permission)
}
