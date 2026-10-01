import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'

// The two things somebody holds in their hand when they sign in, built for a
// test: the authenticator app that shows a code, and the device that keeps a
// passkey. What the authentication checks is then a real code from a real
// secret and a real signature over a real challenge, and not a stand-in that
// agrees with anything.

/**
 * A code the way the authenticator app on somebody's phone would produce it.
 *
 * The secret arrives base32 encoded inside the address the app is fed, which
 * is the same address a setup screen turns into a picture. Decoding it back
 * to the string better-auth started from and asking the same generator it
 * checks against is the only way to measure this flow without a phone in the
 * room.
 */
export async function currentCode(totpUri: string): Promise<string> {
  const encoded = new URL(totpUri).searchParams.get('secret') ?? ''
  const secret = new TextDecoder().decode(base32.decode(encoded))

  return createOTP(secret, { digits: 6, period: 30 }).totp()
}

type Cbor = number | string | Uint8Array | ReadonlyMap<Cbor, Cbor>

/** The head of a CBOR item: major type and length, RFC 8949 section 3. */
function cborHead(major: number, length: number): Buffer {
  if (length < 24) {
    return Buffer.from([(major << 5) | length])
  }

  if (length < 256) {
    return Buffer.from([(major << 5) | 24, length])
  }

  const head = Buffer.alloc(3)
  head[0] = (major << 5) | 25
  head.writeUInt16BE(length, 1)

  return head
}

/** Just enough CBOR for an attestation object and a COSE key. */
function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value)
  }

  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8')

    return Buffer.concat([cborHead(3, bytes.length), bytes])
  }

  if (value instanceof Uint8Array) {
    return Buffer.concat([cborHead(2, value.length), Buffer.from(value)])
  }

  const parts = [cborHead(5, value.size)]

  for (const [key, entry] of value) {
    parts.push(cbor(key), cbor(entry))
  }

  return Buffer.concat(parts)
}

function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(counter)

  return bytes
}

/** The flags of authenticator data: user present, user verified, attested data. */
const present = 0x01
const verifiedByUser = 0x04
const attested = 0x40

/** Where an authenticator is used: the host a passkey is bound to and the page that asks. */
export interface AuthenticatorSite {
  /** The relying party, the host of the address the instance is reached at. */
  readonly relyingParty: string
  /** The address of the page, as the browser reports it in what it signs. */
  readonly origin: string
}

/**
 * A platform authenticator with one passkey, as Windows Hello or a phone
 * would be: it signs what it is given, and whether the person confirmed on
 * the device is a flag it sets or leaves out.
 */
export class TestAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  private readonly credentialId = randomBytes(16)
  private counter = 0

  constructor(private readonly site: AuthenticatorSite) {}

  get id(): string {
    return this.credentialId.toString('base64url')
  }

  /** What the browser sends back when a passkey is created for a challenge. */
  register(challenge: string, { userVerified = true } = {}) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' })
    const publicKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]),
    )
    const idLength = Buffer.alloc(2)
    idLength.writeUInt16BE(this.credentialId.length)

    const authenticatorData = Buffer.concat([
      sha256(this.site.relyingParty),
      Buffer.from([present | attested | (userVerified ? verifiedByUser : 0)]),
      counterBytes(0),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      publicKey,
    ])
    const clientData = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge,
        origin: this.site.origin,
        crossOrigin: false,
      }),
    )
    const attestation = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map<Cbor, Cbor>()],
        ['authData', authenticatorData],
      ]),
    )

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        attestationObject: attestation.toString('base64url'),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /** What the browser sends back when the passkey signs a challenge to sign in. */
  signIn(challenge: string, { userVerified = true } = {}) {
    this.counter += 1

    const authenticatorData = Buffer.concat([
      sha256(this.site.relyingParty),
      Buffer.from([present | (userVerified ? verifiedByUser : 0)]),
      counterBytes(this.counter),
    ])
    const clientData = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge,
        origin: this.site.origin,
        crossOrigin: false,
      }),
    )
    const signature = sign(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientData)]),
      this.keys.privateKey,
    )

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}
