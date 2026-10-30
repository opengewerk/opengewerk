import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import type { AccountMessages } from '../instance/account-mail.js'
import { saveInstanceMailServer } from '../instance/mail-server.js'
import type { MailContext } from '../mail/context.js'
import { type FakeSmtpServer, fakeSmtpServer } from '../mail/test-smtp.js'
import { smtpTransport } from '../mail/transport.js'
import { SecretKey } from '../secrets/key.js'
import { addressNeedsMail, addressUnconfirmed } from './address-confirmation.js'
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
 * An address holds only once a mail reached it (N28 of the security audit,
 * opengewerk#754), end to end through HTTP with a mail server that answers.
 *
 * What it holds: a new address, one's own or one corrected by whoever leads a
 * tenant, waits for the link in a mail to it, and the old one holds until the
 * link is opened; the link sets it, confirmed, writes it into the log of
 * every tenant as whoever asked, ends a link to a new password and tells the
 * old address; a link discarded, spent or out of time changes nothing;
 * without a mail server no address changes; and an account found through its
 * address alone, by the appointment to run the instance, an invitation by
 * link or the command line, is found only through a confirmed one.
 *
 * The tests build on each other, in the order they stand.
 */

const password = 'ein-ordentlich-langes-passwort'
const setupCode = 'K7Q4-9PXM'
const key = SecretKey.from('a'.repeat(64))

const lea = { email: 'lea@nord.example.de', name: 'Lea Leitung' }
const bea = { email: 'bea@nord.example.de', name: 'Bea Beide' }
const nina = { email: 'nina@nord.example.de', name: 'Nina Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const messages: AccountMessages = {
  senderName: 'Probewerk',
  accountPath: '/konto',
  passwordReset: ({ link }) => ({ subject: 'Passwort', body: link }),
  passkeyAdded: ({ link }) => ({ subject: 'Passkey', body: link }),
  recoveryCodesRenewed: ({ link }) => ({ subject: 'Codes', body: link }),
  secondFactorChanged: ({ link }) => ({ subject: 'Faktor', body: link }),
  operatorsChanged: ({ link }) => ({ subject: 'Verwaltung', body: link }),
  mailServerChanged: ({ link }) => ({ subject: 'Mailserver', body: link }),
  addressConfirmation: ({ address, change, link }) => ({
    subject: change ? 'Neue Adresse zum Klick' : 'Adresse zum Klick',
    body: `${address} gilt mit diesem Link: ${link}`,
  }),
  addressChanged: ({ address }) => ({
    subject: 'Neue Adresse gilt',
    body: `Ihr Konto gilt jetzt für ${address}.`,
  }),
}

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let visitors: ProbeVisitors
let database: Database
let smtp: FakeSmtpServer
let north: TenantId
const ids = new Map<string, string>()

const idOf = (person: { email: string }) => ids.get(person.email) ?? ''
const message = (answer: { body: unknown }) => (answer.body as { message: string }).message

async function accountOf(userId: string): Promise<{ email: string; verified: boolean }> {
  const { rows } = await admin.query<{ email: string; verified: boolean }>(
    'select email, email_verified as verified from auth_users where id = $1',
    [userId],
  )

  return rows[0] as { email: string; verified: boolean }
}

/** The link in the last mail to an address, and the subject it came with. */
function lastMailTo(address: string): { subject: string; token: string | null } {
  const mail = [...smtp.received].reverse().find((each) => each.to.includes(address))
  const data = (mail?.data ?? '').replace(/=\r?\n/g, '')

  return {
    subject: /^Subject: (.*)$/m.exec(data)?.[1] ?? '',
    token: /\/adresse\/([A-Za-z0-9_-]{16,64})/.exec(data)?.[1] ?? null,
  }
}

function patch(path: string, cookies: string, body: object) {
  return instance.http().patch(path).set('cookie', cookies).set('origin', origin).send(body)
}

function post(path: string, cookies: string, body: object = {}) {
  return instance.http().post(path).set('cookie', cookies).set('origin', origin).send(body)
}

/** The corrections of an account as the log of a tenant has them, with reason and who. */
async function corrections(
  tenantId: TenantId,
  userId: string,
): Promise<
  {
    email_before: string | null
    email_after: string | null
    reason: string | null
    by: string | null
  }[]
> {
  const { rows } = await admin.query<{
    email_before: string | null
    email_after: string | null
    reason: string | null
    by: string | null
  }>(
    `select c.email_before, c.email_after, e.reason, e.user_id as by
       from account_corrections c
       join audit_entries e on e.record_id = c.id and e.field = 'email_after'
      where c.tenant_id = $1 and c.user_id = $2 and c.email_after is not null
      order by c.created_at`,
    [tenantId, userId],
  )

  return rows
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()

  const url = foundation.kit.applicationDatabaseUrl()

  smtp = await fakeSmtpServer()

  const mail: MailContext = {
    origin,
    key,
    connect: (configuration) => smtpTransport(configuration),
  }

  database = Database.connect(url)
  instance = await probeInstance(url, { setupCode, mail, accountMessages: messages })
  visitors = probeVisitors(instance, password)

  await instance
    .http()
    .post('/setup')
    .set('origin', origin)
    .send({ setupCode, company: 'Mandant Nord', name: lea.name, email: lea.email, password })
    .expect(201)

  const { rows } = await admin.query<{ id: TenantId }>('select id from tenants')

  north = rows[0]?.id as TenantId
  await foundation.tenants(admin, [south])

  for (const [person, tenantId] of [
    [bea, north],
    [bea, south.id],
    [nina, north],
  ] as const) {
    const { userId } = await addStaffMember(instance.authentication, instance.database, {
      ...person,
      password,
      tenantId,
      roles: ['member'],
    })

    ids.set(person.email, userId)
  }

  // Lea leads the tenant next door as well, to invite into it.
  await addStaffMember(instance.authentication, instance.database, {
    ...lea,
    password,
    tenantId: south.id,
    roles: ['lead'],
  })

  const { rows: leas } = await admin.query<{ id: string }>(
    'select id from auth_users where email = $1',
    [lea.email],
  )

  ids.set(lea.email, leas[0]?.id ?? '')
  await visitors.setUpSecondFactor(lea.email)
}, 60_000)

afterAll(async () => {
  await instance.close()
  await database.close()
  await smtp.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('a new address without a mail server of the instance', () => {
  it('is refused, the address stays, and nothing waits', async () => {
    const cookies = await visitors.signIn(bea.email)

    await visitors.reconfirm(bea.email, cookies)
    const refused = await patch('/auth/account', cookies, {
      email: 'bea.neu@nord.example.de',
    }).expect(409)

    expect(message(refused)).toBe(addressNeedsMail)
    expect(await accountOf(idOf(bea))).toEqual({ email: bea.email, verified: true })
    expect(smtp.received).toEqual([])
    expect((await admin.query('select 1 from auth_address_confirmations')).rowCount).toBe(0)
  })
})

describe('a new address of one’s own', () => {
  beforeAll(async () => {
    await saveInstanceMailServer(database, idOf(lea), key, {
      host: '127.0.0.1',
      port: smtp.port,
      security: 'none',
      username: null,
      fromAddress: 'konten@nord.example.de',
    })
  })

  it('waits for the link in the mail to it, and the old one holds until then', async () => {
    const cookies = await visitors.signIn(bea.email)

    await visitors.reconfirm(bea.email, cookies)
    const asked = await patch('/auth/account', cookies, {
      email: ' Bea.Neu@Nord.example.de ',
    }).expect(200)

    expect(asked.body).toMatchObject({
      email: bea.email,
      pending: { email: 'bea.neu@nord.example.de' },
    })
    expect(await accountOf(idOf(bea))).toEqual({ email: bea.email, verified: true })
    expect(lastMailTo('bea.neu@nord.example.de')).toMatchObject({
      subject: 'Neue Adresse zum Klick',
      token: expect.any(String) as unknown,
    })
    expect(
      (await instance.http().get('/auth/account/address').set('cookie', cookies).expect(200)).body,
    ).toMatchObject({ email: 'bea.neu@nord.example.de' })
    // Signing in goes on with the address that holds.
    await visitors.signIn(bea.email)
  })

  it('is set by the link, confirmed, into the log of every tenant, and the old address is told', async () => {
    const { token } = lastMailTo('bea.neu@nord.example.de')
    const offer = await instance
      .http()
      .get(`/auth/address/${token ?? ''}`)
      .expect(200)

    expect(offer.body).toEqual({ state: 'open', name: bea.name, email: 'bea.neu@nord.example.de' })

    // A link to a new password that went to the old address.
    await admin.query(
      `insert into auth_verifications (id, identifier, value, expires_at)
       values ('reset-bea', 'reset-password:bea', $1, now() + interval '1 hour')`,
      [idOf(bea)],
    )

    const confirmed = await instance
      .http()
      .post(`/auth/address/${token ?? ''}`)
      .set('origin', origin)
      .expect(201)

    expect(confirmed.body).toEqual({ email: 'bea.neu@nord.example.de', changed: true })
    expect(
      (await admin.query(`select 1 from auth_verifications where id = 'reset-bea'`)).rowCount,
    ).toBe(0)
    expect(await accountOf(idOf(bea))).toEqual({ email: 'bea.neu@nord.example.de', verified: true })

    for (const tenantId of [north, south.id]) {
      expect(await corrections(tenantId, idOf(bea))).toEqual([
        {
          email_before: bea.email,
          email_after: 'bea.neu@nord.example.de',
          reason: 'account.own',
          by: idOf(bea),
        },
      ])
    }

    await expect.poll(() => lastMailTo(bea.email).subject).toBe('Neue Adresse gilt')
    // Spent: the same link a second time changes nothing.
    await instance
      .http()
      .post(`/auth/address/${token ?? ''}`)
      .set('origin', origin)
      .expect(410)
    await visitors.signIn('bea.neu@nord.example.de')
  })

  it('changes nothing through a link that was discarded, or that is out of time', async () => {
    const cookies = await visitors.signIn('bea.neu@nord.example.de')

    await visitors.reconfirm('bea.neu@nord.example.de', cookies)
    await patch('/auth/account', cookies, { email: 'bea.weg@nord.example.de' }).expect(200)

    const discarded = lastMailTo('bea.weg@nord.example.de').token ?? ''

    await instance
      .http()
      .delete('/auth/account/address')
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)
    await instance.http().post(`/auth/address/${discarded}`).set('origin', origin).expect(410)

    await visitors.reconfirm('bea.neu@nord.example.de', cookies)
    await patch('/auth/account', cookies, { email: 'bea.alt@nord.example.de' }).expect(200)
    await admin.query(
      `update auth_address_confirmations
          set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'`,
    )

    const late = lastMailTo('bea.alt@nord.example.de').token ?? ''

    expect((await instance.http().get(`/auth/address/${late}`).expect(200)).body).toMatchObject({
      state: 'gone',
    })
    await instance.http().post(`/auth/address/${late}`).set('origin', origin).expect(410)
    expect((await accountOf(idOf(bea))).email).toBe('bea.neu@nord.example.de')
  })

  it('is refused where another account has the address, before any mail goes', async () => {
    const cookies = await visitors.signIn(nina.email)
    const before = smtp.received.length

    await visitors.reconfirm(nina.email, cookies)
    const refused = await patch('/auth/account', cookies, {
      email: 'bea.neu@nord.example.de',
    }).expect(409)

    expect(message(refused)).toBe('Diese E-Mail-Adresse gehört schon zu einem anderen Konto.')
    expect(smtp.received.length).toBe(before)
  })
})

describe('an address corrected by whoever leads a tenant', () => {
  it('waits for the person, and the link writes it as whoever corrected it', async () => {
    const cookies = await visitors.workIn(lea.email, north)

    const corrected = await patch(`/staff/${idOf(nina)}/account`, cookies, {
      email: 'nina.neu@nord.example.de',
    }).expect(200)

    expect(corrected.body).toMatchObject({
      email: nina.email,
      pending: { email: 'nina.neu@nord.example.de' },
    })

    const listed = (await instance.http().get('/staff').set('cookie', cookies).expect(200))
      .body as { userId: string; pendingEmail: string | null }[]

    expect(listed.find((person) => person.userId === idOf(nina))?.pendingEmail).toBe(
      'nina.neu@nord.example.de',
    )

    const { token } = lastMailTo('nina.neu@nord.example.de')

    await instance
      .http()
      .post(`/auth/address/${token ?? ''}`)
      .set('origin', origin)
      .expect(201)
    expect(await corrections(north, idOf(nina))).toEqual([
      {
        email_before: nina.email,
        email_after: 'nina.neu@nord.example.de',
        reason: 'account.address',
        by: idOf(lea),
      },
    ])
  })

  it('is taken back by whoever leads before the link is opened', async () => {
    const cookies = await visitors.workIn(lea.email, north)

    await patch(`/staff/${idOf(nina)}/account`, cookies, {
      email: 'nina.anders@nord.example.de',
    }).expect(200)
    await instance
      .http()
      .delete(`/staff/${idOf(nina)}/account/address`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(200)

    const { token } = lastMailTo('nina.anders@nord.example.de')

    await instance
      .http()
      .post(`/auth/address/${token ?? ''}`)
      .set('origin', origin)
      .expect(410)
    expect((await accountOf(idOf(nina))).email).toBe('nina.neu@nord.example.de')
  })
})

describe('an account found through its address alone', () => {
  it('is appointed to run the instance only through a confirmed address', async () => {
    await admin.query('update auth_users set email_verified = false where id = $1', [idOf(nina)])

    const cookies = await visitors.signIn(lea.email)

    await visitors.reconfirm(lea.email, cookies)
    const refused = await post('/instance/operators', cookies, {
      email: 'nina.neu@nord.example.de',
    }).expect(409)

    expect(message(refused)).toBe(addressUnconfirmed)
    expect(
      (await admin.query('select 1 from instance_operators where user_id = $1', [idOf(nina)]))
        .rowCount,
    ).toBe(0)
  })

  it('is given work by the command line only through a confirmed address', async () => {
    await expect(
      addStaffMember(instance.authentication, instance.database, {
        email: 'nina.neu@nord.example.de',
        name: nina.name,
        password,
        tenantId: south.id,
        roles: ['member'],
      }),
    ).rejects.toThrow(addressUnconfirmed)
    expect(
      (
        await admin.query('select 1 from memberships where tenant_id = $1 and user_id = $2', [
          south.id,
          idOf(nina),
        ])
      ).rowCount,
    ).toBe(0)
  })

  it('confirms its address with a link to itself, and is found again', async () => {
    const cookies = await visitors.signIn('nina.neu@nord.example.de')

    await post('/auth/account/address', cookies).expect(201)

    const { subject, token } = lastMailTo('nina.neu@nord.example.de')

    expect(subject).toBe('Adresse zum Klick')

    const confirmed = await instance
      .http()
      .post(`/auth/address/${token ?? ''}`)
      .set('origin', origin)
      .expect(201)

    expect(confirmed.body).toEqual({ email: 'nina.neu@nord.example.de', changed: false })
    expect(await accountOf(idOf(nina))).toEqual({
      email: 'nina.neu@nord.example.de',
      verified: true,
    })
  })
})

describe('an invitation', () => {
  async function invite(
    email: string,
    tenantId: TenantId = north,
  ): Promise<{ id: string; token: string }> {
    const cookies = await visitors.workIn(lea.email, tenantId)
    const answer = await post('/staff', cookies, {
      email,
      name: 'Jo Join',
      roles: ['member'],
    }).expect(201)
    const body = answer.body as { token: string; invitation?: { id: string } }
    const { rows } = await admin.query<{ id: string }>(
      'select id from invitations where email = $1 order by created_at desc limit 1',
      [email],
    )

    return { id: rows[0]?.id ?? body.invitation?.id ?? '', token: body.token }
  }

  it('handed over as a link makes an account whose address is not confirmed', async () => {
    const { token } = await invite('jo@nord.example.de')

    await instance
      .http()
      .post(`/invitation/${token}`)
      .set('origin', origin)
      .send({ password: 'was-nur-jo-kennt-123' })
      .expect(201)

    const { rows } = await admin.query<{ verified: boolean }>(
      `select email_verified as verified from auth_users where email = 'jo@nord.example.de'`,
    )

    expect(rows[0]?.verified).toBe(false)
  })

  it('by link joins an account there only through a confirmed address, by mail it confirms it', async () => {
    const jo = await visitors.signIn('jo@nord.example.de', 'was-nur-jo-kennt-123')
    const byLink = await invite('jo@nord.example.de', south.id)
    const refused = await instance
      .http()
      .post(`/invitation/${byLink.token}`)
      .set('cookie', jo)
      .set('origin', origin)
      .send({})
      .expect(409)

    expect(message(refused)).toBe(addressUnconfirmed)

    // The same link, as a mail had brought it to the address.
    await admin.query(
      `insert into mail_outbox (tenant_id, kind, cause, invitation_id, sender_name,
                                recipient_address, subject, body, status, sent_at)
       values ($1, 'guest_invited', $2, $3, 'Probewerk', 'jo@nord.example.de', 'Einladung', 'Link',
               'sent', now())`,
      [south.id, `invitation:${byLink.id}`, byLink.id],
    )
    await instance
      .http()
      .post(`/invitation/${byLink.token}`)
      .set('cookie', jo)
      .set('origin', origin)
      .send({})
      .expect(201)

    const { rows } = await admin.query<{ verified: boolean }>(
      `select email_verified as verified from auth_users where email = 'jo@nord.example.de'`,
    )

    expect(rows[0]?.verified).toBe(true)
  })
})
