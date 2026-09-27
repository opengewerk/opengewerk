import {
  type InstanceTenantView,
  invitationDays,
  type RoleKey,
  type TenantId,
  tenantNameProblem,
} from '@opengewerk/domain'
import { BadRequestException } from '@nestjs/common'
import { sql } from 'drizzle-orm'

import { accountsOf, normalise } from '../authentication/administration.js'
import { mintToken } from '../authentication/invitation.js'
import type { Authentication } from '../authentication/authentication.js'
import { createAccount, grantMembership } from '../authentication/staff.js'
import type { Database, StraddlingTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { invitations } from '../database/schema/index.js'

/**
 * Further businesses on an instance (#142). An owner creates one for himself
 * and is its owner at once; an operator creates one for somebody else, who
 * becomes its owner through an invitation.
 *
 * Both go through `create_tenant` (migration 0051), which is the only way the
 * application creates a business besides the first run setup, and both write
 * the business first and then, inside it, what makes somebody its owner, so
 * that this lands in the new business's own log.
 */

const ownerRoles: readonly RoleKey[] = ['owner']

function checkedName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new BadRequestException('Der Name des Betriebs fehlt.')
  }

  const problem = tenantNameProblem(name)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  return name.trim()
}

async function createTenantRow(tx: StraddlingTransaction['tx'], name: string): Promise<TenantId> {
  const result = await tx.execute(sql`select create_tenant(${name}) as tenant_id`)
  const created = (result.rows[0] as { tenant_id: string } | undefined)?.tenant_id

  if (!created) {
    throw new Error('create_tenant returned no business.')
  }

  return created as TenantId
}

/** A business for the person asking, who is its owner from the first moment. */
export async function createOwnTenant(
  database: Database,
  userId: string,
  name: unknown,
): Promise<{ readonly tenantId: TenantId; readonly name: string }> {
  const checked = checkedName(name)

  const tenantId = await database.forInstanceAndTenant(
    'tenant.create',
    async ({ tx, enter }: StraddlingTransaction) => {
      const created = await createTenantRow(tx, checked)

      await enter(created, userId)
      await grantMembership(tx, { tenantId: created, userId, roles: ownerRoles })

      return created
    },
  )

  return { tenantId, name: checked }
}

/**
 * A business for somebody else, by an operator: the business, and an
 * invitation to be its owner, whose link is handed back once and never stored.
 * The operator is not a member of it and does not become one.
 */
export async function createTenantFor(
  database: Database,
  operator: string,
  wanted: { readonly name: unknown; readonly ownerName: unknown; readonly ownerEmail: unknown },
): Promise<{ readonly tenantId: TenantId; readonly token: string; readonly expiresAt: Date }> {
  const name = checkedName(wanted.name)
  const ownerName = typeof wanted.ownerName === 'string' ? wanted.ownerName.trim() : ''
  const ownerEmail = typeof wanted.ownerEmail === 'string' ? normalise(wanted.ownerEmail) : ''

  if (ownerName === '') {
    throw new BadRequestException('Der Name des Inhabers fehlt.')
  }

  if (!ownerEmail.includes('@')) {
    throw new BadRequestException('Die E-Mail-Adresse des Inhabers sieht nicht wie eine aus.')
  }

  const { token, hash } = mintToken()
  const expiresAt = new Date(Date.now() + invitationDays * 24 * 60 * 60 * 1000)

  const tenantId = await database.forInstanceAndTenant(
    'instance.tenant',
    async ({ tx, enter }: StraddlingTransaction) => {
      const created = await createTenantRow(tx, name)

      // Inside the new business as the operator, so that its log says who
      // made the invitation. No membership comes of it.
      await enter(created, operator)
      await tx.insert(invitations).values({
        id: newId<'invitation'>(),
        tenantId: created,
        email: ownerEmail,
        name: ownerName,
        roles: [...ownerRoles],
        tokenHash: hash,
        invitedBy: operator,
        expiresAt,
      })

      return created
    },
  )

  return { tenantId, token, expiresAt }
}

/**
 * A business with its owner from the command line (#142), for the operator of
 * an instance without a browser at hand: the business, the account when there
 * is none yet, and the owner's membership, in one transaction as the first run
 * setup does it.
 */
export async function createTenantWithOwner(
  authentication: Authentication,
  database: Database,
  wanted: {
    readonly name: string
    readonly ownerEmail: string
    readonly ownerName: string
    readonly password: string
  },
): Promise<{ readonly tenantId: TenantId; readonly created: boolean }> {
  const name = checkedName(wanted.name)
  const context = await authentication.$context

  return database.forInstanceAndTenant(
    'tenant.cli',
    async ({ tx, enter }: StraddlingTransaction) => {
      const tenantId = await createTenantRow(tx, name)
      const { userId, created } = await createAccount(context, tx, {
        email: wanted.ownerEmail,
        name: wanted.ownerName,
        password: wanted.password,
      })

      await enter(tenantId, userId)
      await grantMembership(tx, { tenantId, userId, roles: ownerRoles })

      return { tenantId, created }
    },
  )
}

/** The businesses of the instance for its operators: names, days, owners and counts. */
export async function listInstanceTenants(
  database: Database,
  asUser: string,
): Promise<InstanceTenantView[]> {
  const rows = await database.forInstance(async (tx) => {
    const result = await tx.execute(sql`select * from instance_tenants()`)

    return result.rows as {
      id: string
      name: string
      created_at: string
      owners: string[]
      members: string | number
      invited_owners: string[]
    }[]
  }, asUser)

  const accounts = await accountsOf(
    database,
    [...new Set(rows.flatMap((row) => row.owners))],
    asUser,
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    owners: row.owners.flatMap((owner) => {
      const account = accounts.get(owner)

      return account ? [{ name: account.name, email: account.email }] : []
    }),
    members: Number(row.members),
    invitedOwners: row.invited_owners,
  }))
}
