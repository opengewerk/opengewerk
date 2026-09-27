import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  type KeyObject,
  randomBytes,
  sign,
} from 'node:crypto'

/**
 * Web Push by hand (#284): the message encrypted for one browser after RFC
 * 8291 and the request signed for its push service after RFC 8292, with what
 * Node brings and no package.
 *
 * Two small, finished standards, and the package that implements them pulls
 * in five more of its own for what `node:crypto` does in a few lines. Written
 * here, every step can be checked against the example in RFC 8291, which the
 * tests do byte for byte.
 */

/** Base64url without padding, the encoding of every key and token in both standards. */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export function fromBase64Url(text: string): Buffer {
  return Buffer.from(text, 'base64url')
}

/** What a browser hands over when it subscribes: its public key and a shared secret. */
export interface SubscriptionKeys {
  /** The browser's public key on P-256, uncompressed, 65 bytes in base64url. */
  readonly p256dh: string
  /** The authentication secret, 16 bytes in base64url. */
  readonly auth: string
}

/** Why a pair of keys from a browser cannot be used, or null when it can. */
export function subscriptionKeysProblem(keys: SubscriptionKeys): string | null {
  const publicKey = fromBase64Url(keys.p256dh)
  const secret = fromBase64Url(keys.auth)

  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    return 'Der öffentliche Schlüssel des Browsers hat nicht die Form eines Punkts auf P-256.'
  }

  if (secret.length !== 16) {
    return 'Das Geheimnis des Browsers ist nicht 16 Byte lang.'
  }

  try {
    // A point that is not on the curve is refused by the key agreement
    // itself, the same one every message will need.
    const probe = createECDH('prime256v1')
    probe.generateKeys()
    probe.computeSecret(publicKey)
  } catch {
    return 'Der öffentliche Schlüssel des Browsers liegt nicht auf P-256.'
  }

  return null
}

/**
 * The size of a record in the header. One record carries the whole message,
 * which is the only case the push services take anyway: they stop at around
 * four kilobytes.
 */
const recordSize = 4096

/** The largest message that still fits one record: the record less the tag and the delimiter. */
export const largestMessage = recordSize - 16 - 1

/**
 * A message encrypted for one browser, as the body of the request (RFC 8291,
 * content coding "aes128gcm" of RFC 8188).
 *
 * A fresh key pair and a fresh salt for every message, which is what keeps
 * two messages to the same browser from sharing a key. `fixed` exists for the
 * example of the RFC and for nothing else.
 */
export function encryptMessage(
  plaintext: Uint8Array,
  keys: SubscriptionKeys,
  fixed?: { readonly salt: Buffer; readonly senderPrivateKey: Buffer },
): Buffer {
  if (plaintext.length > largestMessage) {
    throw new Error(`A push message holds at most ${String(largestMessage)} bytes`)
  }

  const receiverPublic = fromBase64Url(keys.p256dh)
  const authSecret = fromBase64Url(keys.auth)
  const sender = createECDH('prime256v1')

  if (fixed) {
    sender.setPrivateKey(fixed.senderPrivateKey)
  } else {
    sender.generateKeys()
  }

  const senderPublic = sender.getPublicKey()
  const shared = sender.computeSecret(receiverPublic)
  const salt = fixed?.salt ?? randomBytes(16)

  // § 3.3: the shared secret and the browser's secret combined, bound to both
  // public keys, then the key and the nonce of the content coding from it.
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic])
  const keying = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const key = Buffer.from(
    hkdfSync('sha256', keying, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', keying, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )

  // The delimiter 2 marks the last and only record, without padding.
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(recordSize, 16)
  header.writeUInt8(senderPublic.length, 20)

  return Buffer.concat([header, senderPublic, sealed])
}

/** The key the instance signs with, its public half as a push service wants it, and whom to ask. */
export interface VapidKeys {
  readonly privateKey: KeyObject
  /** The public key, uncompressed, in base64url: what a browser subscribes with. */
  readonly publicKey: string
  /** Who runs the instance, for the operator of a push service: its address. */
  readonly subject: string
}

export class VapidKeyError extends Error {}

/**
 * The keys from the private key in the .env, PKCS #8 in base64 as setup.sh
 * writes it. Anything else, and a key on another curve, is refused.
 */
export function vapidKeysFrom(privateKeyBase64: string, subject: string): VapidKeys {
  let privateKey: KeyObject

  try {
    privateKey = createPrivateKey({
      key: Buffer.from(privateKeyBase64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    })
  } catch {
    throw new VapidKeyError('not a private key in PKCS #8')
  }

  if (
    privateKey.asymmetricKeyType !== 'ec' ||
    privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new VapidKeyError('not a key on the curve P-256')
  }

  const { x, y } = createPublicKey(privateKey).export({ format: 'jwk' })

  if (!x || !y) {
    throw new VapidKeyError('the public half could not be read')
  }

  return {
    privateKey,
    publicKey: toBase64Url(Buffer.concat([Buffer.from([4]), fromBase64Url(x), fromBase64Url(y)])),
    subject,
  }
}

/**
 * The header a push service checks the request against (RFC 8292): a token
 * for the origin of the endpoint, valid for twelve hours, signed with ES256,
 * and the public key it is checked with. A browser that subscribed with this
 * key takes messages only from whoever holds the private one.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date): string {
  const encode = (value: object) => toBase64Url(Buffer.from(JSON.stringify(value)))
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
    sub: keys.subject,
  })}`
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  })

  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`
}
