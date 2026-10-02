import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, verify } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  encryptMessage,
  fromBase64Url,
  largestMessage,
  subscriptionKeysProblem,
  toBase64Url,
  vapidAuthorization,
  VapidKeyError,
  vapidKeysFrom,
} from './web-push.js'

/**
 * The example of RFC 8291, section 5 and appendix A: the same keys, salt and
 * secret give the same bytes, or the implementation is wrong.
 */
const example = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  receiverPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

/** What a browser does with a message: the receiving side of RFC 8291. */
function decrypt(body: Buffer, receiverPrivate: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16)
  const keyLength = body.readUInt8(20)
  const senderPublic = body.subarray(21, 21 + keyLength)
  const sealed = body.subarray(21 + keyLength)
  const receiver = createECDH('prime256v1')
  receiver.setPrivateKey(receiverPrivate)
  const shared = receiver.computeSecret(senderPublic)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    receiver.getPublicKey(),
    senderPublic,
  ])
  const keying = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const key = Buffer.from(
    hkdfSync('sha256', keying, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', keying, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )
  const decipher = createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  const padded = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ])

  expect(padded[padded.length - 1]).toBe(2)

  return padded.subarray(0, padded.length - 1).toString('utf8')
}

function aPrivateKey(curve: string): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: curve })

  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
}

describe('a message for one browser', () => {
  it('is the example of RFC 8291 byte for byte', () => {
    const body = encryptMessage(
      Buffer.from(example.plaintext),
      { p256dh: example.receiverPublic, auth: example.authSecret },
      {
        salt: fromBase64Url(example.salt),
        senderPrivateKey: fromBase64Url(example.senderPrivate),
      },
    )

    expect(toBase64Url(body)).toBe(example.body)
  })

  it('is read by the browser it was made for, with a fresh key every time', () => {
    const receiver = createECDH('prime256v1')
    receiver.generateKeys()
    const secret = Buffer.alloc(16, 7)
    const keys = { p256dh: toBase64Url(receiver.getPublicKey()), auth: toBase64Url(secret) }

    const first = encryptMessage(Buffer.from('{"title":"Heute fällig"}'), keys)
    const second = encryptMessage(Buffer.from('{"title":"Heute fällig"}'), keys)

    expect(decrypt(first, receiver.getPrivateKey(), secret)).toBe('{"title":"Heute fällig"}')
    expect(first.subarray(21, 86).equals(second.subarray(21, 86))).toBe(false)
  })

  it('is refused when it would not fit one record', () => {
    const keys = { p256dh: example.receiverPublic, auth: example.authSecret }

    expect(() => encryptMessage(Buffer.alloc(largestMessage + 1), keys)).toThrow(/at most/)
  })
})

describe('the keys a browser hands over', () => {
  it('are taken when they are a point on P-256 and a secret of 16 bytes', () => {
    expect(
      subscriptionKeysProblem({ p256dh: example.receiverPublic, auth: example.authSecret }),
    ).toBeNull()
  })

  it('are refused otherwise, with a sentence', () => {
    const notOnTheCurve = toBase64Url(Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]))

    expect(subscriptionKeysProblem({ p256dh: 'AAAA', auth: example.authSecret })).toMatch(
      /Form eines Punkts/,
    )
    expect(subscriptionKeysProblem({ p256dh: notOnTheCurve, auth: example.authSecret })).toMatch(
      /nicht auf P-256/,
    )
    expect(subscriptionKeysProblem({ p256dh: example.receiverPublic, auth: 'AAAA' })).toMatch(
      /16 Byte/,
    )
  })
})

describe('the signature for the push service', () => {
  it('comes from the private key in the .env, with its public half', () => {
    const keys = vapidKeysFrom(aPrivateKey('prime256v1'), 'https://msk.opengewerk.de')

    expect(fromBase64Url(keys.publicKey)).toHaveLength(65)
    expect(fromBase64Url(keys.publicKey)[0]).toBe(4)
  })

  it('takes the older SEC1 form too, which openssl genpkey writes as DER', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const sec1 = privateKey.export({ format: 'der', type: 'sec1' }).toString('base64')

    expect(fromBase64Url(vapidKeysFrom(sec1, 'https://x.example').publicKey)).toHaveLength(65)
  })

  it('refuses anything that is not a key on P-256', () => {
    expect(() => vapidKeysFrom('bitte-ersetzen', 'https://x.example')).toThrow(VapidKeyError)
    expect(() => vapidKeysFrom(aPrivateKey('secp384r1'), 'https://x.example')).toThrow(/P-256/)
  })

  it('is a token for the origin of the endpoint, twelve hours long, that the public key verifies', () => {
    const keys = vapidKeysFrom(aPrivateKey('prime256v1'), 'https://msk.opengewerk.de')
    const now = new Date('2037-09-24T06:00:00Z')
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', keys, now)
    const [, token = '', publicKey = ''] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? []
    const [head = '', claims = '', signature = ''] = token.split('.')

    expect(publicKey).toBe(keys.publicKey)
    expect(JSON.parse(fromBase64Url(head).toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(fromBase64Url(claims).toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
      sub: 'https://msk.opengewerk.de',
    })

    const [x, y] = [fromBase64Url(publicKey).subarray(1, 33), fromBase64Url(publicKey).subarray(33)]
    const verified = verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      {
        key: { kty: 'EC', crv: 'P-256', x: toBase64Url(x), y: toBase64Url(y) },
        format: 'jwk',
        dsaEncoding: 'ieee-p1363',
      },
      fromBase64Url(signature),
    )

    expect(verified).toBe(true)
  })
})
