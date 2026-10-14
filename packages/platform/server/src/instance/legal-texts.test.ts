import type { InstanceLegalTextsView, TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
  type ProbeVisitors,
  probeVisitors,
} from '../authentication/probe-application.js'
import { addStaffMember } from '../authentication/staff.js'

/**
 * The legal texts of the instance (opengewerk-haustechnik#129), end to end
 * and through HTTP, with people who really signed in.
 *
 * What it holds: anybody reads the two texts, signed in or not, and learns
 * nothing else of the instance with them; only whoever runs the instance
 * changes them; an empty text is no text, so that no link leads to nothing;
 * and every change stands in the log of the instance with person and way.
 *
 * The tests build on each other, in the order they stand: an instance has one
 * row of settings.
 */

const password = 'ein-ordentlich-langes-passwort'
const setupCode = 'K7Q4-9PXM'

/** Sets the instance up, and so runs it. */
const lea = { email: 'lea@nord.example.de', name: 'Lea Leitung' }
/** Leads the first tenant as well, with a second factor, and runs nothing. */
const otto = { email: 'otto@nord.example.de', name: 'Otto Zweitleitung' }

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let visitors: ProbeVisitors

const signedIn = new Map<string, string>()
const as = (person: { email: string }) => signedIn.get(person.email) ?? ''

function get(path: string, person?: { email: string }) {
  const asking = instance.http().get(path)

  return person ? asking.set('cookie', as(person)) : asking
}

function put(path: string, body: object, person?: { email: string }) {
  const asking = instance.http().put(path).set('origin', origin)

  return (person ? asking.set('cookie', as(person)) : asking).send(body)
}

const message = (answer: { body: unknown }) => (answer.body as { message: string }).message

async function forAnybody(): Promise<unknown> {
  return (await get('/legal-texts').expect(200)).body
}

async function forTheirScreen(): Promise<InstanceLegalTextsView> {
  return (await get('/instance/legal-texts', lea).expect(200)).body as InstanceLegalTextsView
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl(), { setupCode })
  visitors = probeVisitors(instance, password)

  await instance
    .http()
    .post('/setup')
    .set('origin', origin)
    .send({ setupCode, company: 'Mandant Nord', name: lea.name, email: lea.email, password })
    .expect(201)

  const { rows: tenants } = await admin.query<{ id: TenantId }>('select id from tenants')

  await addStaffMember(instance.authentication, instance.database, {
    ...otto,
    password,
    tenantId: tenants[0]?.id as TenantId,
    roles: ['lead'],
  })

  await visitors.setUpSecondFactor(lea.email)
  await visitors.setUpSecondFactor(otto.email)

  for (const person of [lea, otto]) {
    signedIn.set(person.email, await visitors.signIn(person.email))
  }
}, 60_000)

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('the legal texts for anybody', () => {
  it('answer without a session, and with no text while none is kept', async () => {
    expect(await forAnybody()).toEqual({ imprint: null, privacy: null })
  })
})

describe('who keeps the legal texts', () => {
  it('is nobody who is not signed in, and nobody who leads a tenant and does not run the instance', async () => {
    await get('/instance/legal-texts').expect(401)
    await put('/instance/legal-texts', { imprint: 'Nord GmbH' }).expect(401)
    await get('/instance/legal-texts', otto).expect(403)
    await put('/instance/legal-texts', { imprint: 'Nord GmbH' }, otto).expect(403)

    expect(await forAnybody()).toEqual({ imprint: null, privacy: null })
  })

  it('is whoever runs the instance: the text as typed, without the spaces around it', async () => {
    const saved = await put(
      '/instance/legal-texts',
      { imprint: '  # Impressum\r\n\r\n**Nord GmbH**\r\nAm Probehang 4  \n' },
      lea,
    ).expect(200)

    expect((saved.body as InstanceLegalTextsView).imprint.text).toBe(
      '# Impressum\n\n**Nord GmbH**\nAm Probehang 4',
    )
    expect(await forAnybody()).toEqual({
      imprint: '# Impressum\n\n**Nord GmbH**\nAm Probehang 4',
      privacy: null,
    })
  })

  it('changes one text and leaves the other as it was', async () => {
    await put(
      '/instance/legal-texts',
      { privacy: 'Verantwortlich ist die Nord GmbH.' },
      lea,
    ).expect(200)

    expect(await forAnybody()).toEqual({
      imprint: '# Impressum\n\n**Nord GmbH**\nAm Probehang 4',
      privacy: 'Verantwortlich ist die Nord GmbH.',
    })
  })

  it('removes a text that is left empty, so that no link leads to nothing', async () => {
    await put('/instance/legal-texts', { privacy: '   \n ' }, lea).expect(200)

    expect(await forAnybody()).toEqual({
      imprint: '# Impressum\n\n**Nord GmbH**\nAm Probehang 4',
      privacy: null,
    })
  })

  it('refuses what is no text, a text that is too long, and a request without either', async () => {
    await put('/instance/legal-texts', { imprint: 5 }, lea).expect(400)

    const tooLong = await put('/instance/legal-texts', { imprint: 'x'.repeat(40_001) }, lea).expect(
      400,
    )

    expect(message(tooLong)).toBe('Höchstens 40.000 Zeichen.')
    expect(message(await put('/instance/legal-texts', {}, lea).expect(400))).toBe(
      'Es fehlt der Text, der gespeichert werden soll.',
    )
    // The longest text that may be is kept.
    await put('/instance/legal-texts', { privacy: 'ä'.repeat(40_000) }, lea).expect(200)
    expect((await forTheirScreen()).privacy.text).toHaveLength(40_000)
  })
})

describe('a change of the legal texts', () => {
  it('stands in the log of the instance, with person and way', async () => {
    const { rows } = await admin.query<{
      field: string
      new_value: string | null
      user_id: string | null
      reason: string | null
    }>(
      `select field, new_value, user_id, reason from instance_changes
        where table_name = 'instance_settings' and field in ('imprint', 'privacy_notice')
        order by id`,
    )
    const { rows: accounts } = await admin.query<{ id: string }>(
      'select id from auth_users where email = $1',
      [lea.email],
    )

    expect(rows.map((row) => [row.field, row.reason, row.user_id])).toEqual([
      ['imprint', 'instance.legal', accounts[0]?.id],
      ['privacy_notice', 'instance.legal', accounts[0]?.id],
      ['privacy_notice', 'instance.legal', accounts[0]?.id],
      ['privacy_notice', 'instance.legal', accounts[0]?.id],
    ])
    expect(rows[0]?.new_value).toBe('# Impressum\n\n**Nord GmbH**\nAm Probehang 4')
  })

  it('tells the screen when and by whom each text was last changed', async () => {
    const view = await forTheirScreen()

    expect(view.imprint).toMatchObject({
      text: '# Impressum\n\n**Nord GmbH**\nAm Probehang 4',
      changedBy: lea.name,
    })
    expect(view.privacy.changedBy).toBe(lea.name)
    expect(Date.parse(view.imprint.changedAt ?? '')).toBeLessThanOrEqual(
      Date.parse(view.privacy.changedAt ?? ''),
    )
  })
})
