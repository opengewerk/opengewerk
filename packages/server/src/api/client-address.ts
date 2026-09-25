import { isInternalAddress } from '../mail/reach.js'

/** The parts of a request the address is read from. */
export interface AddressedRequest {
  readonly socket: { readonly remoteAddress?: string | undefined }
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
}

/**
 * Where a request comes from, as far as this instance can tell, for a limit
 * per address.
 *
 * An installation runs behind a reverse proxy on the same machine, so the
 * connection itself comes from the proxy, or from the gateway of the Docker
 * network in front of it, for every request alike. A limit on that address
 * would be one limit for everybody, and one stranger could lock the operator
 * out with a handful of requests. When the connection comes from inside some
 * network, the address is therefore the last entry of `X-Forwarded-For`: the
 * one the proxy directly in front added itself, and the one a client cannot
 * write, because a proxy appends to what the client sent.
 *
 * A connection from the internet is taken by its own address, and a header it
 * brings is ignored: a client talking to the instance directly could write
 * anything there. Where the header cannot be trusted either, because nothing
 * in front sets it, a limit per address is only as good as that; whatever
 * uses this keeps a limit over all addresses as well.
 */
export function clientAddress(request: AddressedRequest): string {
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

  return nearest ?? peer
}
