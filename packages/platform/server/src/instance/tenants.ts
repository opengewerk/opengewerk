import { BadRequestException } from '@nestjs/common'
import { type InstanceTenantView, invitationDays, type TenantId } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'

import type { AccessRules } from '../authentication/access.js'
import { accountsOf, normalise } from '../authentication/administration.js'
import type { Authentication } from '../authentication/authentication.js'
import { mintToken } from '../authentication/invitation.js'
import { firstRoleOf, writeRoles } from '../authentication/roles.js'
import { createAccount, grantMembership } from '../authentication/staff.js'
import type { Database, StraddlingTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { invitations } from '../schema.js'

/**
 * Further tenants on an instance (#142). Somebody who leads a tenant creates
 * one for themselves and leads it at once; whoever runs the instance creates
 * one for somebody else, who comes to lead it through an invitation.
 *
 * Both go through `create_tenant` (the block `instance.sql`), which is the
 * only way an application creates a tenant besides the first run setup, and
 * both write the tenant first and then, inside it, the roles it starts with
 * and what makes somebody lead it, so that this lands in the new tenant's own
 * log.
 *
 * Which role leads, which roles a tenant starts with and what its name has to
 * be is the application's to say (`AccessRules`), here as at the first run.
 */

/** What these functions need to be told by the application. */
export type TenantRules = Pick<AccessRules, 'shippedRoles' | 'tenantNameProblem' | 'sentences'>

function checkedName(access: TenantRules, name: unknown): string {
  if (typeof name !== 'string') {
    throw new BadRequestException(access.sentences.instance.tenantNameMissing)
  }

  // The rule of the first run and of whatever changes the name later, so that
  // no name comes in through this door that the others would refuse (#276).
  const problem = access.tenantNameProblem(name)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  return name.trim()
}

async function createTenantRow(tx: StraddlingTransaction['tx'], name: string): Promise<TenantId> {
  const result = await tx.execute(sql`select create_tenant(${name}) as tenant_id`)
  const created = (result.rows[0] as { tenant_id: string } | undefined)?.tenant_id

  if (!created) {
    throw new Error('create_tenant returned no tenant.')
  }

  return created as TenantId
}

/**
 * The step into a tenant that was just created, and the roles it starts with.
 * One function for every way a further tenant comes into being, so that none
 * of them leaves one without its roles: in such a tenant nobody would hold a
 * single right, whoever leads it included.
 */
async function enterNew(
  access: TenantRules,
  { tx, enter }: StraddlingTransaction,
  tenantId: TenantId,
  userId: string,
): Promise<void> {
  await enter(tenantId, userId)
  await writeRoles(tx, tenantId, access.shippedRoles)
}

/** A tenant for the person asking, who leads it from the first moment. */
export async function createOwnTenant(
  database: Database,
  access: TenantRules,
  userId: string,
  name: unknown,
): Promise<{ readonly tenantId: TenantId; readonly name: string }> {
  const checked = checkedName(access, name)

  const tenantId = await database.forInstanceAndTenant(
    'tenant.create',
    async (straddling: StraddlingTransaction) => {
      const { tx } = straddling
      const created = await createTenantRow(tx, checked)

      await enterNew(access, straddling, created, userId)
      await grantMembership(tx, { tenantId: created, userId, roles: [firstRoleOf(access).key] })

      return created
    },
    userId,
  )

  return { tenantId, name: checked }
}

/**
 * A tenant for somebody else, by whoever runs the instance: the tenant, and
 * an invitation to lead it, whose link is handed back once and never stored.
 * The one who creates it is not a member of it and does not become one.
 */
export async function createTenantFor(
  database: Database,
  access: TenantRules,
  operator: string,
  wanted: { readonly name: unknown; readonly leadName: unknown; readonly leadEmail: unknown },
): Promise<{ readonly tenantId: TenantId; readonly token: string; readonly expiresAt: Date }> {
  const name = checkedName(access, wanted.name)
  const leadName = typeof wanted.leadName === 'string' ? wanted.leadName.trim() : ''
  const leadEmail = typeof wanted.leadEmail === 'string' ? normalise(wanted.leadEmail) : ''

  if (leadName === '') {
    throw new BadRequestException(access.sentences.instance.leadNameMissing)
  }

  if (!leadEmail.includes('@')) {
    throw new BadRequestException(access.sentences.instance.leadEmailNotOne)
  }

  const { token, hash } = mintToken()
  const expiresAt = new Date(Date.now() + invitationDays * 24 * 60 * 60 * 1000)

  const tenantId = await database.forInstanceAndTenant(
    'instance.tenant',
    async (straddling: StraddlingTransaction) => {
      const { tx } = straddling
      const created = await createTenantRow(tx, name)

      // Inside the new tenant as the one who creates it, so that its log says
      // who made the invitation. No membership comes of it.
      await enterNew(access, straddling, created, operator)
      await tx.insert(invitations).values({
        id: newId<'invitation'>(),
        tenantId: created,
        email: leadEmail,
        name: leadName,
        roles: [firstRoleOf(access).key],
        tokenHash: hash,
        invitedBy: operator,
        expiresAt,
      })

      return created
    },
    operator,
  )

  return { tenantId, token, expiresAt }
}

/**
 * A tenant with whoever leads it, from the command line (#142), for an
 * instance without a browser at hand: the tenant, the account when there is
 * none yet, and the membership that leads, in one transaction as the first
 * run setup does it.
 */
export async function createTenantWithLead(
  authentication: Authentication,
  database: Database,
  access: TenantRules,
  wanted: {
    readonly name: string
    readonly leadEmail: string
    readonly leadName: string
    readonly password: string
  },
): Promise<{ readonly tenantId: TenantId; readonly created: boolean }> {
  const name = checkedName(access, wanted.name)
  const context = await authentication.$context

  return database.forInstanceAndTenant('tenant.cli', async (straddling: StraddlingTransaction) => {
    const { tx } = straddling
    const tenantId = await createTenantRow(tx, name)
    const { userId, created } = await createAccount(context, tx, {
      email: wanted.leadEmail,
      name: wanted.leadName,
      password: wanted.password,
    })

    await enterNew(access, straddling, tenantId, userId)
    await grantMembership(tx, { tenantId, userId, roles: [firstRoleOf(access).key] })

    return { tenantId, created }
  })
}

/** The tenants of the instance for whoever runs it: names, days, who leads and counts. */
export async function listInstanceTenants(
  database: Database,
  asUser: string,
): Promise<InstanceTenantView[]> {
  const rows = await database.forInstance(async (tx) => {
    const result = await tx.execute(sql`select * from tenants_with_leads()`)

    return result.rows as {
      id: string
      name: string
      created_at: string
      leads: string[]
      members: string | number
      invited_leads: string[]
    }[]
  }, asUser)

  const accounts = await accountsOf(
    database,
    [...new Set(rows.flatMap((row) => row.leads))],
    asUser,
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    leads: row.leads.flatMap((lead) => {
      const account = accounts.get(lead)

      return account ? [{ name: account.name, email: account.email }] : []
    }),
    members: Number(row.members),
    invitedLeads: row.invited_leads,
  }))
}
