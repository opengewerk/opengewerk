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
  /**
   * Bringing a customer into being, apart from changing one that exists. The
   * one subject whose verbs are cut this finely, and a deliberate exception
   * rather than the start of a scheme: ADR 0005 pictures a call out at an
   * address nobody has entered yet, and a technician who may create that
   * customer must still not be able to correct the address of another. Every
   * other subject keeps one writing right until a case like this one turns up
   * for it too.
   */
  'customer.create',
  /** Changing and removing a customer that is already there, not creating one. */
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
  /**
   * Tasks, one right to read and one to write, and writing includes marking
   * one done. Not narrowed to one's own: a task is written by whoever notices
   * that something has to happen, for whoever has to do it, and the office
   * that hands a task on is as much its user as the technician who does it.
   */
  'task.read',
  'task.write',
  /**
   * The files in the business's records (#77), one right to read and one to
   * add and remove. Not narrowed to one subject: a photo taken on site belongs
   * to the job, the installation and the customer at once, and whoever may
   * look at any of them needs to see it.
   */
  'attachment.read',
  'attachment.write',
  /**
   * Working time (#76). Everybody records their own, which is `time.write`
   * and which nobody may do for somebody else. `time.read` is reading the time
   * of everybody in the business, the office's job under § 17 MiLoG: without
   * it, a device gets its own person's entries and nobody else's, because
   * working hours are personal data a colleague has no business reading.
   */
  'time.read',
  'time.write',
  /**
   * Sending an outbox and reading what came back. A right of its own because
   * it is a different way in, not a different thing to do: what an operation
   * may touch is still decided by the rights above, entity by entity.
   */
  'sync.read',
  'sync.write',
  /**
   * What the business has set for itself: whether it claims the small business
   * rule, what payment term it puts on an invoice. Not what the law says, that
   * is not anybody's to set.
   */
  'settings.read',
  'settings.write',
  /**
   * Who works in this business, what they may do here, and whether they still
   * get in. Named in ADR 0006 as the place a change of rights belongs, and in
   * `rls.ts` since the memberships got their policies; until #63 neither name
   * existed as a key.
   *
   * Only the owner has them. Not the office, although the screen behind them
   * lives in the office application: somebody who can hand out roles can hand
   * themselves the owner role, and a right that can be widened by whoever
   * holds it is not a boundary. Widening this later is one line; narrowing it
   * once somebody works that way is a conversation.
   */
  'membership.read',
  'membership.write',
  /**
   * The mail server a business sends through, and the signature under its
   * messages. Rights of their own and not part of the settings, because the
   * login to a mailbox is a way of writing in the business's name to anybody:
   * the office reads what the business claims about its taxation, and it does
   * not need to see which mailbox the business writes from, let alone change
   * it.
   *
   * Only the owner has them, like the user administration. Reading and writing
   * are apart all the same, so that the day somebody else should see the
   * settings without changing them it is one line in one role.
   */
  'mail.read',
  'mail.write',
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
  'customer.create',
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
  'task.read',
  'task.write',
  'attachment.read',
  'attachment.write',
  'time.read',
  'time.write',
  'sync.read',
  'sync.write',
  // Reading, not setting. What a business claims about its own taxation is a
  // decision for whoever answers for it.
  'settings.read',
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
  // A call out at an address that is not in the system yet is the case the
  // whole offline story is built around, so this one is granted. Correcting
  // what the office has entered is not, and `customer.write` stays away.
  'customer.create',
  'site.read',
  'installation.read',
  'installation.write',
  'job.read',
  'document.read',
  'document.write',
  // What turns up on site and has to be done later, and what the office
  // handed on to be done there.
  'task.read',
  'task.write',
  // The photo of the type plate and the plan in the cabinet door.
  'attachment.read',
  'attachment.write',
  // Their own working time, and only their own: no `time.read`.
  'time.write',
  // The one who is actually in a basement without a network.
  'sync.read',
  'sync.write',
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

/** Every right a set of roles adds up to. */
export function permissionsOfRoles(keys: readonly RoleKey[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>()

  for (const key of keys) {
    for (const permission of roles[key].permissions) {
      granted.add(permission)
    }
  }

  return granted
}

/** Every right the roles of this identity add up to. */
export function permissionsOf(identity: Identity): ReadonlySet<Permission> {
  return permissionsOfRoles(identity.roles)
}

/**
 * Whether these roles carry this right.
 *
 * The same question `isAllowed` answers, asked where there is no identity to
 * hand. The interface is such a place: it knows the roles of the business it
 * is working in, because the chooser handed them over, and it uses them to
 * decide which entries the navigation shows. That is a courtesy and not a
 * gate, and it has to be said out loud: the gate is the guard on the server,
 * which asks the same question of the membership on every request. A hidden
 * entry and a refused route are two different promises, and only the second
 * one is kept here.
 */
export function rolesAllow(keys: readonly RoleKey[], permission: Permission): boolean {
  return permissionsOfRoles(keys).has(permission)
}

export function isAllowed(identity: Identity, permission: Permission): boolean {
  return permissionsOf(identity).has(permission)
}
