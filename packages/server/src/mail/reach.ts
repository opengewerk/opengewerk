import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { isInternalAddress, type MailConfiguration } from '@opengewerk/platform-server'

import { MailDeliveryError, type MailTransport } from './transport.js'

/**
 * The ports a mail server takes messages on: 587 with STARTTLS, 465 with TLS,
 * 25 between servers, and the alternatives some providers offer where 25 and
 * 587 are blocked, 2525 and Amazon's 2465 and 2587.
 */
export const mailPorts: readonly number[] = [25, 465, 587, 2465, 2525, 2587]

/** Where the mail server of a business may be, beyond the internet. */
export interface MailReach {
  /**
   * Servers in the instance's own network that its operators allow, by name
   * or by address, from the settings of the instance (#188). On any port: the
   * operators vouch for them.
   */
  readonly internalHosts: readonly string[]
}

/** Every address a name stands for, the way the system resolves it. */
async function addressesOf(host: string): Promise<readonly string[]> {
  const found = await lookup(host, { all: true, verbatim: true })

  return found.map((entry) => entry.address)
}

/**
 * The configuration to connect with, or the reason not to connect at all.
 *
 * The name is resolved once, here, and the connection then goes to the
 * address that was checked, with the name kept for TLS. Resolved a second
 * time by the transport, a name could point somewhere else by then, and a
 * check of the first answer would say nothing about the second.
 *
 * Every address the name stands for has to be on the internet, not only the
 * first: which one a connection takes is up to the resolver.
 */
export async function destinationOf(
  configuration: MailConfiguration,
  reach: MailReach,
  resolve: (host: string) => Promise<readonly string[]> = addressesOf,
): Promise<MailConfiguration> {
  const host = configuration.host.replace(/^\[(.*)\]$/, '$1')
  const listed = (entry: string) =>
    reach.internalHosts.some((allowed) => allowed.toLowerCase() === entry.toLowerCase())

  let addresses: readonly string[]

  try {
    addresses = isIP(host) ? [host] : await resolve(host)
  } catch {
    addresses = []
  }

  const [first] = addresses

  if (first === undefined) {
    throw new MailDeliveryError(
      `Den Mailserver "${host}" gibt es nicht, der Name lässt sich nicht auflösen.`,
      'EDNS',
      null,
    )
  }

  const vouched = listed(host) || addresses.every(listed)

  if (!vouched) {
    const inside = addresses.find(isInternalAddress)

    if (inside !== undefined) {
      throw new MailDeliveryError(
        `Der Mailserver "${host}" liegt nicht im Internet, sondern in einem internen Netz ` +
          `(${inside}). Mit einem solchen verbindet sich OpenGewerk nur, wenn der Betreiber der ` +
          'Instanz ihn freigibt, in deren Einstellungen unter „Mailserver im eigenen Netz“.',
        'EDESTINATION',
        null,
      )
    }

    if (!mailPorts.includes(configuration.port)) {
      throw new MailDeliveryError(
        `Port ${String(configuration.port)} ist kein Port für E-Mail. Ein Mailserver nimmt ` +
          'Nachrichten auf 587 mit STARTTLS, auf 465 mit TLS oder auf 25 an, manche Anbieter ' +
          'auch auf 2465, 2525 oder 2587.',
        'EDESTINATION',
        null,
      )
    }
  }

  return {
    ...configuration,
    host: first,
    servername: isIP(host) ? undefined : host,
  }
}

/**
 * A transport that only ever reaches a mail server on the internet, or one
 * the operator of the instance allows (GHSA-5664-h6fc-v729).
 *
 * The settings of a business name a host and a port, and without this the
 * server connected to whatever they named: `localhost`, the database of the
 * instance, anything in the network it runs in. The check behind "Verbindung
 * prüfen" answered with what it found, which made it a way to look around in
 * that network for anybody who may change the mail settings.
 *
 * Wrapped around the connection and not built into the check, so that the
 * job that sends is held to the same rule: a setting that was saved before
 * this existed would otherwise keep reaching wherever it pointed.
 */
export function reachableOnly(
  connect: (configuration: MailConfiguration) => MailTransport,
  reach: MailReach,
  resolve?: (host: string) => Promise<readonly string[]>,
): (configuration: MailConfiguration) => MailTransport {
  return (configuration) => {
    let opened: Promise<MailTransport> | null = null
    const open = () => (opened ??= destinationOf(configuration, reach, resolve).then(connect))

    return {
      async send(mail) {
        await (await open()).send(mail)
      },
      async verify() {
        await (await open()).verify()
      },
      close() {
        void opened?.then(
          (transport) => {
            transport.close()
          },
          () => undefined,
        )
      },
    }
  }
}
