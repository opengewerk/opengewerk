import { addDays, berlinClock, type TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../database/identifier.js'
import { authenticationPath } from './authentication.js'
import {
  cookiesOf,
  probeAccess,
  type ProbeFoundation,
  probeChoice,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
} from './probe-application.js'
import { addStaffMember } from './staff.js'
import { currentCode } from './test-authenticator.js'

/**
 * The last day of a membership (for opengewerk-haustechnik#339 and #356):
 * named with an invitation or a change of roles, carried over into the
 * membership, and after it the membership counts as blocked without anybody
 * doing anything. A role the application gives only with a last day is not
 * given without one, and the last one who leads a tenant gets none.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }

const password = 'ein-ordentlich-langes-passwort'

const lea = { email: 'leitung@nord.example.de', name: 'Lea Leitung' }
const mia = { email: 'mitglied@nord.example.de', name: 'Mia Mitglied' }

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let leaTotp = ''
const userIds = new Map<string, string>()

const today = () => berlinClock(new Date()).day
const tomorrow = () => addDays(today(), 1)
const yesterday = () => addDays(today(), -1)

function http() {
  return instance.http()
}

async function signIn(email: string, secret = password): Promise<string> {
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email, password: secret })
    .expect(200)
  const cookies = cookiesOf(answer)

  if (answer.body.twoFactorRedirect !== true) {
    return cookies
  }

  const verified = await http()
    .post(`${authenticationPath}/two-factor/verify-totp`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ code: await currentCode(leaTotp) })
    .expect(200)

  return cookiesOf(verified) || cookies
}

async function asLea(): Promise<string> {
  const cookies = await signIn(lea.email)

  await instance.chooseTenant(cookies, north.id)

  return cookies
}

async function lastDayOf(userId: string): Promise<string | null> {
  const { rows } = await admin.query<{ last_day: string | null }>(
    "select to_char(last_day, 'YYYY-MM-DD') as last_day from memberships where tenant_id = $1 and user_id = $2",
    [north.id, userId],
  )

  return rows[0]?.last_day ?? null
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north])

  // The guest is given only up to a last day, as the auditor of the Haustechnik is.
  instance = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
    endingRoles: ['guest'],
  })

  for (const [person, roles] of [
    [lea, ['lead']],
    [mia, ['member']],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId: north.id as TenantId,
      roles: [...roles],
    })

    userIds.set(person.email, userId)
  }

  // The role that leads asks for a second factor; set up once for the whole file.
  const answer = await http()
    .post(`${authenticationPath}/sign-in/email`)
    .set('origin', origin)
    .send({ email: lea.email, password })
    .expect(200)
  const cookies = cookiesOf(answer)
  const started = await http()
    .post(`${authenticationPath}/two-factor/enable`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ password, method: 'totp' })
    .expect(200)

  leaTotp = started.body.totpURI as string
  await http()
    .post(`${authenticationPath}/two-factor/verify-totp`)
    .set('cookie', cookies)
    .set('origin', origin)
    .send({ code: await currentCode(leaTotp) })
    .expect(200)
})

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('the last day of a membership', () => {
  it('goes with an invitation into the membership, and after it nobody is let in without anybody doing anything', async () => {
    const cookies = await asLea()
    const invited = await http()
      .post('/staff')
      .set('cookie', cookies)
      .set('origin', origin)
      .send({
        email: 'nele@nord.example.de',
        name: 'Nele Neu',
        roles: ['member'],
        lastDay: tomorrow(),
      })
      .expect(201)
    const open = await http().get('/staff/invitations').set('cookie', cookies).expect(200)

    expect(
      (open.body as { email: string; lastDay: string | null }[]).find(
        (each) => each.email === 'nele@nord.example.de',
      )?.lastDay,
    ).toBe(tomorrow())

    await http()
      .post(`/invitation/${invited.body.token as string}`)
      .set('origin', origin)
      .send({ password: 'was-nur-nele-kennt' })
      .expect(201)

    const nele = await signIn('nele@nord.example.de', 'was-nur-nele-kennt')
    const staff = await http().get('/staff').set('cookie', cookies).expect(200)
    const neleId = (staff.body as { email: string; userId: string; lastDay: string | null }[]).find(
      (each) => each.email === 'nele@nord.example.de',
    )

    expect(neleId?.lastDay).toBe(tomorrow())
    expect(await lastDayOf(neleId?.userId ?? '')).toBe(tomorrow())
    expect((await http().get('/auth/tenants').set('cookie', nele).expect(200)).body).toEqual([
      probeChoice(north, ['member']),
    ])
    await instance.chooseTenant(nele, north.id)
    await http().get('/probe/members').set('cookie', nele).expect(200)

    // The day after the last one: the session that was working is refused
    // on its next request, and the tenant is no longer offered.
    await admin.query(
      'update memberships set last_day = $1 where tenant_id = $2 and user_id = $3',
      [yesterday(), north.id, neleId?.userId],
    )

    const refused = await http().get('/probe/members').set('cookie', nele).expect(403)

    expect(refused.body.message).toBe(probeAccess.sentences.endedInTenant)
    expect((await http().get('/auth/tenants').set('cookie', nele).expect(200)).body).toEqual([])
  })

  it('is asked for a role that goes only with one, and is never a day that has passed', async () => {
    const cookies = await asLea()
    const invite = (further: Record<string, unknown>) =>
      http()
        .post('/staff')
        .set('cookie', cookies)
        .set('origin', origin)
        .send({ email: 'gast@nord.example.de', name: 'Gerd Gast', roles: ['guest'], ...further })

    expect((await invite({}).expect(400)).body.message).toBe(
      'Diese Rolle gibt es nur mit einem letzten Tag.',
    )
    expect((await invite({ lastDay: yesterday() }).expect(400)).body.message).toBe(
      'Der letzte Tag ist schon vorbei.',
    )
    expect((await invite({ lastDay: 'morgen' }).expect(400)).body.message).toBe(
      'Der letzte Tag ist ein Tag wie 2026-11-30.',
    )
    await invite({ lastDay: tomorrow() }).expect(201)

    const miaId = userIds.get(mia.email) as string
    const change = (body: Record<string, unknown>) =>
      http().patch(`/staff/${miaId}`).set('cookie', cookies).set('origin', origin).send(body)

    await change({ roles: ['guest'] }).expect(400)
    expect(await lastDayOf(miaId)).toBeNull()
    await change({ roles: ['guest'], lastDay: tomorrow() }).expect(200)
    expect(await lastDayOf(miaId)).toBe(tomorrow())
    // Left out, the last day stays as it is; null takes it away.
    await change({ roles: ['guest'] }).expect(200)
    expect(await lastDayOf(miaId)).toBe(tomorrow())
    await change({ roles: ['member'], lastDay: null }).expect(200)
    expect(await lastDayOf(miaId)).toBeNull()
  })

  it('is not given to the last one who leads the tenant', async () => {
    const cookies = await asLea()
    const leaId = userIds.get(lea.email) as string
    const refused = await http()
      .patch(`/staff/${leaId}`)
      .set('cookie', cookies)
      .set('origin', origin)
      .send({ roles: ['lead'], lastDay: tomorrow() })
      .expect(409)

    expect(refused.body.message).toBe(probeAccess.sentences.lastLead)
    expect(await lastDayOf(leaId)).toBeNull()
  })
})
