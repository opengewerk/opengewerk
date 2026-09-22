import { afterEach, describe, expect, it } from 'vitest'

import { ConfigurationError } from '../configuration.js'
import { checkMailServer } from './check.js'
import type { MailConfiguration } from './configuration.js'
import { closedPort, type FakeSmtpServer, fakeSmtpServer } from './test-smtp.js'
import { MailDeliveryError, type OutgoingMail, smtpTransport } from './transport.js'

/**
 * The one sender, against a mail server on this machine: what arrives, and
 * what a refusal, a silence and a closed port look like from this side. The
 * check at startup is held here as well, because it is the same conversation
 * cut short.
 */

const short = { connection: 800, greeting: 800, socket: 2_000 }

let server: FakeSmtpServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

function settings(port: number, over: Partial<MailConfiguration> = {}): MailConfiguration {
  return {
    host: '127.0.0.1',
    port,
    security: 'none',
    user: null,
    password: null,
    from: 'rechnung@nord.example.de',
    ...over,
  }
}

const letter: OutgoingMail = {
  from: { name: 'Elektro Nord GmbH', address: 'rechnung@nord.example.de' },
  replyTo: 'buero@nord.example.de',
  to: { name: 'Familie Berg', address: 'berg@example.de' },
  subject: 'Rechnung RE-2026-0042',
  text: 'Guten Tag,\n\nanbei die Rechnung.\n',
  attachments: [
    {
      filename: 'RE-2026-0042.pdf',
      content: new TextEncoder().encode('%PDF-1.7 stand-in'),
      contentType: 'application/pdf',
    },
  ],
}

async function failureOf(work: Promise<unknown>): Promise<MailDeliveryError> {
  try {
    await work
  } catch (error) {
    if (error instanceof MailDeliveryError) {
      return error
    }

    throw error
  }

  throw new Error('It went through, and it was expected not to.')
}

describe('a message', () => {
  it('arrives with its sender, its recipient and its attachment', async () => {
    server = await fakeSmtpServer()
    const transport = smtpTransport(settings(server.port), short)

    await transport.send(letter)
    transport.close()

    expect(server.received).toHaveLength(1)

    const [mail] = server.received

    expect(mail?.from).toBe('rechnung@nord.example.de')
    expect(mail?.to).toEqual(['berg@example.de'])
    expect(mail?.data).toContain('From: Elektro Nord GmbH <rechnung@nord.example.de>')
    expect(mail?.data).toContain('Reply-To: buero@nord.example.de')
    expect(mail?.data).toContain('Subject: Rechnung RE-2026-0042')
    expect(mail?.data).toMatch(/filename=RE-2026-0042\.pdf/)
    expect(mail?.data).toContain(Buffer.from('%PDF-1.7 stand-in').toString('base64'))
  })

  it('is refused for good when the server says a mailbox does not exist', async () => {
    server = await fakeSmtpServer({ refuse: ['berg@example.de'] })
    const transport = smtpTransport(settings(server.port), short)

    const failure = await failureOf(transport.send(letter))
    transport.close()

    expect(failure.code).toBe('EENVELOPE')
    expect(failure.permanent).toBe(true)
  })

  it('is refused for now when the server takes the connection and says nothing', async () => {
    server = await fakeSmtpServer({ silent: true })
    const transport = smtpTransport(settings(server.port), short)

    const failure = await failureOf(transport.send(letter))
    transport.close()

    expect(failure.code).toBe('ETIMEDOUT')
    expect(failure.permanent).toBe(false)
  })

  it('is refused for now when nothing listens on the port', async () => {
    const transport = smtpTransport(settings(await closedPort()), short)

    const failure = await failureOf(transport.send(letter))
    transport.close()

    expect(failure.permanent).toBe(false)
  })

  it('is refused for now, not for good, when the login fails', async () => {
    // A password being changed is a passing fault from the point of view of a
    // message. Given up on, the message would be lost over it.
    server = await fakeSmtpServer({ credentials: { user: 'rechnung', password: 'richtig' } })
    const transport = smtpTransport(
      settings(server.port, { user: 'rechnung', password: 'falsch' }),
      short,
    )

    const failure = await failureOf(transport.send(letter))
    transport.close()

    expect(failure.code).toBe('EAUTH')
    expect(failure.permanent).toBe(false)
  })
})

describe('the check at startup', () => {
  it('is satisfied by a server that greets and takes the login', async () => {
    server = await fakeSmtpServer({ credentials: { user: 'rechnung', password: 'richtig' } })
    const configuration = settings(server.port, { user: 'rechnung', password: 'richtig' })

    await expect(
      checkMailServer(smtpTransport(configuration, short), configuration),
    ).resolves.toEqual({ outcome: 'ready' })
  })

  it('stops the start over a login the server refuses', async () => {
    server = await fakeSmtpServer({ credentials: { user: 'rechnung', password: 'richtig' } })
    const configuration = settings(server.port, { user: 'rechnung', password: 'falsch' })

    await expect(
      checkMailServer(smtpTransport(configuration, short), configuration),
    ).rejects.toThrow(ConfigurationError)
  })

  it('stops the start over a server name that does not exist', async () => {
    const configuration = settings(25, { host: 'kein-mailserver.invalid' })

    await expect(
      checkMailServer(smtpTransport(configuration, short), configuration),
    ).rejects.toThrow(/lässt sich nicht auflösen/)
  })

  it('lets the start go on when nobody answers, and says why', async () => {
    const configuration = settings(await closedPort())
    const check = await checkMailServer(smtpTransport(configuration, short), configuration)

    expect(check.outcome).toBe('unreachable')
    expect(check.outcome === 'unreachable' ? check.reason : '').toContain('Postausgang')
  })

  it('lets the start go on when the server hangs', async () => {
    server = await fakeSmtpServer({ silent: true })
    const configuration = settings(server.port)
    const check = await checkMailServer(smtpTransport(configuration, short), configuration)

    expect(check.outcome).toBe('unreachable')
  })
})
