import type { Permission } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetSignIn } from '../session/remembered.js'
import type { TenantChoice } from '../session/session.js'
import { aTenantChoice } from '../session/test-tenants.js'
import { useMay } from './queries.js'
import { useWho } from './who.js'

/**
 * What a screen offers, asked the way the guard asks (ADR 0010).
 *
 * The server resolves what the roles of a membership add up to from the rows
 * of the business and hands it over with each business. A screen decides by
 * those rights and holds no list of its own of what a role allows: a business
 * can change that, and a screen that asked the name of a role would go on
 * offering what the server refuses, or hide what it allows.
 */

let tenants: readonly TenantChoice[]
let worksIn: string

function Asks({ right }: { readonly right: Permission }) {
  const may = useMay(right)
  // The business by name, once the list of memberships has arrived. Until
  // then nobody may do anything, so a check of something hidden waits for it.
  const { business, roles } = useWho()

  return (
    <>
      <p>{may ? 'darf' : 'darf nicht'}</p>
      {business ? (
        <p>
          {business}: {roles}
        </p>
      ) : null}
    </>
  )
}

function ask(right: Permission) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Asks right={right} />
    </QueryClientProvider>,
  )
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
                user: { id: 'u-1', email: 'max@nord.example.de', name: 'Max Monteur' },
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
  it('is what the server resolved for a role a business gave more to', async () => {
    // No technician is shipped with this right. In this business the role has it.
    tenants = [aTenantChoice(['technician'], { rights: ['customer.write'] })]
    ask('customer.write')

    expect(await screen.findByText('darf')).toBeTruthy()
  })

  it('is what the server resolved for a role a business took something from', async () => {
    // Every owner is shipped with this right. In this business the role lost it.
    tenants = [aTenantChoice(['owner'], { rights: ['customer.read'] })]
    ask('customer.write')

    expect(await screen.findByText('Elektro Nord GmbH: Inhaber')).toBeTruthy()
    expect(screen.getByText('darf nicht')).toBeTruthy()
  })

  it('is asked of the business the session works in, not of another one of the account', async () => {
    tenants = [
      aTenantChoice(['owner'], { id: 't-1', name: 'Elektro Nord GmbH', rights: [] }),
      aTenantChoice(['technician'], {
        id: 't-2',
        name: 'Elektro Süd KG',
        rights: ['customer.write'],
      }),
    ]
    worksIn = 't-2'
    ask('customer.write')

    expect(await screen.findByText('Elektro Süd KG: Monteur')).toBeTruthy()
    expect(screen.getByText('darf')).toBeTruthy()
  })

  /**
   * A role is called what its business calls it. The names come with the
   * list, in the order the business made the roles, and a role of its own has
   * a name like any other.
   */
  it('names the roles as the business names them', async () => {
    tenants = [
      aTenantChoice(['technician', 'bookkeeper'], { roleLabels: ['Monteurin', 'Buchhaltung'] }),
    ]
    ask('customer.write')

    expect(await screen.findByText('Elektro Nord GmbH: Monteurin, Buchhaltung')).toBeTruthy()
  })
})
