import {
  createDecipheriv,
  createECDH,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

import type { PushAnswer, PushPost } from './post.js'
import { toBase64Url, vapidKeysFrom, type VapidKeys } from './web-push.js'

/**
 * A browser for the tests of push (#284): the keys it subscribes with, and
 * reading a message the way a browser does, so that a test can say what a
 * device was actually shown.
 */
export function aBrowser() {
  const receiver = createECDH('prime256v1')
  receiver.generateKeys()
  const secret = randomBytes(16)

  return {
    keys: { p256dh: toBase64Url(receiver.getPublicKey()), auth: toBase64Url(secret) },
    read(body: Buffer): unknown {
      const salt = body.subarray(0, 16)
      const keyLength = body.readUInt8(20)
      const senderPublic = body.subarray(21, 21 + keyLength)
      const sealed = body.subarray(21 + keyLength)
      const shared = receiver.computeSecret(senderPublic)
      const keyInfo = Buffer.concat([
        Buffer.from('WebPush: info\0'),
        receiver.getPublicKey(),
        senderPublic,
      ])
      const keying = Buffer.from(hkdfSync('sha256', shared, secret, keyInfo, 32))
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

      return JSON.parse(padded.subarray(0, padded.length - 1).toString('utf8')) as unknown
    },
  }
}

/** A key to sign with, made for the test. */
export function testVapid(subject = 'https://opengewerk.example.de'): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

  return vapidKeysFrom(
    privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    subject,
  )
}

/** One request a push service was sent. */
export interface PostedPush {
  readonly endpoint: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Buffer
}

/** A push service that keeps what it is sent and answers what it is told to. */
export function recordingPost() {
  const posted: PostedPush[] = []
  let answer: PushAnswer | Error = { status: 201, retryAfter: null }

  const post: PushPost = (endpoint, headers, body) => {
    posted.push({ endpoint, headers, body })

    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }

  return {
    post,
    posted,
    answer: (next: PushAnswer | Error) => {
      answer = next
    },
  }
}
