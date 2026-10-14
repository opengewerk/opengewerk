import { BadRequestException } from '@nestjs/common'
import type { InvitationId, TenantIdentity } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { TenantTransaction } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { tableFileOf } from '../tables/read.js'
import type { MembershipAdditions } from './access.js'
import {
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
  type ProbeVisitors,
  probeVisitors,
} from './probe-application.js'
import { addStaffMember } from './staff.js'

/**
 * What an application keeps beside a membership (`MembershipAdditions`): the
 * foundation hands it what an invitation or a change of roles said, inside
 * the transaction that writes its own row, and takes everything back when
 * the application refuses.
 *
 * The probe application keeps nothing and writes down that it was asked, and
 * as whom: what is measured here is the seam, not what an application does
 * behind it.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }

const password = 'ein-ordentlich-langes-passwort'

const lea = { email: 'leitung@nord.example.de', name: 'Lea Leitung' }
const mia = { email: 'mitglied@nord.example.de', name: 'Mia Mitglied' }

interface Asked {
  readonly what: 'invited' | 'joined' | 'offered' | 'changed'
  /** The tenant and the person of the transaction the application was called in. */
  readonly inTenant: string
  readonly asUser: string
  readonly about: Readonly<Record<string, unknown>>
  readonly said?: unknown
}

/** What the application was asked, and what it answers the next time. */
const asked: Asked[] = []
let refusal: Error | null = null

/** Who the transaction says is working, which is what the policies read. */
async function workingAs(tx: TenantTransaction): Promise<{ inTenant: string; asUser: string }> {
  const { rows } = await tx.execute<{ tenant: string; person: string }>(
    sql`select current_setting('app.tenant_id', true) as tenant, current_setting('app.user_id', true) as person`,
  )

  return { inTenant: rows[0]?.tenant ?? '', asUser: rows[0]?.person ?? '' }
}

function answer(): void {
  if (refusal) {
    throw refusal
  }
}

const additions: MembershipAdditions = {
  async invited(tx, invitation, said) {
    asked.push({ what: 'invited', ...(await workingAs(tx)), about: invitation, said })
    answer()
  },
  async joined(tx, membership) {
    asked.push({ what: 'joined', ...(await workingAs(tx)), about: membership })
    answer()
  },
  async offered(tx, invitation) {
    asked.push({ what: 'offered', ...(await workingAs(tx)), about: invitation })

    return 'am Regal West'
  },
  async changed(tx, membership, said) {
    asked.push({ what: 'changed', ...(await workingAs(tx)), about: membership, said })
    answer()
  },
  inTable: {
    title: 'Regale',
    async cells(tx, tenantId, userIds) {
      const { inTenant, asUser } = await workingAs(tx)

      return new Map([
        [
          miaId,
          `Regal West, gefragt von ${asUser === leaId ? 'Lea' : asUser} in ${inTenant === north.id && tenantId === north.id ? 'Nord' : inTenant}, ${String(userIds.length)} Personen`,
        ],
      ])
    },
  },
}

/** What stands in for the part of an application that sends an invitation by mail. */
const handed: InvitationId[] = []
const mailing = {
  sender: {
    ready: () => Promise.resolve(),
    send: (_identity: TenantIdentity, invitationId: InvitationId) => {
      handed.push(invitationId)

      return Promise.resolve()
    },
  },
  mailsOf: () => Promise.resolve(new Map()),
}

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let visitors: ProbeVisitors
let leaId = ''
let miaId = ''

function http() {
  return instance.http()
}

async function asLea(): Promise<string> {
  return visitors.workIn(lea.email, north.id)
}

/** The open invitations for an address. */
async function openFor(email: string): Promise<number> {
  const { rows } = await admin.query<{ open: number }>(
    `select count(*)::int as open from invitations
      where email = $1 and redeemed_at is null and revoked_at is null`,
    [email],
  )

  return rows[0]?.open ?? 0
}

async function rolesOf(userId: string): Promise<readonly string[]> {
  const { rows } = await admin.query<{ roles: string[] }>(
    'select roles from memberships where tenant_id = $1 and user_id = $2',
    [north.id, userId],
  )

  return rows[0]?.roles ?? []
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north])

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
    additions,
    invitationMailing: mailing,
  })
  visitors = probeVisitors(instance, password)

  for (const [person, roles] of [
    [lea, ['lead']],
    [mia, ['member']],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId: north.id,
      roles: [...roles],
    })

    if (person === lea) {
      leaId = userId
    } else {
      miaId = userId
    }
  }

  await visitors.setUpSecondFactor(lea.email)
})

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

beforeEach(() => {
  asked.length = 0
  handed.length = 0
  refusal = null
})

describe('what an application keeps beside a membership', () => {
  it('is handed what an invitation said, in the tenant and as whoever invited', async () => {
    const invited = await http()
      .post('/staff')
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({
        email: 'nele@nord.example.de',
        name: 'Nele Neu',
        roles: ['member'],
        additions: { shelf: 'A3' },
      })
      .expect(201)

    const { rows } = await admin.query<{ id: string }>(
      `select id from invitations where email = 'nele@nord.example.de'`,
    )

    expect(asked).toEqual([
      {
        what: 'invited',
        inTenant: north.id,
        asUser: leaId,
        about: { tenantId: north.id, invitationId: rows[0]?.id, roles: ['member'] },
        said: { shelf: 'A3' },
      },
    ])
    expect(invited.body.token).toHaveLength(43)
  })

  it('is asked about an invitation that says nothing of it, with nothing', async () => {
    await http()
      .post('/staff')
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({ email: 'ohne@nord.example.de', name: 'Otto Ohne', roles: ['guest'] })
      .expect(201)

    expect(asked.map(({ what, said }) => [what, said])).toEqual([['invited', undefined]])
  })

  it('takes the invitation back with its refusal, and the one it would have replaced stays', async () => {
    const cookies = await asLea()

    await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ email: 'zwei@nord.example.de', name: 'Zoe Zwei', roles: ['member'] })
      .expect(201)

    expect(await openFor('zwei@nord.example.de')).toBe(1)

    refusal = new BadRequestException('Das Regal gibt es bei diesem Mandanten nicht.')

    const refused = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({
        email: 'zwei@nord.example.de',
        name: 'Zoe Zwei',
        roles: ['member'],
        additions: { shelf: 'Z9' },
        send: 'mail',
      })
      .expect(400)

    expect(refused.body.message).toBe('Das Regal gibt es bei diesem Mandanten nicht.')
    // The first link is still the one that works: calling it back belonged to
    // the same transaction as the second, and went with it.
    expect(await openFor('zwei@nord.example.de')).toBe(1)
    expect(
      (await admin.query(`select 1 from invitations where email = 'zwei@nord.example.de'`))
        .rowCount,
    ).toBe(1)
    // And nothing was handed to what sends mail.
    expect(handed).toEqual([])
  })

  it('is called with the membership an invitation became, as the person who joined', async () => {
    const invited = await http()
      .post('/staff')
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({ email: 'jo@nord.example.de', name: 'Jo Join', roles: ['guest'], additions: 7 })
      .expect(201)

    asked.length = 0

    await http()
      .post(`/invitation/${invited.body.token as string}`)
      .set('origin', origin)
      .send({ password: 'was-nur-jo-kennt' })
      .expect(201)

    const { rows } = await admin.query<{ id: string }>(
      `select id from auth_users where email = 'jo@nord.example.de'`,
    )
    const joId = rows[0]?.id ?? ''

    expect(joId).not.toBe('')
    expect(asked).toEqual([
      {
        what: 'joined',
        inTenant: north.id,
        asUser: joId,
        about: {
          tenantId: north.id,
          userId: joId,
          invitationId: invited.body.id,
          roles: ['guest'],
        },
      },
    ])
  })

  /**
   * The link is opened without a session, so the application is asked in the
   * tenant the token names and as nobody, and only while the link is good.
   */
  it('is asked what an open invitation says beside its roles, in its tenant and as nobody, and not once the link is spent', async () => {
    const invited = await http()
      .post('/staff')
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({ email: 'offen@nord.example.de', name: 'Olga Offen', roles: ['guest'] })
      .expect(201)
    const token = invited.body.token as string

    asked.length = 0

    expect((await http().get(`/invitation/${token}`).expect(200)).body).toMatchObject({
      state: 'open',
      roles: ['Gast'],
      beside: 'am Regal West',
    })
    expect(asked).toEqual([
      {
        what: 'offered',
        inTenant: north.id,
        asUser: '',
        about: { tenantId: north.id, invitationId: invited.body.id, roles: ['guest'] },
      },
    ])

    await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: 'was-nur-olga-kennt' })
      .expect(201)
    asked.length = 0

    expect((await http().get(`/invitation/${token}`).expect(200)).body).toMatchObject({
      state: 'redeemed',
      roles: [],
      beside: null,
    })
    expect(asked).toEqual([])
  })

  it('takes the redemption back with its refusal: no account, no membership, and the link still good', async () => {
    const invited = await http()
      .post('/staff')
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({ email: 'spaet@nord.example.de', name: 'Sina Spät', roles: ['member'] })
      .expect(201)
    const token = invited.body.token as string

    refusal = new BadRequestException('Das Regal ist inzwischen abgebaut.')

    const refused = await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: 'was-nur-sina-kennt' })
      .expect(400)

    expect(refused.body.message).toBe('Das Regal ist inzwischen abgebaut.')
    expect(
      (await admin.query(`select 1 from auth_users where email = 'spaet@nord.example.de'`))
        .rowCount,
    ).toBe(0)
    expect(await openFor('spaet@nord.example.de')).toBe(1)

    // Once the application takes it, the same link works.
    refusal = null

    await http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: 'was-nur-sina-kennt' })
      .expect(201)

    expect(await openFor('spaet@nord.example.de')).toBe(0)
  })

  it('is handed a change of roles after it is written, with what the body said or with nothing', async () => {
    const cookies = await asLea()

    await http()
      .patch(`/staff/${miaId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['guest'], additions: { shelf: 'B1' } })
      .expect(200)
    await http()
      .patch(`/staff/${miaId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['member'] })
      .expect(200)

    expect(asked).toEqual([
      {
        what: 'changed',
        inTenant: north.id,
        asUser: leaId,
        about: { tenantId: north.id, userId: miaId, roles: ['guest'] },
        said: { shelf: 'B1' },
      },
      {
        what: 'changed',
        inTenant: north.id,
        asUser: leaId,
        about: { tenantId: north.id, userId: miaId, roles: ['member'] },
        said: undefined,
      },
    ])
    expect(await rolesOf(miaId)).toEqual(['member'])
  })

  it('takes the change of roles back with its refusal', async () => {
    refusal = new BadRequestException('Mit dieser Rolle gehört kein Regal dazu.')

    const refused = await http()
      .patch(`/staff/${miaId}`)
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({ roles: ['guest'], additions: { shelf: 'B1' } })
      .expect(400)

    expect(refused.body.message).toBe('Mit dieser Rolle gehört kein Regal dazu.')
    expect(await rolesOf(miaId)).toEqual(['member'])
  })

  it('is not asked about a change the foundation refuses itself', async () => {
    await http()
      .patch(`/staff/${miaId}`)
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({ roles: ['keine-rolle'], additions: { shelf: 'B1' } })
      .expect(400)
    // The last one who leads the tenant keeps the role.
    await http()
      .patch(`/staff/${leaId}`)
      .set('cookie', await asLea())
      .set('origin', origin)
      .send({ roles: ['member'], additions: { shelf: 'B1' } })
      .expect(409)

    expect(asked).toEqual([])
  })
})

/**
 * The staff as a table (opengewerk-haustechnik#236): the accounts of the
 * list with what the application shows beside them, for whoever sees the
 * list, and the application asked in the tenant and as the person.
 */
describe('the staff as a table', () => {
  async function tableOf(cookies: string): Promise<string[][]> {
    const answer = await http()
      .get('/staff/table?format=xlsx')
      .set('cookie', cookies)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          done(null, Buffer.concat(chunks))
        })
      })
      .expect(200)

    return (
      tableFileOf(new Uint8Array(answer.body as Buffer), 'Zugänge.xlsx').sheets[0]?.rows.map(
        (row) => [...row],
      ) ?? []
    )
  }

  it('holds each account with its roles by name, the column of the application, its state and when it was last seen', async () => {
    const rows = await tableOf(await asLea())

    expect(rows[0]).toEqual([
      'Zugang',
      'E-Mail',
      'Rolle',
      'Regale',
      'Zustand',
      'Zuletzt angemeldet',
    ])

    const byEmail = new Map(rows.slice(1).map((row) => [row[1], row]))

    expect(byEmail.get(mia.email)?.slice(0, 5)).toEqual([
      mia.name,
      mia.email,
      'Mitglied',
      `Regal West, gefragt von Lea in Nord, ${String(rows.length - 1)} Personen`,
      'Aktiv',
    ])
    expect(byEmail.get(lea.email)?.slice(3, 5)).toEqual(['', 'Aktiv, zweiter Faktor eingerichtet'])
    expect(byEmail.get(lea.email)?.[5]).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)
  })

  it('is only for whoever sees the staff', async () => {
    const cookies = await visitors.workIn(mia.email, north.id)

    await http().get('/staff/table?format=csv').set('cookie', cookies).expect(403)
  })
})
