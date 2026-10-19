import type { InstanceMeasuresView, TenantId } from '@opengewerk/platform-domain'
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
import { readMeasures } from './measures.js'

/**
 * Part B of the measures and the subprocessors of the instance
 * (opengewerk-haustechnik#358), end to end and through HTTP, with people who
 * really signed in.
 *
 * What it holds: only whoever runs the instance reads and keeps them on their
 * screen; what is kept is what the domain lets through, without the spaces
 * around a text and without the boxes left empty; the application reads them
 * for the documents of a tenant without anybody's name; and every change
 * stands in the log of the instance with person and way.
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

const server = {
  name: 'Rechenbetrieb Nord GmbH, Hafenweg 1',
  service: 'Server',
  place: 'Deutschland',
}

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

async function forTheirScreen(): Promise<InstanceMeasuresView> {
  return (await get('/instance/measures', lea).expect(200)).body as InstanceMeasuresView
}

async function kept(): Promise<{ measures: unknown; subprocessors: unknown }> {
  const { rows } = await admin.query<{ measures: unknown; subprocessors: unknown }>(
    'select measures, subprocessors from instance_settings where id = 1',
  )

  return rows[0] ?? { measures: null, subprocessors: null }
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

describe('who keeps the measures of the instance', () => {
  it('is nobody who is not signed in, and nobody who leads a tenant and does not run the instance', async () => {
    const change = { measures: { serverPlace: 'Nürnberg' }, subprocessors: [] }

    await get('/instance/measures').expect(401)
    await put('/instance/measures', change).expect(401)
    await get('/instance/measures', otto).expect(403)
    await put('/instance/measures', change, otto).expect(403)

    expect(await kept()).toEqual({ measures: {}, subprocessors: [] })
  })

  it('is whoever runs the instance: empty while nothing is kept', async () => {
    expect(await forTheirScreen()).toEqual({
      measures: {},
      subprocessors: [],
      changedAt: null,
      changedBy: null,
    })
  })

  it('keeps what the domain lets through, without the spaces around a text and the boxes left empty', async () => {
    const saved = await put(
      '/instance/measures',
      {
        measures: {
          serverPlace: '  Deutschland, Nürnberg ',
          serverRoom: '',
          accessFirewall: true,
          encryptionDisks: false,
        },
        subprocessors: [{ ...server, name: ` ${server.name} ` }],
      },
      lea,
    ).expect(200)

    expect((saved.body as InstanceMeasuresView).measures).toEqual({
      serverPlace: 'Deutschland, Nürnberg',
      accessFirewall: true,
    })
    expect(await kept()).toEqual({
      measures: { serverPlace: 'Deutschland, Nürnberg', accessFirewall: true },
      subprocessors: [server],
    })
  })

  it('keeps both parts whole: what a request leaves out is gone', async () => {
    await put(
      '/instance/measures',
      { measures: { accessFirewall: true, staffTrained: true }, subprocessors: [] },
      lea,
    ).expect(200)

    expect(await kept()).toEqual({
      measures: { accessFirewall: true, staffTrained: true },
      subprocessors: [],
    })
  })

  it('refuses what the domain refuses, with its sentence, and keeps nothing of it', async () => {
    expect(
      message(
        await put(
          '/instance/measures',
          { measures: { password: 'x' }, subprocessors: [] },
          lea,
        ).expect(400),
      ),
    ).toBe('Ein Feld „password“ gibt es nicht.')
    expect(
      message(
        await put(
          '/instance/measures',
          { measures: {}, subprocessors: [{ ...server, place: '' }] },
          lea,
        ).expect(400),
      ),
    ).toBe('Beim 1. Unterauftragsverarbeiter fehlt „Ort der Verarbeitung“.')
    expect(message(await put('/instance/measures', {}, lea).expect(400))).toBe(
      'Es fehlen die Maßnahmen.',
    )

    expect(await kept()).toEqual({
      measures: { accessFirewall: true, staffTrained: true },
      subprocessors: [],
    })
  })
})

describe('the measures for the documents of a tenant', () => {
  it('are what was kept, with when it was changed and without who changed it', async () => {
    await put(
      '/instance/measures',
      { measures: { serverPlace: 'Nürnberg', backupGenerations: '14' }, subprocessors: [server] },
      lea,
    ).expect(200)

    const read = await readMeasures(instance.database)

    expect(read).toEqual({
      measures: { serverPlace: 'Nürnberg', backupGenerations: '14' },
      subprocessors: [server],
      changedAt: expect.any(String) as unknown,
    })
    expect(read).not.toHaveProperty('changedBy')
    expect((await forTheirScreen()).changedAt).toBe(read.changedAt)
  })
})

describe('a change of the measures', () => {
  it('stands in the log of the instance, with person and way', async () => {
    const { rows } = await admin.query<{
      field: string
      user_id: string | null
      reason: string | null
    }>(
      `select field, user_id, reason from instance_changes
        where table_name = 'instance_settings' and operation = 'update'
          and field in ('measures', 'subprocessors')
        order by id`,
    )
    const { rows: accounts } = await admin.query<{ id: string }>(
      'select id from auth_users where email = $1',
      [lea.email],
    )
    const leaId = accounts[0]?.id

    expect(rows.map((row) => [row.field, row.reason, row.user_id])).toEqual([
      ['measures', 'instance.measures', leaId],
      ['subprocessors', 'instance.measures', leaId],
      ['measures', 'instance.measures', leaId],
      ['subprocessors', 'instance.measures', leaId],
      ['measures', 'instance.measures', leaId],
      ['subprocessors', 'instance.measures', leaId],
    ])
  })

  it('tells the screen when and by whom they were last changed', async () => {
    expect(await forTheirScreen()).toMatchObject({ changedBy: lea.name })
  })
})
