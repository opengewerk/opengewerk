import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto'

import {
  bits,
  boolean,
  childrenOf,
  element,
  integer,
  octets,
  oid,
  sequence,
  set,
  time,
  unsigned,
  utf8,
} from './der.js'

/** Whom a certificate of the instance names. Both come from the application. */
export interface CertificateSubject {
  /** The address the instance is reached at, as its host. */
  readonly commonName: string
  /** What runs there: the name of the application. */
  readonly organisation: string
}

/** A key of the instance with the certificate it gave itself for it. */
export interface SigningKey {
  readonly privateKey: KeyObject
  /** The certificate, DER. */
  readonly certificate: Buffer
}

/** How long a certificate of the instance holds. A new key can be made at any time before. */
export const certificateYears = 20

const ecdsaWithSha256 = sequence(oid('1.2.840.10045.4.3.2'))
const sha256 = sequence(oid('2.16.840.1.101.3.4.2.1'))
const data = oid('1.2.840.113549.1.7.1')

function nameOf(subject: CertificateSubject): Buffer {
  return sequence(
    set(sequence(oid('2.5.4.10'), utf8(subject.organisation))),
    set(sequence(oid('2.5.4.3'), utf8(subject.commonName))),
  )
}

/**
 * A new key, ECDSA on P-256, and a certificate the key signs for itself: no
 * authority, both names the same, valid from a minute ago for twenty years,
 * for signing and for standing by what was signed, and no CA.
 */
export function newSigningKey(subject: CertificateSubject, now = new Date()): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const name = nameOf(subject)
  const from = new Date(Math.floor(now.getTime() / 1000) * 1000 - 60_000)
  const to = new Date(from)

  to.setUTCFullYear(from.getUTCFullYear() + certificateYears)

  // Sixteen random bytes, the first bit cleared so that the number stays positive and no byte is lost.
  const serial = randomBytes(16)

  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40

  const extensions = element(
    0xa3,
    sequence(
      // basicConstraints: no authority.
      sequence(oid('2.5.29.19'), octets(sequence())),
      // keyUsage, critical: digitalSignature and nonRepudiation.
      sequence(oid('2.5.29.15'), boolean(true), octets(bits(Buffer.from([0xc0]), 6))),
    ),
  )
  const tbs = sequence(
    element(0xa0, integer(2)),
    unsigned(serial),
    ecdsaWithSha256,
    name,
    sequence(time(from), time(to)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  )

  return {
    privateKey,
    certificate: sequence(tbs, ecdsaWithSha256, bits(sign('sha256', tbs, privateKey))),
  }
}

/**
 * A CMS signature over `content` that leaves the content out, as PAdES puts
 * it into a PDF (ETSI EN 319 142-1, level B-B): the signed attributes name
 * the type of the content, its SHA-256 and the certificate by its SHA-256
 * (signing-certificate-v2), and carry no time. The moment of signing stands
 * in the signature dictionary of the PDF, not here.
 */
export function signDetached(key: SigningKey, content: Uint8Array): Buffer {
  const [tbs] = childrenOf(key.certificate)
  const fields = childrenOf(tbs as Buffer)
  const serial = fields[1] as Buffer
  const issuer = fields[3] as Buffer
  const attributes = set(
    sequence(oid('1.2.840.113549.1.9.3'), set(data)),
    sequence(
      oid('1.2.840.113549.1.9.4'),
      set(octets(createHash('sha256').update(content).digest())),
    ),
    sequence(
      oid('1.2.840.113549.1.9.16.2.47'),
      set(
        sequence(sequence(sequence(octets(createHash('sha256').update(key.certificate).digest())))),
      ),
    ),
  )
  const signature = sign('sha256', attributes, key.privateKey)
  // The same set, under the tag it carries inside SignerInfo.
  const signedAttributes = Buffer.from(attributes)

  signedAttributes[0] = 0xa0

  const signerInfo = sequence(
    integer(1),
    sequence(issuer, serial),
    sha256,
    signedAttributes,
    ecdsaWithSha256,
    octets(signature),
  )

  return sequence(
    oid('1.2.840.113549.1.7.2'),
    element(
      0xa0,
      sequence(
        integer(1),
        set(sha256),
        sequence(data),
        element(0xa0, key.certificate),
        set(signerInfo),
      ),
    ),
  )
}
