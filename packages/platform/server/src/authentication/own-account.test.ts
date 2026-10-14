import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { newId } from '../database/identifier.js'
import { authenticationPath } from './authentication.js'
import {
  cookiesOf,
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
} from './probe-application.js'
import { addStaffMember } from './staff.js'

/**
 * Name and address of one's own account, under "Konto"
 * (opengewerk-haustechnik#128): changed only after confirming again with the
 * password, written into the log of every tenant the account works in, and a
 * link to a new password ends with the address it went to.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

const password = 'ein-ordentlich-langes-passwort'

/** In both tenants: an account nobody but the person corrects. */
const both = { email: 'beide@example.de', name: 'Bea Beide' }
/** Somebody else, whose address the first may not take. */
const other = { email: 'andere@example.de', name: 'Anna Andere' }

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
const userIds = new Map<string, string>()

function http() {
  return instance.http()
}

function idOf(person: { readonly email: string }): string {
  return userIds.get(person.email) ?? ''
}

async function signIn(email: string): Promise<string> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password })
    .expect(200)

  return cookiesOf(answer)
}

function reconfirm(cookies: string) {
  return http()
    .post(`${authenticationPath}/reconfirm`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ password })
    .expect(200)
}

function change(cookies: string, body: object) {
  return http().patch('/auth/account').set('cookie', cookies).set('origin', origin).send(body)
}

async function accountOf(userId: string): Promise<{ name: string; email: string }> {
  const { rows } = await admin.query<{ name: string; email: string }>(
    'select name, email from auth_users where id = $1',
    [userId],
  )

  return rows[0] as { name: string; email: string }
}

/** What the log of a tenant says about the corrections of an account, with the reason. */
async function logged(
  tenantId: TenantId,
  field: string,
): Promise<{ new_value: string | null; reason: string | null }[]> {
  const { rows } = await admin.query<{ new_value: string | null; reason: string | null }>(
    `select new_value, reason
       from audit_entries
      where tenant_id = $1 and table_name = 'account_corrections' and field = $2
      order by sequence`,
    [tenantId, field],
  )

  return rows
}

async function openResetsOf(userId: string): Promise<number> {
  const { rows } = await admin.query<{ count: number }>(
    `select count(*)::int as count from auth_verifications
      where value = $1 and identifier like 'reset-password:%'`,
    [userId],
  )

  return rows[0]?.count ?? 0
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north, south])
  instance = await probeInstance(foundation.kit.applicationDatabaseUrl())

  for (const [person, tenantId] of [
    [both, north.id],
    [both, south.id],
    [other, north.id],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId,
      roles: ['member'],
    })

    userIds.set(person.email, userId)
  }
})

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('changing the own account', () => {
  it('is refused without confirming again, and changes nothing', async () => {
    const cookies = await signIn(both.email)

    const refused = await change(cookies, { name: 'Bea Ohne-Bestätigung' }).expect(403)

    expect((refused.body as { message: string }).message).toBe(
      'Eigene Angaben ändern sich erst nach der Bestätigung mit Passwort und Code.',
    )
    expect(await accountOf(idOf(both))).toEqual({ name: both.name, email: both.email })
    expect(await logged(north.id, 'name_after')).toEqual([])
  })

  it('works after confirming, and goes into the log of every tenant of the account', async () => {
    const cookies = await signIn(both.email)

    await reconfirm(cookies)
    const changed = await change(cookies, {
      name: '  Bea Neuname  ',
      email: ' Bea.Neu@Example.de ',
    }).expect(200)

    expect(changed.body).toEqual({ name: 'Bea Neuname', email: 'bea.neu@example.de' })
    expect(await accountOf(idOf(both))).toEqual({
      name: 'Bea Neuname',
      email: 'bea.neu@example.de',
    })

    // In both tenants, as the person, with the reason of the route.
    for (const tenantId of [north.id, south.id]) {
      expect(await logged(tenantId, 'name_after')).toEqual([
        { new_value: 'Bea Neuname', reason: 'account.own' },
      ])
      expect(await logged(tenantId, 'email_after')).toEqual([
        { new_value: 'bea.neu@example.de', reason: 'account.own' },
      ])
    }

    // And the confirmation is spent: the next change needs the password again.
    await change(cookies, { name: 'Bea Zweimal' }).expect(403)
    expect((await accountOf(idOf(both))).name).toBe('Bea Neuname')
  })

  it('needs no confirmation for what changes nothing, and writes no entry', async () => {
    const cookies = await signIn('bea.neu@example.de')
    const before = await logged(north.id, 'name_after')

    await change(cookies, { name: 'Bea Neuname' }).expect(200)

    expect(await logged(north.id, 'name_after')).toEqual(before)
  })

  it('refuses the address of another account and keeps its own', async () => {
    const cookies = await signIn(other.email)

    await reconfirm(cookies)
    const refused = await change(cookies, { email: 'bea.neu@example.de' }).expect(409)

    expect((refused.body as { message: string }).message).toBe(
      'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.',
    )
    expect(await accountOf(idOf(other))).toEqual({ name: other.name, email: other.email })
    expect(await logged(north.id, 'email_before')).not.toContainEqual(
      expect.objectContaining({ new_value: other.email }),
    )
  })

  it('takes no empty name and no address without an at sign', async () => {
    const cookies = await signIn(other.email)

    await reconfirm(cookies)
    await change(cookies, { name: '   ' }).expect(400)
    await change(cookies, { email: 'keine-adresse' }).expect(400)
    await change(cookies, {}).expect(400)
    await change(cookies, { name: 7 }).expect(400)

    // Refused before the confirmation was looked at, so it still holds.
    await change(cookies, { name: 'Anna Anders' }).expect(200)
    expect((await accountOf(idOf(other))).name).toBe('Anna Anders')
  })

  it('ends a link to a new password with the address it went to, and not with a name', async () => {
    await http()
      .post(`${authenticationPath}/request-password-reset`)
      .set('origin', origin)
      .send({ email: other.email })
      .expect(200)
    await vi.waitFor(async () => {
      expect(await openResetsOf(idOf(other))).toBe(1)
    })

    const cookies = await signIn(other.email)

    await reconfirm(cookies)
    await change(cookies, { name: 'Anna Nochmal' }).expect(200)
    expect(await openResetsOf(idOf(other))).toBe(1)

    await reconfirm(cookies)
    await change(cookies, { email: 'anna.neu@example.de' }).expect(200)
    expect(await openResetsOf(idOf(other))).toBe(0)
  })

  it('cannot be reached without a session', async () => {
    await change('', { name: 'Niemand' }).expect(401)
  })
})
