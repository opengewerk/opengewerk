import { describe, expect, it } from 'vitest'

import type { IssuerContent } from './document-content.js'
import { letterheadSignature, renderSignature, unknownPlaceholders } from './mail-signature.js'

/**
 * The signature under a message, with the two placeholders a business may
 * use. What is held on to here is mostly what must not reach a customer: a
 * placeholder as it was typed, and a line with a gap where a name would be.
 */

const issuer: IssuerContent = {
  name: 'Elektro Nord GmbH',
  street: 'Hafenstraße',
  houseNumber: '12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
  phone: '040 1234567',
  email: 'info@elektro-nord.example',
  website: null,
  taxNumber: null,
  vatId: null,
  iban: null,
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  managingDirectors: null,
  logo: null,
}

const letterhead = [
  'Elektro Nord GmbH',
  'Hafenstraße 12',
  '20457 Hamburg',
  'Telefon 040 1234567',
  'info@elektro-nord.example',
].join('\n')

describe('a signature', () => {
  it('is the letterhead when the business has written none', () => {
    expect(letterheadSignature(issuer)).toBe(letterhead)
    expect(renderSignature(null, { issuer, sender: 'Max Monteur' })).toBe(letterhead)
    expect(renderSignature('  \n ', { issuer, sender: null })).toBe(letterhead)
  })

  it('names the person a message is sent by', () => {
    const template = 'Viele Grüße\n{benutzer}\n\n{briefkopf}'

    expect(renderSignature(template, { issuer, sender: 'Beate Büro' })).toBe(
      `Viele Grüße\nBeate Büro\n\n${letterhead}`,
    )
  })

  it('leaves out every line that names the sender of a message nobody sent by hand', () => {
    const template = 'Viele Grüße\n\nIhr Ansprechpartner: {benutzer}\n\n{briefkopf}'

    // The line goes, and the blank lines around it close up into one.
    expect(renderSignature(template, { issuer, sender: null })).toBe(`Viele Grüße\n\n${letterhead}`)
  })

  it('reads line ends the way a text field in any browser sends them', () => {
    expect(renderSignature('{benutzer}\r\nElektro Nord', { issuer, sender: 'Max' })).toBe(
      'Max\nElektro Nord',
    )
  })
})

describe('the placeholders of a signature', () => {
  it('are known as they are written, and only so', () => {
    expect(unknownPlaceholders('{benutzer}\n{briefkopf}')).toEqual([])
    expect(unknownPlaceholders('{Benutzer} {name} {name} {}')).toEqual([
      '{Benutzer}',
      '{name}',
      '{}',
    ])
  })
})
