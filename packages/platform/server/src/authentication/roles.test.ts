import {
  accessRights,
  type RoleDefinition,
  type TenantChoice,
  type TenantId,
} from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../database/identifier.js'
import { tenantRoles } from '../schema.js'
import {
  probeAccess,
  type ProbeFoundation,
  probeFoundation,
  probeIdentities,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
  probeRoles,
  type ProbeVisitors,
  probeVisitors,
} from './probe-application.js'
import { completeRoles, completingRoles, rolesOfTenant, writeRoles } from './roles.js'
import { addStaffMember } from './staff.js'

/**
 * The roles of a tenant as rows (ADR 0010), end to end.
 *
 * What somebody may do is read from the rows of their tenant on every request
 * and from nowhere else. Each check is a way that could quietly fall back to
 * a list in the code: a row that changed and a session that goes on as
 * before, a role a tenant made for itself that gives nothing, a flag that is
 * looked up by the name of a role instead of in its row.
 *
 * The rows are changed here as whoever sets an instance up could change them,
 * as the owner of the tables. No route does that yet, and the application
 * role may not.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

const password = 'ein-ordentlich-langes-passwort'

const lea = { email: 'leitung@nord.example.de', name: 'Lea Leitung' }
const mia = { email: 'mitglied@nord.example.de', name: 'Mia Mitglied' }
const gus = { email: 'gast@nord.example.de', name: 'Gus Gast' }
const sven = { email: 'leitung@sued.example.de', name: 'Sven Süd' }

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let visitors: ProbeVisitors

const userIds = new Map<string, string>()

function http() {
  return instance.http()
}

function idOf(person: { readonly email: string }): string {
  return userIds.get(person.email) as string
}

/** Changes the row of a role, as only the owner of the tables can. */
async function setRole(
  tenantId: TenantId,
  key: string,
  change: { rights?: readonly string[]; leads?: boolean; secondFactor?: boolean },
): Promise<void> {
  const { rowCount } = await admin.query(
    `update tenant_roles
        set rights = coalesce($3, rights),
            leads = coalesce($4, leads),
            second_factor = coalesce($5, second_factor),
            updated_at = now()
      where tenant_id = $1 and key = $2`,
    [
      tenantId,
      key,
      change.rights ? [...change.rights] : null,
      change.leads ?? null,
      change.secondFactor ?? null,
    ],
  )

  expect(rowCount).toBe(1)
}

/** A role a tenant made for itself. */
async function ownRole(
  tenantId: TenantId,
  role: { key: string; label: string; rights: readonly string[]; leads?: boolean },
): Promise<void> {
  await admin.query(
    `insert into tenant_roles (tenant_id, key, label, rights, leads)
     values ($1, $2, $3, $4, $5)`,
    [tenantId, role.key, role.label, [...role.rights], role.leads ?? false],
  )
}

/** What the roles of somebody are set to, past every check of the routes. */
async function setRolesOf(
  tenantId: TenantId,
  person: { readonly email: string },
  roles: readonly string[],
): Promise<void> {
  await admin.query('update memberships set roles = $3 where tenant_id = $1 and user_id = $2', [
    tenantId,
    idOf(person),
    [...roles],
  ])
}

/**
 * What a session carries at this moment, asked where the guard asks: the
 * keys its membership names and the rights they add up to.
 */
async function carriedBy(
  cookies: string,
): Promise<{ roles: readonly string[]; rights: readonly string[] }> {
  const identity = await probeIdentities(instance.authentication, instance.database).identify({
    headers: { cookie: cookies },
  })

  return { roles: identity?.roles ?? [], rights: identity?.rights ?? [] }
}

const reads = (cookies: string) => http().get('/probe/members').set('cookie', cookies)
const writes = (cookies: string) =>
  http().post('/probe/notes').set('cookie', cookies).set('origin', origin)

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl())
  visitors = probeVisitors(instance, password)

  for (const [person, tenantId, roles] of [
    [lea, north.id, ['lead']],
    [mia, north.id, ['member']],
    [gus, north.id, ['guest']],
    [sven, south.id, ['lead']],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId,
      roles: [...roles],
    })

    userIds.set(person.email, userId)
  }

  await visitors.setUpSecondFactor(lea.email)
  await visitors.setUpSecondFactor(sven.email)
})

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('the roles a tenant starts with', () => {
  it('are rows of the tenant, in the order the application lists them', async () => {
    const held = await instance.database.forTenant({ tenantId: north.id }, (tx) =>
      rolesOfTenant(tx, north.id),
    )

    expect(held).toEqual(probeRoles)
  })

  /**
   * What a tenant starts with is written once. Written again, the rows stay
   * as they are, with whatever the tenant has made of them since.
   */
  it('are written once and never corrected', async () => {
    await setRole(north.id, 'guest', { rights: ['members.read', 'notes.write'] })

    await instance.database.forTenant({ tenantId: north.id, reason: 'setup' }, (tx) =>
      writeRoles(tx, north.id, probeRoles),
    )

    const held = await instance.database.forTenant({ tenantId: north.id }, (tx) =>
      rolesOfTenant(tx, north.id),
    )

    expect(held.map((role) => role.key)).toEqual(['lead', 'member', 'guest'])
    expect(held.find((role) => role.key === 'guest')?.rights).toEqual([
      'members.read',
      'notes.write',
    ])

    await setRole(north.id, 'guest', { rights: ['members.read'] })
  })

  it('stay inside their tenant', async () => {
    await ownRole(south.id, { key: 'porter', label: 'Pforte', rights: ['members.read'] })

    const seen = await instance.database.forTenant({ tenantId: north.id }, (tx) =>
      tx.select({ tenantId: tenantRoles.tenantId, key: tenantRoles.key }).from(tenantRoles),
    )

    expect(new Set(seen.map((row) => row.tenantId))).toEqual(new Set([north.id]))
    expect(seen.map((row) => row.key)).not.toContain('porter')

    // And nothing at all outside any tenant.
    const outside = await instance.database.forInstance((tx) =>
      tx.select({ key: tenantRoles.key }).from(tenantRoles),
    )

    expect(outside).toEqual([])
  })

  /**
   * Nothing changes or removes a role yet, so the application may not. A
   * request that found a way to say otherwise is stopped by the grant.
   */
  it('cannot be changed or removed by the application', async () => {
    const inNorth = { tenantId: north.id, reason: 'membership.write' }
    const guest = and(eq(tenantRoles.tenantId, north.id), eq(tenantRoles.key, 'guest'))

    await expect(
      instance.database.forTenant(inNorth, (tx) =>
        tx
          .update(tenantRoles)
          .set({ rights: [accessRights.write] })
          .where(guest),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })

    await expect(
      instance.database.forTenant(inNorth, (tx) => tx.delete(tenantRoles).where(guest)),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })

  it('are in the log of the tenant from the first row on', async () => {
    const { rows } = await admin.query<{ field: string; new_value: string | null }>(
      `select field, new_value from audit_entries
        where tenant_id = $1 and table_name = 'tenant_roles' and operation = 'insert'
          and field in ('key', 'rights')
        order by sequence`,
      [north.id],
    )

    expect(rows.filter((row) => row.field === 'key').map((row) => row.new_value)).toEqual([
      'lead',
      'member',
      'guest',
    ])
    expect(rows.filter((row) => row.field === 'rights')).toHaveLength(3)
  })
})

describe('what somebody may do', () => {
  /**
   * At the next request, on the session that is already open: the rows are
   * read every time, like the membership.
   */
  it('is what the rows of their roles say at this moment', async () => {
    const asGus = await visitors.workIn(gus.email, north.id)

    await reads(asGus).expect(200)
    await writes(asGus).expect(403)

    await setRole(north.id, 'guest', { rights: ['members.read', 'notes.write'] })
    await writes(asGus).expect(201)

    await setRole(north.id, 'guest', { rights: [] })
    await writes(asGus).expect(403)

    const refused = await reads(asGus).expect(403)
    expect(refused.body.message).toBe('Das Recht members.read fehlt diesem Zugang.')

    await setRole(north.id, 'guest', { rights: ['members.read'] })
    await reads(asGus).expect(200)
  })

  /**
   * A role is what the tenant has a row for. One it made for itself is handed
   * out and gives what its row says; the tenant next door does not have it.
   */
  it('follows a role the tenant made for itself, and only in that tenant', async () => {
    await ownRole(north.id, { key: 'scribe', label: 'Schreibkraft', rights: ['notes.write'] })

    const asLea = await visitors.workIn(lea.email, north.id)
    const asGus = await visitors.workIn(gus.email, north.id)

    await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', asLea)
      .set('origin', origin)
      .send({ roles: ['guest', 'scribe'] })
      .expect(200)

    await writes(asGus).expect(201)
    await reads(asGus).expect(200)
    expect(await carriedBy(asGus)).toEqual({
      roles: ['guest', 'scribe'],
      rights: ['members.read', 'notes.write'],
    })

    // The south has no such role, so nobody there is given it.
    const asSven = await visitors.workIn(sven.email, south.id)
    const refused = await http()
      .patch(`/staff/${idOf(sven)}`)
      .set('cookie', asSven)
      .set('origin', origin)
      .send({ roles: ['lead', 'scribe'] })
      .expect(400)

    expect(refused.body.message).toBe(
      'Unbekannte Rollen: scribe. Es gibt lead, member, guest, porter.',
    )

    await http()
      .patch(`/staff/${idOf(gus)}`)
      .set('cookie', asLea)
      .set('origin', origin)
      .send({ roles: ['guest'] })
      .expect(200)
  })

  /**
   * A key without a row is not a role. Somebody whose membership names only
   * such a key still signs in and still chooses the tenant, and then holds no
   * right in it.
   */
  it('is nothing for a key the tenant has no row for', async () => {
    await setRolesOf(north.id, gus, ['ghost'])

    const asGus = await visitors.workIn(gus.email, north.id)

    await reads(asGus).expect(403)
    await writes(asGus).expect(403)
    // The key is still what the membership names; it just gives nothing.
    expect(await carriedBy(asGus)).toEqual({ roles: ['ghost'], rights: [] })

    await setRolesOf(north.id, gus, ['guest'])
    await reads(asGus).expect(200)
  })

  /**
   * A row can hold a right this version does not know, written by a newer
   * one or left by an older. It gives nothing and breaks nothing.
   */
  it('leaves out a right the catalogue of the application does not know', async () => {
    await setRole(north.id, 'guest', { rights: ['members.read', 'shelf.burn'] })

    const asGus = await visitors.workIn(gus.email, north.id)

    await reads(asGus).expect(200)
    await writes(asGus).expect(403)
    expect((await carriedBy(asGus)).rights).toEqual(['members.read'])

    await setRole(north.id, 'guest', { rights: ['members.read'] })
  })

  /**
   * The second factor hangs on the flag of the role and not on its name: a
   * role that is given the flag asks for one from the next request on, and a
   * role that loses it stops asking.
   */
  it('asks for a second factor where the row of a role says so', async () => {
    const asMia = await visitors.workIn(mia.email, north.id)

    await reads(asMia).expect(200)

    await setRole(north.id, 'member', { secondFactor: true })

    const stopped = await reads(asMia).expect(403)
    expect(stopped.body.message).toContain('zweiter Faktor')

    await setRole(north.id, 'member', { secondFactor: false })
    await reads(asMia).expect(200)
  })
})

describe('whoever leads a tenant', () => {
  /**
   * What keeps a tenant from locking itself out by editing the one role that
   * could let it back in: leading is a flag of the role and brings the
   * administration with it, whatever rights the row holds.
   */
  it('administers who works in it, whatever the rights of the role say', async () => {
    const asLea = await visitors.workIn(lea.email, north.id)

    await setRole(north.id, 'lead', { rights: ['members.read'] })

    await http().get('/staff').set('cookie', asLea).expect(200)
    await writes(asLea).expect(403)
    // In the order of the catalogue: the two of the administration, which the
    // row no longer names, and the one it does.
    expect((await carriedBy(asLea)).rights).toEqual([
      accessRights.read,
      accessRights.write,
      'members.read',
    ])

    await setRole(north.id, 'lead', { rights: probeRoles[0]?.rights ?? [] })
    await writes(asLea).expect(201)
  })

  it('and nobody else does, whatever their role is called', async () => {
    const asMia = await visitors.workIn(mia.email, north.id)

    await http().get('/staff').set('cookie', asMia).expect(403)
  })

  /**
   * The last one who leads is found by the flag in the rows, not by the name
   * of a role in the code. With somebody in a role of the tenant's own that
   * leads, the one in the shipped role may go; with nobody, they may not.
   */
  it('is counted by the flag of the role, in a role of the tenant itself as well', async () => {
    const asLea = await visitors.workIn(lea.email, north.id)
    const dropLead = () =>
      http()
        .patch(`/staff/${idOf(lea)}`)
        .set('cookie', asLea)
        .set('origin', origin)
        .send({ roles: ['member'] })

    const refused = await dropLead().expect(409)
    expect(refused.body.message).toBe(probeAccess.sentences.lastLead)

    await ownRole(north.id, { key: 'chief', label: 'Vorstand', rights: [], leads: true })
    await http()
      .patch(`/staff/${idOf(mia)}`)
      .set('cookie', asLea)
      .set('origin', origin)
      .send({ roles: ['member', 'chief'] })
      .expect(200)

    // Mia leads now, through a role that holds no right of its own.
    await dropLead().expect(200)

    const asMia = await visitors.workIn(mia.email, north.id)
    await http().get('/staff').set('cookie', asMia).expect(200)

    // And she is the last one, so she keeps the role and is not shut out.
    const last = await http()
      .patch(`/staff/${idOf(mia)}`)
      .set('cookie', asMia)
      .set('origin', origin)
      .send({ roles: ['member'] })
      .expect(409)
    expect(last.body.message).toBe(probeAccess.sentences.lastLead)

    await http()
      .put(`/staff/${idOf(mia)}/block`)
      .set('cookie', asMia)
      .set('origin', origin)
      .expect(409)

    // Back: Lea leads again, Mia works here.
    await http()
      .patch(`/staff/${idOf(lea)}`)
      .set('cookie', asMia)
      .set('origin', origin)
      .send({ roles: ['lead'] })
      .expect(200)
    await http()
      .patch(`/staff/${idOf(mia)}`)
      .set('cookie', asLea)
      .set('origin', origin)
      .send({ roles: ['member'] })
      .expect(200)
  })
})

describe('what a screen is told', () => {
  /** The tenants somebody may work in, as the route before the choice answers. */
  async function choicesOf(cookies: string): Promise<Record<string, TenantChoice>> {
    const answer = await http().get('/auth/tenants').set('cookie', cookies).expect(200)

    return Object.fromEntries((answer.body as TenantChoice[]).map((choice) => [choice.id, choice]))
  }

  /**
   * The list of somebody's tenants carries what their roles add up to in
   * each, resolved from the rows of that tenant. A screen decides by it what
   * to offer, so it has to be the same answer the guard gives, and it has to
   * be there before a tenant is chosen: it is what the chooser shows.
   */
  it('is, for each tenant, what the rows of that tenant say', async () => {
    // Gus looks on in the north and keeps the door in the south, in a role
    // only the south has.
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      south.id,
      idOf(gus),
      ['porter'],
    ])
    await setRole(south.id, 'porter', { rights: ['members.read', 'notes.write'] })

    const asGus = await visitors.signIn(gus.email)

    expect(await choicesOf(asGus)).toEqual({
      [north.id]: {
        id: north.id,
        name: north.name,
        roles: ['guest'],
        roleLabels: ['Gast'],
        rights: ['members.read'],
        secondFactor: false,
      },
      [south.id]: {
        id: south.id,
        name: south.name,
        roles: ['porter'],
        roleLabels: ['Pforte'],
        rights: ['members.read', 'notes.write'],
        secondFactor: false,
      },
    })
  })

  /**
   * At the next question, like the identity of a request. A right the
   * catalogue does not know is left out here as well, and a second factor a
   * role asks for is said: this route answers without one, which is what
   * leads a screen to the setup instead of into a wall.
   */
  it('follows the rows at the next question', async () => {
    const asGus = await visitors.signIn(gus.email)

    await setRole(north.id, 'guest', {
      rights: ['members.read', 'notes.write', 'shelf.burn'],
      secondFactor: true,
    })

    expect((await choicesOf(asGus))[north.id]).toMatchObject({
      rights: ['members.read', 'notes.write'],
      secondFactor: true,
    })

    await setRole(north.id, 'guest', { rights: ['members.read'], secondFactor: false })

    expect((await choicesOf(asGus))[north.id]).toMatchObject({
      rights: ['members.read'],
      secondFactor: false,
    })
  })

  /**
   * The keys as the membership names them, the names in the order the tenant
   * made the roles, and nothing for a key without a row.
   */
  it('names the roles the tenant has a row for, and no other', async () => {
    await setRolesOf(north.id, gus, ['ghost', 'scribe', 'guest', 'member'])

    const asGus = await visitors.signIn(gus.email)

    expect((await choicesOf(asGus))[north.id]).toMatchObject({
      roles: ['ghost', 'scribe', 'guest', 'member'],
      // Not the order of the keys in the membership, and not the alphabet.
      roleLabels: ['Mitglied', 'Gast', 'Schreibkraft'],
      rights: ['members.read', 'notes.write'],
    })

    await setRolesOf(north.id, gus, ['guest'])
  })

  it('counts the administration among the rights of whoever leads', async () => {
    await setRole(north.id, 'lead', { rights: ['members.read'] })

    const asLea = await visitors.signIn(lea.email)
    const inNorth = (await choicesOf(asLea))[north.id]

    expect(inNorth?.rights).toEqual([accessRights.read, accessRights.write, 'members.read'])
    expect(inNorth?.secondFactor).toBe(true)

    await setRole(north.id, 'lead', { rights: probeRoles[0]?.rights ?? [] })
  })

  /**
   * The point of the whole answer: what a screen is told is what the guard
   * then decides by, in whichever tenant the session works.
   */
  it('is what the identity of a request carries, in each tenant', async () => {
    const asGus = await visitors.workIn(gus.email, north.id)
    const choices = await choicesOf(asGus)

    expect(choices[north.id]?.rights).toEqual((await carriedBy(asGus)).rights)

    await instance.chooseTenant(asGus, south.id)

    expect(choices[south.id]?.rights).toEqual((await carriedBy(asGus)).rights)
    // And the two differ, so the comparison says something.
    expect(choices[south.id]?.rights).not.toEqual(choices[north.id]?.rights)
  })
})

describe('the roles a tenant has', () => {
  async function listedFor(cookies: string): Promise<RoleDefinition[]> {
    const answer = await http().get('/staff/roles').set('cookie', cookies).expect(200)

    return answer.body as RoleDefinition[]
  }

  /**
   * What a screen offers when somebody is invited or given a role. From the
   * rows, the roles the tenant made for itself included, because those are
   * the roles the routes beside this one accept.
   */
  it('are listed for whoever administers it, in the order it made them', async () => {
    const asLea = await visitors.workIn(lea.email, north.id)
    const listed = await listedFor(asLea)

    expect(listed.map((role) => role.key)).toEqual(['lead', 'member', 'guest', 'scribe', 'chief'])
    expect(listed[0]).toEqual(probeRoles[0])
    expect(listed[3]).toEqual({
      key: 'scribe',
      label: 'Schreibkraft',
      rights: ['notes.write'],
      leads: false,
      secondFactor: false,
    })
    expect(listed[4]).toMatchObject({ key: 'chief', leads: true })
  })

  it('and for nobody else, nor from the tenant next door', async () => {
    const asMia = await visitors.workIn(mia.email, north.id)

    await http().get('/staff/roles').set('cookie', asMia).expect(403)

    const asSven = await visitors.workIn(sven.email, south.id)

    expect((await listedFor(asSven)).map((role) => role.key)).toEqual([
      'lead',
      'member',
      'guest',
      'porter',
    ])
  })
})

describe('a tenant that something else made', () => {
  /**
   * The version before the roles were rows goes on running between the
   * migration and the start of this one. A tenant it creates in that moment
   * has a row, somebody who leads it, and no role: nobody in it holds a right,
   * and nobody can be given one.
   */
  it('gets the roles a tenant starts with when the instance starts, once', async () => {
    const west = { id: newId<'tenant'>(), name: 'Mandant West' }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [west.id, west.name])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      west.id,
      idOf(lea),
      ['lead'],
    ])

    const asLea = await visitors.workIn(lea.email, west.id)

    await http().get('/staff').set('cookie', asLea).expect(403)

    expect(await completeRoles(instance.database, probeAccess)).toEqual([west.id])

    const held = await instance.database.forTenant({ tenantId: west.id }, (tx) =>
      rolesOfTenant(tx, west.id),
    )

    expect(held).toEqual(probeRoles)

    // In the log of the tenant as what it was.
    const { rows } = await admin.query<{ reason: string | null }>(
      `select distinct reason from audit_entries
        where tenant_id = $1 and table_name = 'tenant_roles'`,
      [west.id],
    )

    expect(rows).toEqual([{ reason: completingRoles }])

    // Lea leads it now, on the session she had, and nobody went to a prompt.
    await http().get('/staff').set('cookie', asLea).expect(200)

    // Asked again, there is nothing left to do.
    expect(await completeRoles(instance.database, probeAccess)).toEqual([])
  })

  /**
   * Only a tenant with no role at all. One that has roles has what it made
   * of them, and a shipped role that is gone there is gone on purpose.
   */
  it('leaves a tenant that has roles as it is, a shipped one that is gone included', async () => {
    await admin.query(`delete from tenant_roles where tenant_id = $1 and key = 'guest'`, [south.id])

    expect(await completeRoles(instance.database, probeAccess)).toEqual([])

    const held = await instance.database.forTenant({ tenantId: south.id }, (tx) =>
      rolesOfTenant(tx, south.id),
    )

    expect(held.map((role) => role.key)).toEqual(['lead', 'member', 'porter'])
  })
})

describe('a tenant that comes into being with the first run', () => {
  /**
   * The first run writes the roles in the transaction that makes the tenant.
   * There is no moment with a tenant and no roles, in which the one who set
   * it up could do nothing in it.
   */
  it('has its roles before its first account works in it', async () => {
    await foundation.empty(admin)

    const fresh = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
      setupCode: 'ABCD-EFGH',
    })

    try {
      const created = await fresh
        .http()
        .post('/setup')
        .set('origin', origin)
        .send({
          setupCode: 'ABCD-EFGH',
          company: 'Mandant Neu',
          name: 'Nora Neu',
          email: 'nora@example.de',
          password,
        })
        .expect(201)

      const tenantId = created.body.tenantId as TenantId
      const held = await fresh.database.forTenant({ tenantId }, (tx) => rolesOfTenant(tx, tenantId))

      expect(held).toEqual(probeRoles)

      const { rows } = await admin.query<{ roles: string[] }>(
        'select roles from memberships where tenant_id = $1',
        [tenantId],
      )

      // The first of the shipped roles that leads, and nothing else.
      expect(rows).toEqual([{ roles: ['lead'] }])
    } finally {
      await fresh.close()
    }
  })
})
