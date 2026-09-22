import { createServer, type Server, type Socket } from 'node:net'

/** A message as the fake server received it: the envelope and the raw text. */
export interface ReceivedMail {
  readonly from: string
  readonly to: readonly string[]
  readonly data: string
}

export interface FakeSmtpOptions {
  /** When set, the server asks for a login and takes only this one. */
  readonly credentials?: { readonly user: string; readonly password: string }
  /** Takes the connection and never says a word, the way a hung server does. */
  readonly silent?: boolean
  /** Recipients refused with a 550, the answer for a mailbox that does not exist. */
  readonly refuse?: readonly string[]
}

export interface FakeSmtpServer {
  readonly port: number
  readonly received: readonly ReceivedMail[]
  close(): Promise<void>
}

/**
 * A mail server for the tests, on a free port of this machine.
 *
 * Just enough SMTP for nodemailer without TLS: the greeting, EHLO, a plain
 * login when asked for, the envelope, the data and goodbye. The real protocol
 * has more; a test needs to see what arrived and how a refusal and a silence
 * look to the sender, and a dependency that speaks all of SMTP would bring its
 * own types into conflict with the ones nodemailer ships.
 */
export async function fakeSmtpServer(options: FakeSmtpOptions = {}): Promise<FakeSmtpServer> {
  const received: ReceivedMail[] = []
  const sockets = new Set<Socket>()

  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)

    if (options.silent) {
      return
    }

    let buffer = ''
    let inData = false
    let from = ''
    let to: string[] = []
    let lines: string[] = []
    let signedIn = options.credentials === undefined

    const say = (line: string) => {
      socket.write(`${line}\r\n`)
    }

    say('220 opengewerk-test ESMTP')

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')

      let end = buffer.indexOf('\r\n')

      while (end !== -1) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        end = buffer.indexOf('\r\n')

        if (inData) {
          if (line === '.') {
            inData = false
            received.push({ from, to, data: lines.join('\r\n') })
            say('250 2.0.0 Ok: queued')
          } else {
            lines.push(line.startsWith('..') ? line.slice(1) : line)
          }

          continue
        }

        const command = line.slice(0, 4).toUpperCase()

        if (command === 'EHLO' || command === 'HELO') {
          say('250-opengewerk-test')

          if (options.credentials) {
            say('250-AUTH PLAIN')
          }

          say('250 8BITMIME')
        } else if (command === 'AUTH') {
          const [, , encoded] = line.split(' ')
          const [, user, password] = Buffer.from(encoded ?? '', 'base64')
            .toString('utf8')
            .split('\u0000')

          if (user === options.credentials?.user && password === options.credentials?.password) {
            signedIn = true
            say('235 2.7.0 Authentication successful')
          } else {
            say('535 5.7.8 Authentication credentials invalid')
          }
        } else if (command === 'MAIL') {
          if (!signedIn) {
            say('530 5.7.0 Authentication required')
          } else {
            from = /<([^>]*)>/.exec(line)?.[1] ?? ''
            to = []
            say('250 2.1.0 Ok')
          }
        } else if (command === 'RCPT') {
          const recipient = /<([^>]*)>/.exec(line)?.[1] ?? ''

          if (options.refuse?.includes(recipient)) {
            say('550 5.1.1 Recipient address rejected: User unknown')
          } else {
            to.push(recipient)
            say('250 2.1.5 Ok')
          }
        } else if (command === 'DATA') {
          inData = true
          lines = []
          say('354 End data with <CR><LF>.<CR><LF>')
        } else if (command === 'RSET' || command === 'NOOP') {
          say('250 2.0.0 Ok')
        } else if (command === 'QUIT') {
          say('221 2.0.0 Bye')
          socket.end()
        } else {
          say('502 5.5.2 Command not recognized')
        }
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()

  if (address === null || typeof address === 'string') {
    throw new Error('The fake mail server has no port.')
  }

  return {
    port: address.port,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }

        server.close(() => {
          resolve()
        })
      }),
  }
}

/** A port on this machine where nothing listens, for a refused connection. */
export async function closedPort(): Promise<number> {
  const server = createServer()

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()

  await new Promise<void>((resolve) => server.close(() => resolve()))

  if (address === null || typeof address === 'string') {
    throw new Error('No port came back.')
  }

  return address.port
}
