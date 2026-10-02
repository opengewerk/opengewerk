import type { TenantId } from '@opengewerk/platform-domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRight, useRights } from './queries.js'
import { forgetSignIn } from './remembered.js'
import type { TenantChoice } from './session.js'
import { initialsOf, rolesInWords, useWho } from './who.js'

/**
 * What a screen offers, asked the way the guard asks (ADR 0010).
 *
 * The server resolves what the roles of a membership add up to from the rows
 * of the tenant and hands it over with each tenant. A screen decides by those
 * rights and holds no list of its own of what a role allows: a tenant can
 * change that, and a screen that asked the name of a role would go on
 * offering what the server refuses, or hide what it allows.
 *
 * The rights here are those of an application that belongs to nobody. To this
 * code a right is a name, and which names there are is not its business.
 */

let tenants: readonly TenantChoice[]
let worksIn: string

/** A tenant as `/auth/tenants` answers it, with whatever the test says about it. */
function aTenant(over: Partial<Omit<TenantChoice, 'id'>> & { readonly id?: string }): TenantChoice {
  return {
    name: 'Probewerk Nord',
    roles: ['member'],
    roleLabels: ['Mitglied'],
    rights: [],
    secondFactor: false,
    ...over,
    id: (over.id ?? 't-1') as TenantId,
  }
}

function Asks({ right }: { readonly right: string }) {
  const may = useRight(right)
  // The tenant by name, once the list of memberships has arrived. Until then
  // nobody may do anything, so a check of something hidden waits for it.
  const { tenant, roles, initials } = useWho()

  return (
    <>
      <p>{may ? 'darf' : 'darf nicht'}</p>
      {tenant ? (
        <p>
          {tenant}: {roles} ({initials})
        </p>
      ) : null}
    </>
  )
}

function ask(right: string): QueryClient {
  const client = new QueryClient()

  render(
    <QueryClientProvider client={client}>
      <Asks right={right} />
    </QueryClientProvider>,
  )

  return client
}

beforeEach(() => {
  forgetSignIn()
  worksIn = 't-1'

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          path.endsWith('/get-session')
            ? {
                user: { id: 'u-1', email: 'erika@probewerk.example.de', name: 'Erika Berg' },
                session: { activeTenantId: worksIn },
              }
            : path === '/auth/tenants'
              ? tenants
              : {},
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what a screen offers', () => {
  it('is what the server resolved for the roles of the session', async () => {
    tenants = [aTenant({ rights: ['shelf.read', 'shelf.write'] })]
    ask('shelf.write')

    expect(await screen.findByText('darf')).toBeTruthy()
  })

  it('is nothing the server did not resolve, whatever the role is called', async () => {
    // The role leads here and is called so. What it may do is still only what
    // the list says.
    tenants = [aTenant({ roles: ['lead'], roleLabels: ['Leitung'], rights: ['shelf.read'] })]
    ask('shelf.write')

    expect(await screen.findByText('Probewerk Nord: Leitung (EB)')).toBeTruthy()
    expect(screen.getByText('darf nicht')).toBeTruthy()
  })

  it('is asked of the tenant the session works in, not of another one of the account', async () => {
    tenants = [
      aTenant({ id: 't-1', name: 'Probewerk Nord', roles: ['lead'], roleLabels: ['Leitung'] }),
      aTenant({ id: 't-2', name: 'Probewerk Süd', rights: ['shelf.write'] }),
    ]
    worksIn = 't-2'
    ask('shelf.write')

    expect(await screen.findByText('Probewerk Süd: Mitglied (EB)')).toBeTruthy()
    expect(screen.getByText('darf')).toBeTruthy()
  })

  it('is nothing while the session works in no tenant of the list', async () => {
    tenants = [aTenant({ id: 't-2', rights: ['shelf.write'] })]

    const client = ask('shelf.write')

    // Until both answers are in, nobody may do anything, and a check right
    // away would pass on that alone. So it waits for the answers themselves:
    // nothing on the screen ever shows that they came.
    await vi.waitFor(() => {
      expect(client.getQueryData(['account'])).toBeTruthy()
      expect(client.getQueryData(['tenants'])).toBeTruthy()
    })

    expect(screen.getByText('darf nicht')).toBeTruthy()
    // No tenant by name either: the one of the session is not in the list.
    expect(screen.queryByText(/Probewerk/)).toBeNull()
  })

  /**
   * A role is called what its tenant calls it. The names come with the list,
   * in the order the tenant made the roles, and a role of its own has a name
   * like any other.
   */
  it('names the roles as the tenant names them', async () => {
    tenants = [
      aTenant({ roles: ['member', 'bookkeeper'], roleLabels: ['Mitglied', 'Buchhaltung'] }),
    ]
    ask('shelf.write')

    expect(await screen.findByText('Probewerk Nord: Mitglied, Buchhaltung (EB)')).toBeTruthy()
  })
})

describe('every right of a session at once', () => {
  function Lists() {
    const rights = useRights()
    const { tenant } = useWho()

    return (
      <>
        <p>{rights.length === 0 ? 'keine Rechte' : rights.join(' ')}</p>
        {tenant ? <p>{tenant}</p> : null}
      </>
    )
  }

  function list(): QueryClient {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <Lists />
      </QueryClientProvider>,
    )

    return client
  }

  /**
   * For a list that is narrowed by rights, as the settings an application
   * lists with the right each takes. The same answer `useRight` gives one
   * right at a time, from the same two places.
   */
  it('is the list the server resolved for the tenant the session works in', async () => {
    tenants = [
      aTenant({ id: 't-1', name: 'Probewerk Nord', rights: ['shelf.read'] }),
      aTenant({ id: 't-2', name: 'Probewerk Süd', rights: ['shelf.read', 'shelf.settings'] }),
    ]
    worksIn = 't-2'
    list()

    expect(await screen.findByText('shelf.read shelf.settings')).toBeTruthy()
  })

  it('is empty until the answers are there, and for a session in no tenant of the list', async () => {
    tenants = [aTenant({ id: 't-2', name: 'Probewerk Süd', rights: ['shelf.read'] })]

    const client = list()

    expect(screen.getByText('keine Rechte')).toBeTruthy()

    // And stays so once they are: the tenant of the session is not among
    // them. Waited for at the answers themselves, since the screen shows the
    // same before and after.
    await vi.waitFor(() => {
      expect(client.getQueryData(['account'])).toBeTruthy()
      expect(client.getQueryData(['tenants'])).toBeTruthy()
    })

    expect(screen.getByText('keine Rechte')).toBeTruthy()
    expect(screen.queryByText(/Probewerk/)).toBeNull()
  })
})

describe('somebody as a header names them', () => {
  it('has two letters from the first and the last name, or one, or a question mark', () => {
    expect(initialsOf('Erika Berg')).toBe('EB')
    expect(initialsOf('Erika Maria von Berg')).toBe('EB')
    expect(initialsOf('  beate ')).toBe('B')
    expect(initialsOf('')).toBe('?')
  })

  it('has several roles side by side, with a comma and no slash', () => {
    // A slash reads like a choice between them; somebody with two roles has both.
    expect(rolesInWords(['Leitung', 'Mitglied'])).toBe('Leitung, Mitglied')
    expect(rolesInWords([])).toBe('')
  })
})
