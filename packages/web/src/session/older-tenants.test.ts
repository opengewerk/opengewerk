import { permissionCatalogue, shippedRoles } from '@opengewerk/domain'
import { keptTenantsKey } from '@opengewerk/platform-web/session'
import { describe, expect, it } from 'vitest'

import { upgradeKeptTenants } from './older-tenants.js'

/**
 * The list of businesses a device kept under a version from before the roles
 * of a business were rows. The foundation reads only the form the server
 * answers in today; that an older list still opens the screens of a device in
 * a basement is this application's to see to.
 */

/** A storage that counts what is written to it. */
function storageWith(kept: string | null) {
  const held = new Map<string, string>()
  const written: string[] = []

  if (kept !== null) {
    held.set(keptTenantsKey, kept)
  }

  const storage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value)
      written.push(key)
    },
  } as unknown as Storage

  return { storage, written, read: () => JSON.parse(held.get(keptTenantsKey) ?? 'null') as unknown }
}

const technician = shippedRoles.find((role) => role.key === 'technician')

describe('a list of businesses an earlier version kept', () => {
  it('is rewritten through the three roles a business starts with', () => {
    const { storage, read } = storageWith(
      JSON.stringify([{ id: 't-1', name: 'Elektro Nord', roles: ['technician'] }]),
    )

    upgradeKeptTenants(storage)

    expect(read()).toEqual([
      {
        id: 't-1',
        name: 'Elektro Nord',
        roles: ['technician'],
        roleLabels: ['Monteur'],
        rights: permissionCatalogue.sumOf(technician ? [technician] : []).rights,
        secondFactor: false,
      },
    ])
    // Not an empty list of rights, which would hide every task and photo.
    expect((read() as { rights: string[] }[])[0]?.rights).toContain('task.read')
  })

  it('asks for a second factor where one of the roles does', () => {
    const { storage, read } = storageWith(
      JSON.stringify([{ id: 't-1', name: 'Elektro Nord', roles: ['owner', 'office'] }]),
    )

    upgradeKeptTenants(storage)

    expect(read()).toMatchObject([{ roleLabels: ['Inhaber', 'Büro'], secondFactor: true }])
  })

  it('gives nothing for a key that is none of the three', () => {
    const { storage, read } = storageWith(
      JSON.stringify([{ id: 't-1', name: 'Elektro Nord', roles: ['bookkeeper'] }]),
    )

    upgradeKeptTenants(storage)

    expect(read()).toMatchObject([{ roleLabels: [], rights: [], secondFactor: false }])
  })

  it('leaves an entry the server resolved as it is, whatever its rights are', () => {
    // A business can take a right from a role. What the server said stands.
    const resolved = {
      id: 't-1',
      name: 'Elektro Nord',
      roles: ['owner'],
      roleLabels: ['Inhaber'],
      rights: ['customer.read'],
      secondFactor: true,
    }
    const older = { id: 't-2', name: 'Elektro Süd', roles: ['office'] }
    const { storage, read } = storageWith(JSON.stringify([resolved, older]))

    upgradeKeptTenants(storage)

    expect(read()).toMatchObject([resolved, { id: 't-2', roleLabels: ['Büro'] }])
  })

  it('writes nothing when there is nothing to rewrite', () => {
    const resolved = {
      id: 't-1',
      name: 'Elektro Nord',
      roles: ['owner'],
      roleLabels: ['Inhaber'],
      rights: [],
      secondFactor: true,
    }

    for (const kept of [JSON.stringify([resolved]), '{"not":"a list"}', 'not json', null]) {
      const { storage, written } = storageWith(kept)

      upgradeKeptTenants(storage)

      expect(written, String(kept)).toEqual([])
    }
  })

  it('is no reason not to start where a browser refuses to keep anything', () => {
    const refusing = {
      getItem: () => {
        throw new DOMException('refused', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('refused', 'SecurityError')
      },
    } as unknown as Storage

    expect(() => {
      upgradeKeptTenants(refusing)
    }).not.toThrow()
  })
})
