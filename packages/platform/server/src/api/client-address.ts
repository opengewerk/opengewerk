import { isIP } from 'node:net'

import type { NextFunction, Request, Response } from 'express'

import { ipv6Groups, isInternalAddress } from '../network/internal-address.js'

/** The parts of a request the address is read from. */
export interface AddressedRequest {
  readonly socket: { readonly remoteAddress?: string | undefined }
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
}

/**
 * Where a request comes from, as far as this instance can tell, for a limit
 * per address. The one place that decides it: the limits of the
 * authentication read it as well (`nameTheClient`).
 *
 * An installation runs behind a reverse proxy on the same machine, so the
 * connection itself comes from the proxy, or from the gateway of the Docker
 * network in front of it, for every request alike. When the connection comes
 * from inside some network, the address is therefore the last entry of
 * `X-Forwarded-For`: the one the proxy directly in front added itself, and the
 * one a client cannot write, because a proxy appends to what the client sent.
 * The README says how a proxy is told to append.
 *
 * Null when the connection comes from inside a network and nothing in front
 * names a client, or names something that is no address: the address of the
 * connection is then the proxy's, the same for everybody, and is not the
 * client's (opengewerk-haustechnik#360). A limit counts every such request in
 * one counter (`addressForLimits`).
 *
 * A connection from the internet is taken by its own address, and a header it
 * brings is ignored: a client talking to the instance directly could write
 * anything there. A proxy that hands the header on as the client sent it,
 * instead of appending to it, lets the client choose; that only the proxy can
 * change, which is why whatever uses this keeps a limit over all addresses as
 * well.
 */
export function clientAddress(request: AddressedRequest): string | null {
  const peer = request.socket.remoteAddress ?? ''

  if (peer !== '' && !isInternalAddress(peer)) {
    return peer
  }

  const header = request.headers['x-forwarded-for']
  const forwarded = typeof header === 'string' ? header : (header ?? []).join(',')
  const nearest = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .at(-1)

  return nearest !== undefined && isIP(nearest) !== 0 ? nearest : null
}

/**
 * The key a limit per address counts an address under
 * (opengewerk-haustechnik#360).
 *
 * An IPv4 address as it is. An IPv6 address by its /64: a connection at home
 * or on a phone is given a whole /64 to pick its addresses from, and a limit
 * per single address would hold only a client that does not bother to pick a
 * new one. An IPv4 address written as IPv6, mapped (`::ffff:192.0.2.1`) or
 * translated by NAT64 (`64:ff9b::192.0.2.1`), is the IPv4 address it carries;
 * cut to the /64 instead, every one of them would be the same key.
 *
 * Only the key: where the address itself is kept, it stays as it came.
 */
export function limitKey(address: string): string {
  const plain = address.split('%')[0] ?? address

  if (isIP(plain) !== 6) {
    return plain
  }

  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = ipv6Groups(plain)
  const mapped = a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff
  const translated = a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0

  if (mapped || translated) {
    return [g >> 8, g & 255, h >> 8, h & 255].map(String).join('.')
  }

  return `${[a, b, c, d].map((group) => group.toString(16)).join(':')}::/64`
}

/** The header the authentication reads the address of a client from, and only `nameTheClient` writes. */
export const clientAddressHeader = 'x-client-address'

/**
 * What stands for an address that is not known: in the header of the
 * authentication, which better-auth then takes for no address at all, and as
 * the key of a limit.
 */
export const unknownClientAddress = 'unknown'

/** Whether the log has been told about requests without an address yet. */
let reported = false

/**
 * Says once, in the log, that requests arrive whose address nobody named, and
 * what the proxy in front lacks. Once and not per request: a proxy that does
 * not append does so for every request, and a log with one line each would
 * bury everything else.
 */
function reportUnknownAddress(): void {
  if (reported) {
    return
  }

  reported = true
  console.warn(
    'Anfragen kommen ohne nutzbare Adresse an: Die Verbindung kommt aus dem eigenen Netz, ' +
      'und X-Forwarded-For fehlt oder nennt keine Adresse. Der Reverse Proxy muss den Header ' +
      'ergänzen, für nginx mit "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;" ' +
      '(README, Reverse Proxy). Bis dahin zählen alle diese Anfragen in einem gemeinsamen ' +
      'Zähler, und wenige Fehlversuche sperren die Anmeldung für alle.',
  )
}

/**
 * What a limit per address counts a request under (`limitKey`).
 *
 * A request whose address is not known counts under one key, the same for
 * every such request, and under the same limit as one address
 * (opengewerk-haustechnik#360). Never under none: then nothing would hold
 * somebody guessing. That a stranger can fill this counter for everybody
 * behind the same proxy is the smaller harm, and the setting of the proxy
 * that ends it is said in the log once (`reportUnknownAddress`).
 */
export function addressForLimits(request: AddressedRequest): string {
  const address = clientAddress(request)

  if (address === null) {
    reportUnknownAddress()

    return unknownClientAddress
  }

  return limitKey(address)
}

/**
 * Hands the authentication the address `clientAddress` determined, and no
 * other (opengewerk-haustechnik#360).
 *
 * better-auth reads `X-Forwarded-For` by itself, and not the way this instance
 * does: it takes the header only when it has exactly one entry. Behind a
 * proxy that appends, a request from a client that sent an entry of its own
 * has two, and better-auth counted it in the one counter it keeps for
 * requests without an address (`no-trusted-ip`), together with every other
 * such request. So it reads this header instead (`ipAddressHeaders`), and
 * whatever a client sent under the same name is replaced here before it gets
 * there. Where the address is not known, the header says so; better-auth
 * takes that for no address and counts the request in that one counter,
 * under the same limits as one address (`authentication.ts`), and the log
 * hears of it once.
 */
export function nameTheClient(request: Request, _response: Response, next: NextFunction): void {
  const address = clientAddress(request)

  if (address === null) {
    reportUnknownAddress()
  }

  request.headers[clientAddressHeader] = address ?? unknownClientAddress
  next()
}
