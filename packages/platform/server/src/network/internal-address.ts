import { BlockList, isIP } from 'node:net'

/**
 * Addresses that are not on the internet: this machine, the private ranges,
 * link-local, shared address space, benchmarking, multicast and reserved.
 * The services of an instance, the database and the renderer, sit in one of
 * them, and so does the network of whoever runs it.
 *
 * An IPv4 address written as IPv6, `::ffff:10.0.0.1`, is checked against the
 * IPv4 rules; `BlockList` does that by itself.
 */
const internal = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  internal.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  internal.addSubnet(network, prefix, 'ipv6')
}

/** The eight groups of an IPv6 address, `::` filled in. */
function groupsOf(address: string): readonly number[] {
  const [head = '', tail = ''] = address.split('::')
  const parse = (part: string) =>
    part === ''
      ? []
      : part.split(':').flatMap((group) => {
          // An IPv4 address at the end counts as the last two groups.
          if (group.includes('.')) {
            const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number)

            return [a * 256 + b, c * 256 + d]
          }

          return [Number.parseInt(group, 16)]
        })
  const front = parse(head)
  const back = address.includes('::') ? parse(tail) : []

  return [...front, ...Array<number>(8 - front.length - back.length).fill(0), ...back]
}

/**
 * Whether an address is inside some network rather than on the internet.
 *
 * Two things ask. What an instance connects to on behalf of a tenant, a mail
 * server or a push service, must be on the internet, or a tenant could point
 * the instance at its own database. And a request that arrives from inside a
 * network came through a proxy, so its address is the one the proxy names.
 *
 * NAT64 (`64:ff9b::/96`) carries an IPv4 address in its last 32 bits, and a
 * gateway translates it into exactly that address, so it is judged by the one
 * it carries. What is no address at all counts as internal: the direction a
 * mistake has to fail in is the closed one.
 */
export function isInternalAddress(address: string): boolean {
  const family = isIP(address)

  if (family === 4) {
    return internal.check(address, 'ipv4')
  }

  if (family !== 6) {
    return true
  }

  const groups = groupsOf(address)

  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  ) {
    const high = groups[6] ?? 0
    const low = groups[7] ?? 0

    return isInternalAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }

  return internal.check(address, 'ipv6')
}
