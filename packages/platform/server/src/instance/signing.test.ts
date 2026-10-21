import { createHash, verify, X509Certificate } from 'node:crypto'

import type { InstanceSigningState, TenantId } from '@opengewerk/platform-domain'
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
import { Database } from '../database/database.js'
import { SecretKey } from '../secrets/key.js'
import { childrenOf, contentsOf } from '../signing/der.js'
import { signDetached } from '../signing/signing.js'
import {
  instanceCertificates,
  instanceSigningKey,
  readInstanceSigning,
  type SigningContext,
} from './signing.js'

/**
 * The key the instance signs PDFs with (opengewerk-haustechnik#457): made
 * once with the first PDF, sealed and never in the log of the instance, a
 * certificate the key signs for itself, a CMS signature that stands for its
 * content, and a new key only from whoever runs the instance, with the
 * certificate before kept.
 */

const password = 'ein-ordentlich-langes-passwort'
const setupCode = 'K7Q4-9PXM'

/** Sets the instance up, and so runs it. */
const lea = { email: 'lea@nord.example.de', name: 'Lea Leitung' }
/** Leads the first tenant, and runs nothing. */
const otto = { email: 'otto@nord.example.de', name: 'Otto Zweitleitung' }

const key = SecretKey.from('s'.repeat(64))
const signing: SigningContext = {
  key,
  subject: { commonName: 'instanz.example.de', organisation: 'Probewerk' },
}

let foundation: ProbeFoundation
let admin: Pool
let instance: ProbeInstance
let visitors: ProbeVisitors
let database: Database

const signedIn = new Map<string, string>()

function get(path: string, person?: { email: string }) {
  const asking = instance.http().get(path)

  return person ? asking.set('cookie', signedIn.get(person.email) ?? '') : asking
}

function post(path: string, person: { email: string }) {
  return instance
    .http()
    .post(path)
    .set('cookie', signedIn.get(person.email) ?? '')
    .set('origin', origin)
    .send({})
}

async function state(): Promise<InstanceSigningState> {
  return (await get('/instance/signing', lea).expect(200)).body as InstanceSigningState
}

/** The columns as the database keeps them. */
async function kept(): Promise<{
  signing_key: string | null
  signing_certificate: string | null
  signing_earlier: string[]
}> {
  const { rows } = await admin.query<{
    signing_key: string | null
    signing_certificate: string | null
    signing_earlier: string[]
  }>('select signing_key, signing_certificate, signing_earlier from instance_settings')

  return rows[0] as never
}

/**
 * What the log of the instance says about the signature: field, reason and
 * who. The row the test kit writes for the settings is left out.
 */
async function logged(): Promise<
  { field: string; reason: string | null; user_id: string | null }[]
> {
  const { rows } = await admin.query<{
    field: string
    reason: string | null
    user_id: string | null
  }>(
    `select field, reason, user_id from instance_changes
      where table_name = 'instance_settings' and field like 'signing%'
        and reason is distinct from 'migration'
      order by id`,
  )

  return rows
}

/**
 * The extensions of a certificate by the bytes of their identifier: the
 * value in hexadecimal digits, after `ff:` where the extension is critical.
 */
function extensionsOf(certificate: Buffer): Record<string, string> {
  const tbs = childrenOf(childrenOf(certificate)[0] as Buffer)
  const wrapped = tbs.find((each) => each[0] === 0xa3) as Buffer
  const extensions = childrenOf(childrenOf(wrapped)[0] as Buffer)

  return Object.fromEntries(
    extensions.map((extension) => {
      const parts = childrenOf(extension)
      const value = contentsOf(parts.at(-1) as Buffer).toString('hex')

      return [
        contentsOf(parts[0] as Buffer).toString('hex'),
        parts.length === 3 ? `ff:${value}` : value,
      ]
    }),
  )
}

/** Whether `cms` is a signature over `content` by the key of the certificate it carries, and which certificate. */
function verified(cms: Buffer, content: Buffer): X509Certificate | null {
  const [, wrapped] = childrenOf(cms)
  const signedData = childrenOf(childrenOf(wrapped as Buffer)[0] as Buffer)
  const certificate = new X509Certificate(childrenOf(signedData[3] as Buffer)[0] as Buffer)
  const signer = childrenOf(childrenOf(signedData[4] as Buffer)[0] as Buffer)
  const attributes = Buffer.from(signer[3] as Buffer)
  const named = new Map(
    childrenOf(attributes).map((each) => {
      const [type, values] = childrenOf(each)

      return [contentsOf(type as Buffer).toString('hex'), childrenOf(values as Buffer)[0] as Buffer]
    }),
  )
  // messageDigest and signing-certificate-v2, by the bytes of their identifiers.
  const digest = named.get('2a864886f70d010904')
  const certificateHash = named.get('2a864886f70d010910022f')

  attributes[0] = 0x31

  const signedOver =
    digest !== undefined &&
    contentsOf(digest).equals(createHash('sha256').update(content).digest()) &&
    certificateHash !== undefined &&
    contentsOf(
      childrenOf(childrenOf(childrenOf(certificateHash)[0] as Buffer)[0] as Buffer)[0] as Buffer,
    ).equals(createHash('sha256').update(certificate.raw).digest())

  return signedOver &&
    verify('sha256', attributes, certificate.publicKey, contentsOf(signer[5] as Buffer))
    ? certificate
    : null
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()

  const url = foundation.kit.applicationDatabaseUrl()

  database = Database.connect(url)
  instance = await probeInstance(url, { setupCode, signing })
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
  await database.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('who reaches the signature of the instance', () => {
  it('is whoever runs the instance, and there is no key at first', async () => {
    expect(await state()).toEqual({ signs: true, certificate: null })
  })

  it('is nobody who leads a tenant and does not run the instance, and nobody who is not signed in', async () => {
    await get('/instance/signing').expect(401)
    await get('/instance/signing', otto).expect(403)
    await post('/instance/signing', otto).expect(403)

    expect(await kept()).toMatchObject({ signing_key: null, signing_certificate: null })
  })
})

describe('the first key', () => {
  it('is made once, with the first PDF, however many ask at the same moment', async () => {
    const asked = await Promise.all([1, 2, 3].map(() => instanceSigningKey(database, signing)))
    const again = await instanceSigningKey(database, signing)

    expect(new Set(asked.map((each) => each.certificate.toString('base64'))).size).toBe(1)
    expect(again.certificate.equals(asked[0]?.certificate as Buffer)).toBe(true)
    expect((await kept()).signing_earlier).toEqual([])
  })

  it('is kept sealed, and the log of the instance names the certificate and never the key', async () => {
    const row = await kept()

    expect(row.signing_key).not.toBeNull()
    expect(row.signing_key).not.toContain('PRIVATE KEY')
    expect(key.unseal('instance:signing', row.signing_key as string)).toContain('PRIVATE KEY')
    expect(key.unseal('instance:mail-server', row.signing_key as string)).toBeNull()
    expect(await logged()).toEqual([
      { field: 'signing_certificate', reason: 'instance.signing', user_id: null },
      { field: 'signing_since', reason: 'instance.signing', user_id: null },
    ])
  })

  it('has a certificate it signed for itself, on the address and the name it was given, for twenty years, to sign and to stand by, and no authority', async () => {
    const { certificate } = await instanceSigningKey(database, signing)
    const read = new X509Certificate(certificate)
    const shown = await state()

    expect(read.subject).toBe('O=Probewerk\nCN=instanz.example.de')
    expect(read.issuer).toBe(read.subject)
    expect(read.verify(read.publicKey)).toBe(true)
    // basicConstraints without cA, and keyUsage, critical, digitalSignature and nonRepudiation.
    expect(extensionsOf(certificate)).toEqual({
      '551d13': '3000',
      '551d0f': 'ff:030206c0',
    })
    expect(
      new Date(read.validTo).getUTCFullYear() - new Date(read.validFrom).getUTCFullYear(),
    ).toBe(20)
    expect(shown.certificate).toMatchObject({
      commonName: 'instanz.example.de',
      organisation: 'Probewerk',
      fingerprint: read.fingerprint256,
      readable: true,
      earlier: 0,
    })
  })
})

describe('a signature of the instance', () => {
  it('stands for exactly the content it was made over, by the certificate it carries', async () => {
    const signer = await instanceSigningKey(database, signing)
    const content = Buffer.from('%PDF-1.7 die Bytes eines Drucks')
    const cms = signDetached(signer, content)
    const by = verified(cms, content)

    expect(by?.raw.equals(signer.certificate)).toBe(true)
    expect(verified(cms, Buffer.from('%PDF-1.7 die Bytes eines Druckz'))).toBeNull()
  })
})

describe('a new key', () => {
  it('comes from whoever runs the instance, and the certificate before stays known', async () => {
    const before = await instanceSigningKey(database, signing)
    const renewed = (await post('/instance/signing', lea).expect(200)).body as InstanceSigningState
    const now = await instanceSigningKey(database, signing)

    expect(now.certificate.equals(before.certificate)).toBe(false)
    expect(renewed.certificate).toMatchObject({
      fingerprint: new X509Certificate(now.certificate).fingerprint256,
      earlier: 1,
    })
    expect(await instanceCertificates(database)).toEqual([now.certificate, before.certificate])
    expect((await logged()).at(-1)).toMatchObject({ reason: 'instance.signing' })
    expect((await logged()).at(-1)?.user_id).not.toBeNull()
  })

  it('comes by itself when the kept one no longer opens, because SESSION_SECRET was changed', async () => {
    const other: SigningContext = { ...signing, key: SecretKey.from('t'.repeat(64)) }
    const before = await instanceCertificates(database)

    expect(await readInstanceSigning(database, other)).toMatchObject({ readable: false })

    const made = await instanceSigningKey(database, other)

    expect(await instanceCertificates(database)).toEqual([made.certificate, ...before])
    expect(await readInstanceSigning(database, other)).toMatchObject({ readable: true, earlier: 2 })
  })
})

describe('an instance whose application signs nothing', () => {
  it('says so, and makes no key', async () => {
    const plain = await probeInstance(foundation.kit.applicationDatabaseUrl(), { setupCode })
    const cookie = signedIn.get(lea.email) ?? ''
    const before = await kept()

    try {
      expect(
        (await plain.http().get('/instance/signing').set('cookie', cookie).expect(200)).body,
      ).toEqual({ signs: false, certificate: null })
      await plain
        .http()
        .post('/instance/signing')
        .set('cookie', cookie)
        .set('origin', origin)
        .send({})
        .expect(404)
    } finally {
      await plain.close()
    }

    expect(await kept()).toEqual(before)
  })
})
