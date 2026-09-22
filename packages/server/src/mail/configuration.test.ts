import { describe, expect, it } from 'vitest'

import { ConfigurationError } from '../configuration.js'
import { readMailConfiguration } from './configuration.js'

/**
 * The mail settings of an instance: none at all is a choice, half of them a
 * mistake that has to show at startup.
 */
describe('the mail settings', () => {
  it('are nothing without a mail server, and the instance sends nothing', () => {
    expect(readMailConfiguration({})).toBeNull()
    expect(readMailConfiguration({ SMTP_HOST: '  ' })).toBeNull()
  })

  it('refuse half a setup, a sender without a server', () => {
    expect(() => readMailConfiguration({ MAIL_FROM: 'rechnung@nord.example.de' })).toThrow(
      /MAIL_FROM ist gesetzt, SMTP_HOST aber nicht/,
    )
  })

  it('submit on 587 with STARTTLS required unless told otherwise', () => {
    expect(
      readMailConfiguration({
        SMTP_HOST: 'mail.example.de',
        MAIL_FROM: 'rechnung@nord.example.de',
      }),
    ).toEqual({
      host: 'mail.example.de',
      port: 587,
      security: 'starttls',
      user: null,
      password: null,
      from: 'rechnung@nord.example.de',
    })
  })

  it('take the port that goes with the kind of connection, or the one given', () => {
    const base = { SMTP_HOST: 'mail.example.de', MAIL_FROM: 'rechnung@nord.example.de' }

    expect(readMailConfiguration({ ...base, SMTP_SECURITY: 'tls' })?.port).toBe(465)
    expect(readMailConfiguration({ ...base, SMTP_SECURITY: 'none' })?.port).toBe(25)
    expect(readMailConfiguration({ ...base, SMTP_PORT: '2525' })?.port).toBe(2525)
  })

  it('refuse a kind of connection or a port that does not exist', () => {
    const base = { SMTP_HOST: 'mail.example.de', MAIL_FROM: 'rechnung@nord.example.de' }

    expect(() => readMailConfiguration({ ...base, SMTP_SECURITY: 'ssl' })).toThrow(
      ConfigurationError,
    )
    expect(() => readMailConfiguration({ ...base, SMTP_PORT: '70000' })).toThrow(/SMTP_PORT/)
  })

  it('want the login whole or not at all', () => {
    expect(() =>
      readMailConfiguration({
        SMTP_HOST: 'mail.example.de',
        MAIL_FROM: 'rechnung@nord.example.de',
        SMTP_USER: 'rechnung',
      }),
    ).toThrow(/SMTP_USER und SMTP_PASSWORD gehören zusammen/)
  })

  it('need a sender, and an address rather than a name with one', () => {
    expect(() => readMailConfiguration({ SMTP_HOST: 'mail.example.de' })).toThrow(/MAIL_FROM fehlt/)
    expect(() =>
      readMailConfiguration({
        SMTP_HOST: 'mail.example.de',
        MAIL_FROM: 'Elektro Nord <rechnung@nord.example.de>',
      }),
    ).toThrow(/keine E-Mail-Adresse/)
  })
})
