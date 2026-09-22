import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { type MailServerInput, validMailServer } from './server-settings.js'

/**
 * The mail server as the office enters it. Every mistake that can be named
 * before a server is asked is refused here with the field it is in; whether
 * the login is right is for the check.
 */

const base: MailServerInput = {
  host: 'mail.example.de',
  port: null,
  security: 'starttls',
  username: 'rechnung@nord.example.de',
  password: 'geheim',
  fromAddress: 'rechnung@nord.example.de',
  signature: null,
}

function refusal(wanted: Partial<MailServerInput>): string {
  try {
    validMailServer({ ...base, ...wanted })
  } catch (error) {
    if (error instanceof BadRequestException) {
      return error.message
    }

    throw error
  }

  throw new Error('It was taken, and it was expected not to be.')
}

describe('a mail server', () => {
  it('submits on 587 with STARTTLS unless told otherwise', () => {
    expect(validMailServer(base)).toMatchObject({ port: 587, security: 'starttls' })
  })

  it('takes the port that goes with the kind of connection, or the one given', () => {
    expect(validMailServer({ ...base, security: 'tls' }).port).toBe(465)
    expect(validMailServer({ ...base, security: 'none' }).port).toBe(25)
    expect(validMailServer({ ...base, port: 2525 }).port).toBe(2525)
  })

  it('is a host name, not an address with a scheme or a port in it', () => {
    expect(refusal({ host: 'smtp://mail.example.de' })).toContain('ohne "smtp://" davor')
    expect(refusal({ host: 'mail.example.de:587' })).toContain('ohne Port')
    expect(refusal({ host: '' })).toContain('Der Server')
    expect(validMailServer({ ...base, host: ' 192.168.1.20 ' }).host).toBe('192.168.1.20')
  })

  it('refuses a kind of connection or a port that does not exist', () => {
    expect(refusal({ security: 'ssl' as MailServerInput['security'] })).toContain('starttls')
    expect(refusal({ port: 70000 })).toContain('zwischen 1 und 65535')
  })

  it('sends from an address, and only the address', () => {
    expect(refusal({ fromAddress: 'Elektro Nord <rechnung@nord.example.de>' })).toContain(
      'keine E-Mail-Adresse',
    )
  })

  it('wants a password only with a login, and never an empty one', () => {
    expect(refusal({ username: null })).toContain('gehört zu einem Benutzernamen')
    expect(refusal({ password: '' })).toContain('Ein leeres Passwort gibt es nicht')

    const withoutLogin = validMailServer({ ...base, username: '  ', password: undefined })

    expect(withoutLogin.username).toBeNull()
    expect('password' in withoutLogin).toBe(false)
  })
})

describe('a signature', () => {
  it('knows {benutzer} and {briefkopf}, and names any other placeholder', () => {
    expect(validMailServer({ ...base, signature: '{benutzer}\n{briefkopf}' }).signature).toBe(
      '{benutzer}\n{briefkopf}',
    )
    expect(refusal({ signature: 'Grüße, {Benutzer}' })).toContain('{Benutzer}')
  })

  it('is the letterhead when it is left empty', () => {
    expect(validMailServer({ ...base, signature: '   ' }).signature).toBeNull()
  })

  it('is kept with the line ends of this server, whatever the browser sent', () => {
    expect(validMailServer({ ...base, signature: 'Viele Grüße\r\n{benutzer}' }).signature).toBe(
      'Viele Grüße\n{benutzer}',
    )
  })
})
