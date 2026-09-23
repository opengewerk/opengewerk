import { createServer, type Server } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { checkMailServer } from './check.js'
import type { MailConfiguration } from './configuration.js'
import { destinationOf, isInternalAddress, reachableOnly } from './reach.js'
import { MailDeliveryError, type MailTransport, smtpTransport } from './transport.js'

/**
 * Where the mail server of a business may be (GHSA-5664-h6fc-v729): on the
 * internet, on a port for mail, or where the operator of the instance allows.
 * The names here resolve through a stand-in, so that no test depends on what
 * some resolver says today.
 */

function settings(over: Partial<MailConfiguration> = {}): MailConfiguration {
  return {
    host: 'smtp.ionos.de',
    port: 587,
    security: 'starttls',
    user: 'rechnung@nord.example.de',
    password: 'geheim',
    from: 'rechnung@nord.example.de',
    ...over,
  }
}

/** A resolver that knows a handful of names and nothing else. */
function resolver(names: Record<string, readonly string[]>) {
  return (host: string): Promise<readonly string[]> => {
    const found = names[host]

    return found ? Promise.resolve(found) : Promise.reject(new Error(`ENOTFOUND ${host}`))
  }
}

const names = resolver({
  'smtp.ionos.de': ['212.227.15.183', '2001:8d8:fe:53:72ec::1'],
  'mail.lan': ['192.168.1.20'],
  'halb.example': ['212.227.15.183', '10.0.0.8'],
  postgres: ['172.18.0.2'],
})

const nobody = { internalHosts: [] }

async function refusal(work: Promise<unknown>): Promise<MailDeliveryError> {
  try {
    await work
  } catch (error) {
    if (error instanceof MailDeliveryError) {
      return error
    }

    throw error
  }

  throw new Error('expected a refusal')
}

describe('an address', () => {
  it('counts as internal on this machine, in a private network, and next to them', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
    ]) {
      expect([address, isInternalAddress(address)]).toEqual([address, true])
    }
  })

  it('is judged by the IPv4 address it carries through NAT64', () => {
    expect(isInternalAddress('64:ff9b::a00:1')).toBe(true)
    expect(isInternalAddress('64:ff9b::10.0.0.1')).toBe(true)
    expect(isInternalAddress('64:ff9b::d4e3:fb7')).toBe(false)
  })

  it('counts as outside on the internet, in both families', () => {
    for (const address of ['212.227.15.183', '8.8.8.8', '2001:8d8:fe:53:72ec::1']) {
      expect([address, isInternalAddress(address)]).toEqual([address, false])
    }
  })
})

describe('the destination of a mail server', () => {
  it('is the address its name was resolved to, with the name kept for the certificate', async () => {
    const destination = await destinationOf(settings(), nobody, names)

    expect(destination.host).toBe('212.227.15.183')
    expect(destination.servername).toBe('smtp.ionos.de')
    expect(destination.port).toBe(587)
  })

  it('is refused inside a network, the database of the instance included', async () => {
    for (const host of ['mail.lan', 'postgres', '127.0.0.1', '[::1]']) {
      const refused = await refusal(destinationOf(settings({ host }), nobody, names))

      expect(refused.code).toBe('EDESTINATION')
      expect(refused.message).toContain('MAIL_INTERNAL_HOSTS')
      expect(refused.permanent).toBe(true)
    }
  })

  it('is refused when only one of the addresses of its name is internal', async () => {
    const refused = await refusal(destinationOf(settings({ host: 'halb.example' }), nobody, names))

    expect(refused.message).toContain('10.0.0.8')
  })

  it('is refused on a port that is not for mail', async () => {
    const refused = await refusal(destinationOf(settings({ port: 5432 }), nobody, names))

    expect(refused.code).toBe('EDESTINATION')
    expect(refused.message).toContain('Port 5432')
  })

  it('may be inside when the operator allows it, by name or by address, on any port', async () => {
    const byName = await destinationOf(
      settings({ host: 'mail.lan', port: 1025 }),
      { internalHosts: ['MAIL.lan'] },
      names,
    )
    const byAddress = await destinationOf(
      settings({ host: 'mail.lan' }),
      { internalHosts: ['192.168.1.20'] },
      names,
    )

    expect(byName.host).toBe('192.168.1.20')
    expect(byAddress.servername).toBe('mail.lan')
  })

  it('says a name does not exist when nobody resolves it', async () => {
    const refused = await refusal(
      destinationOf(settings({ host: 'kein-mailserver.invalid' }), nobody, names),
    )

    expect(refused.code).toBe('EDNS')
  })

  it('keeps an address as it is, with no name for the certificate', async () => {
    const destination = await destinationOf(settings({ host: '212.227.15.183' }), nobody, names)

    expect(destination.host).toBe('212.227.15.183')
    expect(destination.servername).toBeUndefined()
  })
})

describe('a transport that only reaches mail servers', () => {
  it('does not connect at all to a refused destination, and the check says why', async () => {
    const opened: MailConfiguration[] = []
    const connect = reachableOnly(
      (configuration) => {
        opened.push(configuration)

        return {
          send: async () => undefined,
          verify: async () => undefined,
          close: () => undefined,
        }
      },
      nobody,
      names,
    )
    const configuration = settings({ host: 'postgres', port: 5432 })
    const check = await checkMailServer(connect(configuration), configuration)

    expect(opened).toEqual([])
    expect(check.outcome).toBe('refused')
    expect(check.outcome === 'refused' ? check.reason : '').toContain('internen Netz')
  })

  it('connects to the checked address, once, however often it is used', async () => {
    const opened: MailConfiguration[] = []
    const inner: MailTransport = {
      send: async () => undefined,
      verify: async () => undefined,
      close: () => undefined,
    }
    const transport = reachableOnly(
      (configuration) => {
        opened.push(configuration)

        return inner
      },
      nobody,
      names,
    )(settings())

    await transport.verify()
    await transport.verify()
    transport.close()

    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ host: '212.227.15.183', servername: 'smtp.ionos.de' })
  })
})

describe('the check against something that is no mail server', () => {
  let server: Server | null = null

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
    server = null
  })

  /**
   * The greeting of whatever answers is not repeated. A check that printed it
   * would read out the banner of any service it was pointed at.
   */
  it('says that something answered, and not what it said', async () => {
    server = createServer((socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nServer: interner-dienst-4.2\r\n\r\n')
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const configuration = settings({ host: '127.0.0.1', port, security: 'none', user: null })
    const check = await checkMailServer(
      smtpTransport(configuration, { connection: 800, greeting: 800, socket: 2_000 }),
      configuration,
    )

    expect(check.outcome).not.toBe('ready')
    expect(JSON.stringify(check)).not.toContain('interner-dienst')
  })
})
