import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { newId } from '../database/identifier.js'
import { authenticationPath } from './authentication.js'
import type { ResetRequester } from './notices.js'
import { waitingAfterReset } from './password-resets.js'
import {
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
} from './probe-application.js'
import { addStaffMember, replacePassword } from './staff.js'

/**
 * Every new password stands in the log of every tenant the account works in,
 * and an account sets up no second factor for a day after one
 * (opengewerk-haustechnik#360).
 *
 * The link to a new password goes out through the mail server of the
 * instance, and whoever runs the instance sets that up. What is held here is
 * that whoever leads a tenant sees each reset, through the link or on the
 * command line, when and whose and never with the link, and that whoever
 * chose the new password does not give the account an app or a passkey of
 * their own before anybody could notice.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }
const first = 'das-erste-lange-passwort'
const second = 'das-zweite-lange-passwort'

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance

/** What the mail with the link got. */
const links: { requester: ResetRequester; token: string }[] = []

function http() {
  return instance.http()
}

/** Somebody who works in both tenants, and their id. */
async function person(email: string): Promise<string> {
  for (const tenantId of [north.id, south.id]) {
    await addStaffMember(instance.authentication, instance.database, {
      email,
      name: 'Paula Passwort',
      password: first,
      tenantId,
      roles: ['member'],
    })
  }

  const { rows } = await admin.query<{ id: string }>('select id from auth_users where email = $1', [
    email,
  ])

  return rows[0]?.id ?? ''
}

/** A new password through the link, as the form after the mail sends it. */
async function resetThroughTheLink(email: string): Promise<string> {
  await http()
    .post(`${authenticationPath}/request-password-reset`)
    .set('origin', origin)
    .send({ email })
    .expect(200)
  await vi.waitFor(() => {
    expect(links.at(-1)?.requester.email).toBe(email)
  })

  const token = links.at(-1)?.token ?? ''

  await http()
    .post(`${authenticationPath}/reset-password`)
    .set('origin', origin)
    .send({ token, newPassword: second })
    .expect(200)

  return token
}

/** The resets each tenant keeps of a person, by tenant. */
async function resetsOf(userId: string): Promise<Record<string, number>> {
  const { rows } = await admin.query<{ tenant_id: string; count: string }>(
    `select tenant_id, count(*) as count from password_resets where user_id = $1
      group by tenant_id`,
    [userId],
  )

  return Object.fromEntries(rows.map((row) => [row.tenant_id, Number(row.count)]))
}

function post(path: string, cookies: string) {
  return http().post(`${authenticationPath}${path}`).set('cookie', cookies).set('origin', origin)
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north, south])

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
    secret: 'r'.repeat(64),
    passwordResetMail: (requester, token) => {
      links.push({ requester, token })

      return Promise.resolve()
    },
  })
})

afterAll(async () => {
  await instance.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('a new password in the log of every tenant', () => {
  it('stands there once it came through the link, whose and when, and never with the token', async () => {
    const pia = await person('pia@nord.example.de')
    const token = await resetThroughTheLink('pia@nord.example.de')

    expect(await resetsOf(pia)).toEqual({ [north.id]: 1, [south.id]: 1 })

    const { rows: entries } = await admin.query<{
      tenant_id: string
      user_id: string | null
      reason: string | null
      field: string
    }>(
      `select tenant_id, user_id, reason, field from audit_entries
        where table_name = 'password_resets' and operation = 'insert'`,
    )

    expect(new Set(entries.map((entry) => entry.tenant_id))).toEqual(new Set([north.id, south.id]))
    expect(
      new Set(entries.map((entry) => `${String(entry.user_id)} ${String(entry.reason)}`)),
    ).toEqual(new Set([`${pia} password.reset`]))
    expect(entries.map((entry) => entry.field)).toContain('reset_at')

    // Neither in the rows nor anywhere in the log of either tenant.
    const everything = JSON.stringify([
      (await admin.query('select * from password_resets')).rows,
      (await admin.query('select * from audit_entries')).rows,
    ])

    expect(token).not.toBe('')
    expect(everything).not.toContain(token)
  })

  it('stands there as well once it was set on the command line', async () => {
    const otto = await person('otto@nord.example.de')

    expect(
      await replacePassword(instance.authentication, instance.database, {
        email: 'otto@nord.example.de',
        password: second,
      }),
    ).toBe(true)
    expect(await resetsOf(otto)).toEqual({ [north.id]: 1, [south.id]: 1 })
  })

  it('does not stand there for a password changed with the old one', async () => {
    const wim = await person('wim@nord.example.de')
    const cookies = await instance.signIn('wim@nord.example.de', first)

    await post('/change-password', cookies)
      .send({ currentPassword: first, newPassword: second, revokeOtherSessions: true })
      .expect(200)

    expect(await resetsOf(wim)).toEqual({})
  })
})

describe('a second factor after a new password', () => {
  it('is refused for a day, the app and a passkey alike, with the reason', async () => {
    await person('lisa@nord.example.de')
    await resetThroughTheLink('lisa@nord.example.de')

    const cookies = await instance.signIn('lisa@nord.example.de', second)
    const app = await post('/two-factor/enable', cookies)
      .send({ password: second, method: 'totp' })
      .expect(403)

    expect(app.body).toMatchObject({ code: 'PASSWORD_RECENTLY_RESET', message: waitingAfterReset })

    await post('/reconfirm', cookies).send({ password: second }).expect(200)

    const passkey = await http()
      .get(`${authenticationPath}/passkey/generate-register-options`)
      .set('cookie', cookies)
      .set('origin', origin)
      .expect(403)

    expect(passkey.body).toMatchObject({ code: 'PASSWORD_RECENTLY_RESET' })
  })

  it('is set up again once the day is over', async () => {
    const lisa = (
      await admin.query<{ id: string }>('select id from auth_users where email = $1', [
        'lisa@nord.example.de',
      ])
    ).rows[0]?.id

    await admin.query(
      `update password_resets set reset_at = now() - interval '24 hours 1 minute'
        where user_id = $1`,
      [lisa],
    )

    const cookies = await instance.signIn('lisa@nord.example.de', second)

    await post('/two-factor/enable', cookies).send({ password: second, method: 'totp' }).expect(200)
  })

  it('waits as long as the newest reset in any tenant says', async () => {
    const lisa = (
      await admin.query<{ id: string }>('select id from auth_users where email = $1', [
        'lisa@nord.example.de',
      ])
    ).rows[0]?.id

    // One tenant has an old reset and the other a fresh one.
    await admin.query(
      `insert into password_resets (tenant_id, user_id, reset_at) values ($1, $2, now())`,
      [south.id, lisa],
    )

    const cookies = await instance.signIn('lisa@nord.example.de', second)

    await post('/two-factor/enable', cookies).send({ password: second, method: 'totp' }).expect(403)
  })

  it('waits for nobody whose own password was not reset, whoever else in the tenant it was', async () => {
    // Wim works in both tenants, where Lisa's reset is fresh, and changed his
    // password with the old one.
    const cookies = await instance.signIn('wim@nord.example.de', second)

    await post('/two-factor/enable', cookies).send({ password: second, method: 'totp' }).expect(200)
  })
})
