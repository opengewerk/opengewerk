import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { newId } from '../database/identifier.js'
import { authenticationPath } from './authentication.js'
import type { ResetRequester } from './notices.js'
import {
  type ProbeFoundation,
  probeFoundation,
  type ProbeInstance,
  probeInstance,
  probeOrigin as origin,
} from './probe-application.js'
import { accountExists, addStaffMember, replacePassword } from './staff.js'

/**
 * A password somebody can change, get back through a link in a mail, and, as
 * the way back without a mail, have replaced on the command line (#126).
 * Before, none of the three existed: a generated password stayed valid for
 * good, and a forgotten one meant SQL on the server.
 *
 * How the link is sent is the application's; what is held here is that it is
 * handed over, once and to the account that asked.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const first = 'das-erste-lange-passwort'
const second = 'das-zweite-lange-passwort'

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance

/** What the mail with the link got, for the tests that follow the link. */
const links: { requester: ResetRequester; token: string }[] = []

function http() {
  return instance.http()
}

async function person(email: string, tenantId: TenantId = north.id): Promise<void> {
  await addStaffMember(instance.authentication, instance.database, {
    email,
    name: 'Paula Passwort',
    password: first,
    tenantId,
    roles: ['member'],
  })
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north])

  instance = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
    secret: 'w'.repeat(64),
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

describe('changing a password', () => {
  it('takes the old one as confirmation, and signs every other device out', async () => {
    await person('wechsel@nord.example.de')

    const here = await instance.signIn('wechsel@nord.example.de', first)
    const elsewhere = await instance.signIn('wechsel@nord.example.de', first)

    await http()
      .post(`${authenticationPath}/change-password`)
      .set('cookie', here)
      .set('origin', origin)
      .send({ currentPassword: first, newPassword: second, revokeOtherSessions: true })
      .expect(200)

    await http().get('/auth/tenants').set('cookie', elsewhere).expect(401)
    expect(await instance.signIn('wechsel@nord.example.de', first)).toBe('')
    expect(await instance.signIn('wechsel@nord.example.de', second)).not.toBe('')
  })

  it('refuses a new password shorter than twelve characters, as everywhere else', async () => {
    await person('kurz@nord.example.de')

    const here = await instance.signIn('kurz@nord.example.de', first)
    const refused = await http()
      .post(`${authenticationPath}/change-password`)
      .set('cookie', here)
      .set('origin', origin)
      .send({ currentPassword: first, newPassword: 'zu-kurz', revokeOtherSessions: true })

    expect(refused.status).toBe(400)
  })

  it('refuses without the old password', async () => {
    await person('ohne@nord.example.de')

    const here = await instance.signIn('ohne@nord.example.de', first)
    const refused = await http()
      .post(`${authenticationPath}/change-password`)
      .set('cookie', here)
      .set('origin', origin)
      .send({ currentPassword: 'geraten-und-falsch', newPassword: second })

    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(await instance.signIn('ohne@nord.example.de', first)).not.toBe('')
  })
})

describe('a link to a new password', () => {
  /** Asks for a link and waits for the mail, which the route does not await. */
  async function askFor(email: string): Promise<number> {
    const before = links.length
    const answer = await http()
      .post(`${authenticationPath}/request-password-reset`)
      .set('origin', origin)
      .send({ email })

    await vi.waitFor(() => {
      expect(links.length).toBeGreaterThanOrEqual(before)
    })

    return answer.status
  }

  it('is handed over for an account, and answered the same for an address without one', async () => {
    await person('vergessen@nord.example.de')

    const before = links.length

    expect(await askFor('niemand@nord.example.de')).toBe(200)
    expect(links.length).toBe(before)

    expect(await askFor('vergessen@nord.example.de')).toBe(200)
    await vi.waitFor(() => {
      expect(links.at(-1)?.requester.email).toBe('vergessen@nord.example.de')
    })
  })

  it('sets a new password once, and ends every session that was open', async () => {
    await person('link@nord.example.de')

    const open = await instance.signIn('link@nord.example.de', first)

    await askFor('link@nord.example.de')
    await vi.waitFor(() => {
      expect(links.at(-1)?.requester.email).toBe('link@nord.example.de')
    })

    const token = links.at(-1)?.token ?? ''

    await http()
      .post(`${authenticationPath}/reset-password`)
      .set('origin', origin)
      .send({ token, newPassword: second })
      .expect(200)

    await http().get('/auth/tenants').set('cookie', open).expect(401)
    expect(await instance.signIn('link@nord.example.de', second)).not.toBe('')

    const again = await http()
      .post(`${authenticationPath}/reset-password`)
      .set('origin', origin)
      .send({ token, newPassword: 'noch-ein-anderes-passwort' })

    expect(again.status).toBeGreaterThanOrEqual(400)
  })

  it('is answered the same on an instance that sends no mail, and nothing is handed over', async () => {
    const quiet = await probeInstance(foundation.kit.applicationDatabaseUrl(), {
      secret: 'v'.repeat(64),
    })

    try {
      await person('still@nord.example.de')

      const before = links.length
      const answer = await quiet
        .http()
        .post(`${authenticationPath}/request-password-reset`)
        .set('origin', origin)
        .send({ email: 'still@nord.example.de' })

      expect(answer.status).toBe(200)
      expect(links.length).toBe(before)
    } finally {
      await quiet.close()
    }
  })
})

describe('the way back on the command line', () => {
  it('replaces the password, ends every session, and says when there is no such account', async () => {
    await person('konsole@nord.example.de')

    // Asked before the question for the new password.
    expect(await accountExists(instance.database, ' Konsole@nord.example.de ')).toBe(true)
    expect(await accountExists(instance.database, 'gibt-es-nicht@nord.example.de')).toBe(false)

    const open = await instance.signIn('konsole@nord.example.de', first)

    expect(
      await replacePassword(instance.authentication, instance.database, {
        email: 'Konsole@nord.example.de',
        password: second,
      }),
    ).toBe(true)
    await http().get('/auth/tenants').set('cookie', open).expect(401)
    expect(await instance.signIn('konsole@nord.example.de', second)).not.toBe('')
    expect(
      await replacePassword(instance.authentication, instance.database, {
        email: 'gibt-es-nicht@nord.example.de',
        password: second,
      }),
    ).toBe(false)
  })
})
