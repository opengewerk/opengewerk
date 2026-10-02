import { permissionCatalogue, shippedRoles } from '@opengewerk/domain'
import { keptTenantsKey } from '@opengewerk/platform-web/session'

/**
 * Puts a list of businesses kept by an earlier version into the form the
 * foundation reads.
 *
 * A device keeps the businesses of whoever is signed in, with their rights,
 * so that it opens without a network (#184). Until the roles of a business
 * were rows (ADR 0010), an entry held only the keys of the roles, and the
 * screens asked the three roles in this code what they allow. A device that
 * takes over this version without a network still has such a list, and would
 * show no task and no photo until the server answers, which is the very
 * thing the list is kept against.
 *
 * So such an entry is rewritten once, the way it was written: through the
 * three roles a business starts with. That is this application's knowledge
 * and not the foundation's, which holds no roles in its code. The first
 * answer of the server replaces the list.
 *
 * Called before anything reads the list, at the start of both entries.
 */
export function upgradeKeptTenants(storage: Storage | undefined = globalThis.localStorage): void {
  try {
    const raw = storage?.getItem(keptTenantsKey)
    const kept: unknown = raw ? JSON.parse(raw) : null

    if (!Array.isArray(kept)) {
      return
    }

    let changed = false
    const upgraded = kept.map((tenant: unknown) => {
      const older = olderChoice(tenant)

      if (!older) {
        return tenant
      }

      changed = true

      const held = shippedRoles.filter((role) => older.roles.includes(role.key))
      const sum = permissionCatalogue.sumOf(held)

      return {
        id: older.id,
        name: older.name,
        roles: older.roles,
        roleLabels: held.map((role) => role.label),
        rights: sum.rights,
        secondFactor: sum.secondFactor,
      }
    })

    if (changed) {
      storage?.setItem(keptTenantsKey, JSON.stringify(upgraded))
    }
  } catch {
    // Nothing kept, or a browser that refuses storage. Offline the device
    // then needs the network once, as before there was a list at all.
  }
}

function texts(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** An entry as the earlier version wrote it: the roles by key, and no rights. */
function olderChoice(
  tenant: unknown,
): { readonly id: string; readonly name: string; readonly roles: readonly string[] } | null {
  if (typeof tenant !== 'object' || tenant === null) {
    return null
  }

  const kept = tenant as { id?: unknown; name?: unknown; roles?: unknown; rights?: unknown }

  if (
    typeof kept.id !== 'string' ||
    typeof kept.name !== 'string' ||
    !texts(kept.roles) ||
    kept.rights !== undefined
  ) {
    return null
  }

  return { id: kept.id, name: kept.name, roles: kept.roles }
}
