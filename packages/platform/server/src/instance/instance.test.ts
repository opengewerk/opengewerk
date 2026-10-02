import { tmpdir } from 'node:os'
import { PassThrough, Writable } from 'node:stream'

import { BadRequestException } from '@nestjs/common'
import type {
  InstanceLogPage,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
  TenantId,
} from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hashToken } from '../authentication/invitation.js'
import {
  probeAccess,
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
  probeRoles,
  type ProbeVisitors,
  probeVisitors,
  probewerk,
} from '../authentication/probe-application.js'
import { addStaffMember } from '../authentication/staff.js'
import type { CommandSurroundings } from '../command-line.js'
import { ConfigurationError, type Environment } from '../configuration.js'
import { Database } from '../database/database.js'
import { addTenant, appointOperatorFromCommandLine } from './commands.js'
import { appointOperator, removeOperator } from './operators.js'
import {
  InstanceSettingsCache,
  readInstanceSettings,
  saveInstanceSettings,
  takeOverFromEnvironment,
} from './settings.js'
import { createOwnTenant } from './tenants.js'

/**
 * The area of the instance (#188) and further tenants on it (#142), end to
 * end and through HTTP, with people who really signed in.
 *
 * What it holds: only whoever runs the instance gets in, and only with a
 * second factor; leading a tenant opens nothing there; every change lands in
 * the log of the instance; the last one who runs it stays; a further tenant
 * begins with its roles and with somebody who leads it, and is as separate
 * from the first as a stranger's.
 *
 * It runs with the probe application, whose word for whoever runs an instance
 * no real application has. A sentence that named one of them here would have
 * come from the foundation.
 *
 * The tests of a block build on each other, in the order they stand: an
 * instance has one list of who runs it and one row of settings.
 */

const password = 'ein-ordentlich-langes-passwort'
const setupCode = 'K7Q4-9PXM'

/** Sets the instance up, and so runs it and leads its first tenant. */
const lea = { email: 'lea@nord.example.de', name: 'Lea Leitung' }
/** Leads the first tenant as well, and runs nothing. */
const otto = { email: 'otto@nord.example.de', name: 'Otto Zweitleitung' }
/** Works in the first tenant, without a second factor. */
const mia = { email: 'mia@nord.example.de', name: 'Mia Mitglied' }

const sentences = probeAccess.sentences.instance

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let visitors: ProbeVisitors
let environment: Environment
/** A second way to the same database, for what a test does next to the instance. */
let database: Database
/** The settings as the instance keeps them in memory. */
let inMemory: InstanceSettingsCache

let north: TenantId
/** The cookies of each person, signed in and in no tenant. */
const signedIn = new Map<string, string>()
const userIds = new Map<string, string>()

const idOf = (person: { email: string }) => userIds.get(person.email) ?? ''
const as = (person: { email: string }) => signedIn.get(person.email) ?? ''

function get(path: string, person?: { email: string }) {
  const asking = instance.http().get(path)

  return person ? asking.set('cookie', as(person)) : asking
}

function send(
  method: 'post' | 'put' | 'delete',
  path: string,
  person: { email: string },
  body?: object,
) {
  return instance
    .http()
    [method](path)
    .set('cookie', as(person))
    .set('origin', origin)
    .send(body ?? {})
}

const message = (answer: { body: unknown }) => (answer.body as { message: string }).message

/** A script: nobody at the terminal, and nothing shown on it. */
function script(): NonNullable<CommandSurroundings['terminal']> {
  return {
    input: Object.assign(new PassThrough(), { isTTY: false }),
    output: new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    }),
  }
}

/** Runs a command as a script would, and hands back what it said. */
async function said(
  command: (surroundings: CommandSurroundings) => Promise<void>,
  given: readonly string[],
  scriptPassword?: string,
): Promise<string[]> {
  const lines: string[] = []

  await command({
    arguments: given,
    environment: {
      ...environment,
      ...(scriptPassword ? { PROBEWERK_PASSWORD: scriptPassword } : {}),
    },
    terminal: script(),
    say: (line) => lines.push(line),
  })

  return lines
}

/** The sentence a command stopped with. */
async function refusal(work: Promise<unknown>): Promise<string> {
  const error: unknown = await work.then(
    () => null,
    (caught: unknown) => caught,
  )

  expect(error).toBeInstanceOf(ConfigurationError)

  return (error as ConfigurationError).message
}

const appointing = (surroundings: CommandSurroundings) =>
  appointOperatorFromCommandLine(probewerk, probeAccess, surroundings)
const addingTenant = (surroundings: CommandSurroundings) =>
  addTenant(probewerk, probeAccess, surroundings)

/** Who runs the instance, by the database, in the order they were named. */
async function running(): Promise<string[]> {
  const { rows } = await admin.query<{ user_id: string }>(
    'select user_id from instance_operators order by created_at, id',
  )

  return rows.map((row) => row.user_id)
}

async function tenantsAsSeen(): Promise<InstanceTenantView[]> {
  return (await get('/instance/tenants', lea).expect(200)).body as InstanceTenantView[]
}

async function log(): Promise<InstanceLogPage> {
  return (await get('/instance/log', lea).expect(200)).body as InstanceLogPage
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)

  const url = foundation.kit.applicationDatabaseUrl()

  environment = {
    DATABASE_URL: url,
    STORAGE_PATH: tmpdir(),
    SESSION_SECRET: 'c'.repeat(64),
    TRUSTED_ORIGINS: origin,
  }

  database = Database.connect(url)
  inMemory = await InstanceSettingsCache.load(database)
  instance = await probeInstance(url, { setupCode, instanceSettings: inMemory })
  visitors = probeVisitors(instance, password)

  // The first run, the way an instance begins: through the setup screen.
  await instance
    .http()
    .post('/setup')
    .set('origin', origin)
    .send({ setupCode, company: 'Mandant Nord', name: lea.name, email: lea.email, password })
    .expect(201)

  const { rows: tenants } = await admin.query<{ id: TenantId }>('select id from tenants')
  north = tenants[0]?.id as TenantId

  await addStaffMember(instance.authentication, instance.database, {
    ...otto,
    password,
    tenantId: north,
    roles: ['lead'],
  })
  await addStaffMember(instance.authentication, instance.database, {
    ...mia,
    password,
    tenantId: north,
    roles: ['member'],
  })

  const { rows: accounts } = await admin.query<{ id: string; email: string }>(
    'select id, email from auth_users',
  )

  for (const account of accounts) {
    userIds.set(account.email, account.id)
  }

  // Whoever leads has a second factor, the role leaves no choice.
  await visitors.setUpSecondFactor(lea.email)
  await visitors.setUpSecondFactor(otto.email)

  for (const person of [lea, otto, mia]) {
    signedIn.set(person.email, await visitors.signIn(person.email))
  }
})

afterAll(async () => {
  await instance.close()
  await database.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('who gets into the area of the instance', () => {
  it('is whoever set the instance up, and nobody else: the first run names them', async () => {
    expect(await running()).toEqual([idOf(lea)])
  })

  it('tells everybody whether they may, for the entry in the menu', async () => {
    expect((await get('/instance/access', lea).expect(200)).body).toEqual({
      operator: true,
      secondFactor: true,
    })
    expect((await get('/instance/access', otto).expect(200)).body).toEqual({
      operator: false,
      secondFactor: true,
    })
    expect((await get('/instance/access', mia).expect(200)).body).toEqual({
      operator: false,
      secondFactor: false,
    })
  })

  it('lets whoever runs the instance in, with the second factor of the session', async () => {
    for (const path of ['/settings', '/operators', '/log', '/tenants']) {
      await get(`/instance${path}`, lea).expect(200)
    }
  })

  it('refuses whoever leads a tenant and does not run the instance, in the words of the application', async () => {
    for (const path of ['/settings', '/operators', '/log', '/tenants']) {
      const refused = await get(`/instance${path}`, otto).expect(403)

      expect(message(refused)).toBe('Diesen Bereich erreicht nur die Hausmeisterei der Instanz.')
    }

    // And nothing that changes anything either.
    await send('put', '/instance/settings', otto, { backupTime: '01:00' }).expect(403)
    await send('post', '/instance/operators', otto, { email: otto.email }).expect(403)
    await send('post', '/instance/tenants', otto, {
      name: 'Mandant Otto',
      leadName: otto.name,
      leadEmail: otto.email,
    }).expect(403)

    expect(await running()).toEqual([idOf(lea)])
  })

  it('refuses whoever is not signed in', async () => {
    await get('/instance/settings').expect(401)
    await get('/instance/access').expect(401)
  })
})

describe('the settings of the instance', () => {
  it('start with no mail server in the own network and the backup at half past two', async () => {
    expect((await get('/instance/settings', lea).expect(200)).body).toEqual({
      mailInternalHosts: [],
      backupTime: '02:30',
      takenOverAt: null,
    })
  })

  it('came with the table, and the log of the instance says so', async () => {
    const { rows } = await admin.query<{ reason: string | null; user_id: string | null }>(
      `select distinct reason, user_id from instance_changes
        where table_name = 'instance_settings' and operation = 'insert'`,
    )

    expect(rows).toEqual([{ reason: 'migration', user_id: null }])
  })

  it('take mail servers and a time, and refuse what is neither', async () => {
    const saved = await send('put', '/instance/settings', lea, {
      mailInternalHosts: ['mail.intern.example', ' 192.168.1.20 ', '', 'mail.intern.example'],
      backupTime: '03:15',
    }).expect(200)

    expect(saved.body as InstanceSettingsView).toMatchObject({
      mailInternalHosts: ['mail.intern.example', '192.168.1.20'],
      backupTime: '03:15',
    })

    for (const wrong of [
      { mailInternalHosts: ['smtp://mail.intern.example:25'] },
      { mailInternalHosts: 'mail.intern.example' },
      { backupTime: '25:00' },
      { backupTime: 'nachts' },
    ]) {
      await send('put', '/instance/settings', lea, wrong).expect(400)
    }

    expect((await readInstanceSettings(database)).backupTime).toBe('03:15')
  })

  it('reach the copy an application keeps in memory at once, not on the next refresh', async () => {
    // What the routes changed above is already there, and nobody refreshed.
    expect(inMemory.current().backupTime).toBe('03:15')

    await send('put', '/instance/settings', lea, { backupTime: '04:45' }).expect(200)

    expect(inMemory.current().backupTime).toBe('04:45')
  })

  it('write every change into the log of the instance, with person and way', async () => {
    const page = await log()
    const change = page.changes.find(
      (entry) =>
        entry.table === 'instance_settings' &&
        entry.fields.some((field) => field.field === 'backup_time' && field.after === '03:15:00'),
    )

    expect(change?.userId).toBe(idOf(lea))
    expect(change?.reason).toBe('instance.settings')
    expect(change?.fields.find((field) => field.field === 'backup_time')).toMatchObject({
      before: '02:30:00',
      after: '03:15:00',
    })
    expect(page.people[idOf(lea)]).toBe(lea.name)
  })
})

describe('the settings an application keeps in memory', () => {
  it('follow a change made elsewhere on the next refresh, and fixed ones never ask', async () => {
    const cache = await InstanceSettingsCache.load(database)

    expect(cache.current().backupTime).toBe('04:45')

    // Another process of the same instance changes them: this copy hears of
    // it when it next looks.
    await saveInstanceSettings(database, idOf(lea), { backupTime: '05:10' })
    expect(cache.current().backupTime).toBe('04:45')

    await cache.refresh()
    expect(cache.current().backupTime).toBe('05:10')

    const fixed = InstanceSettingsCache.fixed({
      mailInternalHosts: ['mail.lan'],
      backupTime: '02:30',
      takenOverAt: null,
    })

    await fixed.refresh()
    expect(fixed.current().mailInternalHosts).toEqual(['mail.lan'])
  })
})

describe('MAIL_INTERNAL_HOSTS from the .env', () => {
  it('takes nothing over while it is empty, and leaves the way open for a value set later', async () => {
    expect(await takeOverFromEnvironment(database, [])).toBe(false)
    expect((await readInstanceSettings(database)).takenOverAt).toBeNull()
  })

  it('is taken over once, next to what was set on the screen, and never again', async () => {
    expect(await takeOverFromEnvironment(database, ['10.0.0.9', 'mail.intern.example'])).toBe(true)

    const taken = await readInstanceSettings(database)

    expect(taken.mailInternalHosts).toEqual(['mail.intern.example', '192.168.1.20', '10.0.0.9'])
    expect(taken.takenOverAt).not.toBeNull()

    // A later start with another value changes nothing: the screen decides now.
    expect(await takeOverFromEnvironment(database, ['10.0.0.5'])).toBe(false)
    expect((await readInstanceSettings(database)).mailInternalHosts).toEqual([
      'mail.intern.example',
      '192.168.1.20',
      '10.0.0.9',
    ])
  })

  it('stands in the log of the instance as taken from the environment, by nobody', async () => {
    const { rows } = await admin.query<{ user_id: string | null; reason: string | null }>(
      `select user_id, reason from instance_changes
        where table_name = 'instance_settings' and field = 'imported_from_environment_at'`,
    )

    expect(rows).toEqual([{ user_id: null, reason: 'environment' }])
  })
})

describe('who runs the instance', () => {
  it('is named among the accounts that exist, and no other, and nobody twice', async () => {
    const named = await send('post', '/instance/operators', lea, {
      email: 'Otto@Nord.example.de',
    }).expect(201)

    expect(named.body as OperatorView).toMatchObject({
      userId: idOf(otto),
      name: otto.name,
      email: otto.email,
      secondFactor: true,
    })

    const unknown = await send('post', '/instance/operators', lea, {
      email: 'niemand@example.de',
    }).expect(404)

    expect(message(unknown)).toBe('Ein Konto mit dieser Adresse gibt es auf dieser Instanz nicht.')

    const twice = await send('post', '/instance/operators', lea, { email: otto.email }).expect(409)

    expect(message(twice)).toBe(sentences.alreadyOperator)

    await send('post', '/instance/operators', lea, { email: 'keine-adresse' }).expect(400)
    await send('post', '/instance/operators', lea, {}).expect(400)

    const list = (await get('/instance/operators', lea).expect(200)).body as OperatorView[]

    expect(list.map((operator) => operator.userId)).toEqual([idOf(lea), idOf(otto)])
  })

  it('opens the area to whoever was named, at once', async () => {
    await get('/instance/settings', otto).expect(200)
  })

  it('is taken from another and never from oneself, in the words of the application', async () => {
    const oneself = await send('delete', `/instance/operators/${idOf(lea)}`, lea).expect(409)

    expect(message(oneself)).toBe(sentences.notOneself)

    const stranger = await send('delete', `/instance/operators/${idOf(mia)}`, lea).expect(404)

    expect(message(stranger)).toBe(sentences.notAnOperator)

    await send('delete', `/instance/operators/${idOf(otto)}`, lea).expect(200, {
      removed: idOf(otto),
    })

    // Taken away, and at once: the next request with the same session is refused.
    await get('/instance/settings', otto).expect(403)
    expect(await running()).toEqual([idOf(lea)])
  })

  it('keeps the last one, also when two take each other out at the same moment', async () => {
    await appointOperator(database, sentences, idOf(lea), otto.email)

    // Both passed the door while both ran the instance; the second to get
    // the lock finds itself alone with the one it wants to remove.
    await removeOperator(database, sentences, idOf(lea), idOf(otto))
    await expect(removeOperator(database, sentences, idOf(otto), idOf(lea))).rejects.toThrow(
      sentences.lastOperator,
    )

    expect(await running()).toEqual([idOf(lea)])
  })

  it('writes naming and taking away into the log of the instance, with who did it', async () => {
    const page = await log()
    const aboutOtto = page.changes.filter(
      (change) =>
        change.table === 'instance_operators' &&
        change.fields.some(
          (field) =>
            field.field === 'user_id' &&
            (field.after === idOf(otto) || field.before === idOf(otto)),
        ),
    )

    // Named and taken away twice each, newest first.
    expect(aboutOtto.map((change) => [change.operation, change.reason, change.userId])).toEqual([
      ['delete', 'operator.remove', idOf(lea)],
      ['insert', 'operator.appoint', idOf(lea)],
      ['delete', 'operator.remove', idOf(lea)],
      ['insert', 'operator.appoint', idOf(lea)],
    ])

    // The record is called by the person it names, and the page knows the name.
    expect(page.titles[aboutOtto[0]?.recordId ?? '']).toMatchObject({
      table: 'instance_operators',
      field: 'user_id',
      title: idOf(otto),
    })
    expect(page.people[idOf(otto)]).toBe(otto.name)
  })
})

describe('naming somebody from the command line', () => {
  it('says how it is called when nothing is given', async () => {
    expect(await refusal(appointing({ arguments: [], environment }))).toBe(
      sentences.appointOperator.usage,
    )
  })

  it('names an account that exists, in the words of the application, with nobody signed in', async () => {
    const lines = await said(appointing, [mia.email])

    // Mia has no second factor, and the command says what that means.
    expect(lines).toEqual([
      'mia@nord.example.de gehört jetzt zur Hausmeisterei dieser Instanz.',
      'Für die Hausmeisterei ist ein zweiter Faktor Pflicht.',
    ])
    expect(await running()).toEqual([idOf(lea), idOf(mia)])

    // There is no account at a shell: the log names the way and no person.
    const { rows } = await admin.query<{ user_id: string | null; reason: string | null }>(
      `select user_id, reason from instance_changes
        where table_name = 'instance_operators' and field = 'user_id' and new_value = $1`,
      [idOf(mia)],
    )

    expect(rows).toEqual([{ user_id: null, reason: 'operator.cli' }])
  })

  it('says nothing about a second factor to somebody who has one', async () => {
    await removeOperator(database, sentences, idOf(lea), idOf(mia))

    expect(await said(appointing, [otto.email])).toEqual([
      'otto@nord.example.de gehört jetzt zur Hausmeisterei dieser Instanz.',
    ])

    await removeOperator(database, sentences, idOf(lea), idOf(otto))
  })

  it('stops with a sentence for an account that is not there or is named already', async () => {
    expect(await refusal(said(appointing, ['niemand@example.de']))).toBe(
      'Ein Konto mit dieser Adresse gibt es auf dieser Instanz nicht.',
    )
    expect(await refusal(said(appointing, [lea.email]))).toBe(sentences.alreadyOperator)
  })
})

describe('whoever runs the instance without a second factor', () => {
  it('is refused, and told how to get one', async () => {
    await said(appointing, [mia.email])

    expect((await get('/instance/access', mia).expect(200)).body).toEqual({
      operator: true,
      secondFactor: false,
    })

    const refused = await get('/instance/settings', mia).expect(403)

    expect(message(refused)).toContain('zweiter Faktor Pflicht')

    await removeOperator(database, sentences, idOf(lea), idOf(mia))
  })
})

describe('a further tenant', () => {
  let branch: TenantId
  let south: TenantId

  it('is created by somebody for themselves, who leads it at once', async () => {
    const created = await createOwnTenant(database, probeAccess, idOf(lea), '  Mandant Zweig ')

    branch = created.tenantId
    expect(created.name).toBe('Mandant Zweig')

    const { rows: members } = await admin.query<{ user_id: string; roles: string[] }>(
      'select user_id, roles from memberships where tenant_id = $1',
      [branch],
    )

    expect(members).toEqual([{ user_id: idOf(lea), roles: ['lead'] }])
  })

  it('begins with the roles the application ships, as rows of its own', async () => {
    const { rows } = await admin.query<{ key: string; leads: boolean }>(
      'select key, leads from tenant_roles where tenant_id = $1 order by id',
      [branch],
    )

    expect(rows).toEqual(probeRoles.map((role) => ({ key: role.key, leads: role.leads })))
  })

  it('is as separate from the first as a stranger: nothing of the first in it', async () => {
    const cookies = await visitors.workIn(lea.email, branch)
    const inside = await instance.http().get('/probe/members').set('cookie', cookies).expect(200)

    expect(inside.body).toEqual([{ userId: idOf(lea), roles: ['lead'] }])
  })

  it('takes a name only as the application checks it, and leaves nothing behind otherwise', async () => {
    const before = (await admin.query('select 1 from tenants')).rowCount

    // Nothing that could be a name: the sentence of the area of the instance.
    await expect(createOwnTenant(database, probeAccess, idOf(lea), undefined)).rejects.toThrow(
      sentences.tenantNameMissing,
    )
    // A name the application refuses: its own rule, in its own words.
    await expect(createOwnTenant(database, probeAccess, idOf(lea), '   ')).rejects.toThrow(
      'Der Name des Mandanten fehlt.',
    )

    const tooLong = createOwnTenant(database, probeAccess, idOf(lea), 'M'.repeat(41))

    await expect(tooLong).rejects.toBeInstanceOf(BadRequestException)
    await expect(tooLong).rejects.toThrow('Der Name des Mandanten ist länger als 40 Zeichen.')

    expect((await admin.query('select 1 from tenants')).rowCount).toBe(before)
  })

  it('is created for somebody else by whoever runs the instance, with an invitation to lead it', async () => {
    const created = await send('post', '/instance/tenants', lea, {
      name: 'Mandant Süd',
      leadName: 'Sven Süd',
      leadEmail: 'Sven@Sued.example.de',
    }).expect(201)
    const { tenantId, token } = created.body as { tenantId: TenantId; token: string }

    south = tenantId

    const { rows } = await admin.query<{ email: string; roles: string[]; invited_by: string }>(
      'select email, roles, invited_by from invitations where tenant_id = $1 and token_hash = $2',
      [south, hashToken(token)],
    )

    expect(rows).toEqual([
      { email: 'sven@sued.example.de', roles: ['lead'], invited_by: idOf(lea) },
    ])

    // Whoever created it did not become a member of it.
    expect(
      (await admin.query('select 1 from memberships where tenant_id = $1', [south])).rowCount,
    ).toBe(0)
    // And it has its roles all the same, or the invitation would lead nowhere.
    expect(
      (await admin.query('select 1 from tenant_roles where tenant_id = $1', [south])).rowCount,
    ).toBe(probeRoles.length)
  })

  it('needs somebody to lead it, named in the words of the application', async () => {
    const nameless = await send('post', '/instance/tenants', lea, {
      name: 'Mandant West',
      leadName: '  ',
      leadEmail: 'wanda@west.example.de',
    }).expect(400)

    expect(message(nameless)).toBe(sentences.leadNameMissing)

    const noAddress = await send('post', '/instance/tenants', lea, {
      name: 'Mandant West',
      leadName: 'Wanda West',
      leadEmail: 'wanda',
    }).expect(400)

    expect(message(noAddress)).toBe(sentences.leadEmailNotOne)

    expect((await tenantsAsSeen()).map((tenant) => tenant.name)).not.toContain('Mandant West')
  })

  it('is listed for whoever runs the instance with who leads it and how many work in it, and nothing of what is in it', async () => {
    const seen = await tenantsAsSeen()

    expect(seen.map((tenant) => tenant.name)).toEqual([
      'Mandant Nord',
      'Mandant Zweig',
      'Mandant Süd',
    ])

    expect(seen.find((tenant) => tenant.id === north)).toMatchObject({
      leads: [
        { name: lea.name, email: lea.email },
        { name: otto.name, email: otto.email },
      ],
      members: 3,
      invitedLeads: [],
    })
    expect(seen.find((tenant) => tenant.id === branch)).toMatchObject({
      leads: [{ name: lea.name, email: lea.email }],
      members: 1,
      invitedLeads: [],
    })
    expect(seen.find((tenant) => tenant.id === south)).toMatchObject({
      leads: [],
      members: 0,
      invitedLeads: ['sven@sued.example.de'],
    })

    // Exactly these fields, so that nothing of a tenant slips into the list.
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'invitedLeads',
      'leads',
      'members',
      'name',
    ])
  })

  /**
   * Who leads a tenant is what the rows of its roles say, and no name of a
   * role. A tenant may call the role that leads it anything, and may have
   * taken the leading away from the one the application shipped.
   */
  it('counts as led by whoever holds a role of that tenant that leads, whatever it is called', async () => {
    const leadsOfNorth = async () =>
      (await tenantsAsSeen()).find((tenant) => tenant.id === north)?.leads.map((lead) => lead.name)

    // A role of the tenant's own that leads, held by Mia.
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, 'chief', 'Chefin', '{}', true, false)`,
      [north],
    )
    await admin.query(
      `update memberships set roles = '{chief}' where tenant_id = $1 and user_id = $2`,
      [north, idOf(mia)],
    )

    expect(await leadsOfNorth()).toEqual([lea.name, otto.name, mia.name])

    // The shipped role stops leading: whoever holds it is no longer listed,
    // although its key is what it always was.
    await admin.query(
      `update tenant_roles set leads = false where tenant_id = $1 and key = 'lead'`,
      [north],
    )

    expect(await leadsOfNorth()).toEqual([mia.name])

    await admin.query(
      `update tenant_roles set leads = true where tenant_id = $1 and key = 'lead'`,
      [north],
    )

    // And somebody shut out of the tenant does not lead it for anybody.
    await admin.query(
      'update memberships set blocked_at = now() where tenant_id = $1 and user_id = $2',
      [north, idOf(otto)],
    )

    expect(await leadsOfNorth()).toEqual([lea.name, mia.name])
  })

  it('lists an invitation to lead only while it can still be taken up', async () => {
    await admin.query('update invitations set revoked_at = now() where tenant_id = $1', [south])

    expect((await tenantsAsSeen()).find((tenant) => tenant.id === south)?.invitedLeads).toEqual([])
  })

  it('stands in the log of the instance with the way it came in and who brought it', async () => {
    const page = await log()
    const created = page.changes.filter(
      (change) => change.table === 'tenants' && change.operation === 'insert',
    )
    const byName = new Map(created.map((change) => [page.titles[change.recordId]?.title, change]))

    expect(byName.get('Mandant Nord')?.reason).toBe('instance.setup')
    // The first run has nobody yet: the account comes into being with it.
    expect(byName.get('Mandant Nord')?.userId).toBeNull()
    expect(byName.get('Mandant Zweig')?.reason).toBe('tenant.create')
    expect(byName.get('Mandant Zweig')?.userId).toBe(idOf(lea))
    expect(byName.get('Mandant Süd')?.reason).toBe('instance.tenant')
    expect(byName.get('Mandant Süd')?.userId).toBe(idOf(lea))
  })
})

describe('a further tenant from the command line', () => {
  it('says how it is called, and where a password comes from', async () => {
    const usage = await refusal(addingTenant({ arguments: ['Mandant West'], environment }))

    expect(usage.split('\n')[0]).toBe(sentences.addTenant.usage)
    expect(usage).toContain('PROBEWERK_PASSWORD')
  })

  it('creates the tenant with an account that leads it, in the words of the application', async () => {
    const lines = await said(
      addingTenant,
      ['  Mandant West ', 'wanda@west.example.de', 'Wanda West'],
      password,
    )
    const { rows } = await admin.query<{ id: TenantId; user_id: string; roles: string[] }>(
      `select t.id, m.user_id, m.roles from tenants t
         join memberships m on m.tenant_id = t.id
        where t.name = 'Mandant West'`,
    )
    const west = rows[0]

    expect(west?.roles).toEqual(['lead'])
    expect(lines).toEqual([
      `Der Mandant "Mandant West" ist angelegt, Kennung ${west?.id ?? ''}. ` +
        'wanda@west.example.de leitet ihn, mit einem neuen Konto.',
      // The role that leads asks for a second factor, and the command says so.
      'Für die Leitung eines Mandanten ist ein zweiter Faktor Pflicht.',
    ])

    // The account can sign in with the password the script handed over.
    expect(await instance.signIn('wanda@west.example.de', password)).not.toBe('')
    // And the tenant has its roles.
    expect(
      (await admin.query('select 1 from tenant_roles where tenant_id = $1', [west?.id])).rowCount,
    ).toBe(probeRoles.length)
  })

  it('keeps the password of an account that is there already, and asks for none', async () => {
    // No password in the environment and nobody at the terminal: asking for
    // one would stop the command.
    const lines = await said(addingTenant, ['Mandant Ost', lea.email, lea.name])

    expect(lines[0]).toContain('lea@nord.example.de leitet ihn; das Konto gab es schon.')
    expect(await instance.signIn(lea.email, password)).not.toBe('')
  })

  it('stops with the sentence of the application for a name that is none', async () => {
    expect(
      await refusal(said(addingTenant, ['M'.repeat(41), 'wanda@west.example.de', 'Wanda West'])),
    ).toBe('Der Name des Mandanten ist länger als 40 Zeichen.')

    const { rows } = await admin.query<{ name: string }>('select name from tenants order by name')

    expect(rows.map((row) => row.name)).toEqual([
      'Mandant Nord',
      'Mandant Ost',
      'Mandant Süd',
      'Mandant West',
      'Mandant Zweig',
    ])
  })
})
