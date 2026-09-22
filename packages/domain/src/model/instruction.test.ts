import { describe, expect, it } from 'vitest'

import type { IssuerContent } from './document-content.js'
import {
  addressLine,
  filledInstruction,
  instructionBlocks,
  placeholdersIn,
  proposedFor,
  unfilledPlaceholders,
  unknownInstructionPlaceholders,
} from './instruction.js'

const issuer: IssuerContent = {
  name: 'Elektro Kohm',
  street: 'Hauptstraße',
  houseNumber: '103',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  country: 'DE',
  phone: '06203 123456',
  email: 'info@elektro-kohm.de',
  website: null,
  taxNumber: '38/123/45678',
  vatId: null,
  iban: null,
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  managingDirectors: null,
  logo: null,
}

const blocks = { fristbeginn: ' des Vertragsabschlusses.', folgen: 'Wertersatz.' }

describe('the placeholders of an instruction', () => {
  it('are found as written, each once, known or not', () => {
    expect(placeholdersIn('An {name}, {anschrift}; {name} und {Name}')).toEqual([
      '{name}',
      '{anschrift}',
      '{Name}',
    ])
  })

  it('are refused when they are not among the known ones', () => {
    expect(
      unknownInstructionPlaceholders('{name} {telefon} {adresse} {Name} {fristbeginn}'),
    ).toEqual(['{adresse}', '{Name}'])
  })
})

describe('the address of the business on one line', () => {
  it('reads street and number, then postal code and town', () => {
    expect(addressLine(issuer)).toBe('Hauptstraße 103, 68535 Edingen-Neckarhausen')
  })

  it('adds the country only when it is not Germany', () => {
    expect(addressLine({ ...issuer, postalCode: '6020', city: 'Innsbruck', country: 'AT' })).toBe(
      'Hauptstraße 103, 6020 Innsbruck, Österreich',
    )
  })
})

describe('what the letterhead cannot fill', () => {
  it('is nothing when the letterhead has all four', () => {
    expect(unfilledPlaceholders('{name} {anschrift} {telefon} {email}', issuer)).toEqual([])
  })

  it('names each missing value of a placeholder the text uses, and only those', () => {
    const missing = unfilledPlaceholders('Telefon {telefon}, E-Mail {email}', {
      ...issuer,
      phone: null,
      email: '  ',
      city: null,
    })

    expect(missing.map((entry) => entry.placeholder)).toEqual(['{telefon}', '{email}'])
    expect(missing[0]?.missing).toBe('die Telefonnummer des Betriebs')
  })

  it('counts an address without a town as missing', () => {
    expect(unfilledPlaceholders('({anschrift})', { ...issuer, city: ' ' })).toEqual([
      {
        placeholder: '{anschrift}',
        missing: 'die vollständige Anschrift des Betriebs mit Straße, Postleitzahl und Ort',
      },
    ])
  })
})

describe('an instruction filled in', () => {
  it('puts in the business and the sentences of the contract', () => {
    expect(
      filledInstruction('uns ({name}, {anschrift}, Telefon {telefon})\nab dem Tag{fristbeginn}', {
        issuer,
        blocks,
      }),
    ).toBe(
      'uns (Elektro Kohm, Hauptstraße 103, 68535 Edingen-Neckarhausen, Telefon 06203 123456)\n' +
        'ab dem Tag des Vertragsabschlusses.',
    )
  })

  it('leaves out a value the letterhead lacks rather than printing the placeholder', () => {
    expect(
      filledInstruction('E-Mail {email}', { issuer: { ...issuer, email: null }, blocks }),
    ).toBe('E-Mail')
  })

  it('keeps an unknown placeholder as written, so that it shows', () => {
    expect(filledInstruction('{adresse}', { issuer, blocks })).toBe('{adresse}')
  })

  it('closes up empty lines and plain line endings', () => {
    expect(
      filledInstruction('Eins\r\n\r\n\r\n\r\nZwei  \r\n{folgen}\n\n\n', { issuer, blocks }),
    ).toBe('Eins\n\nZwei\nWertersatz.')
  })
})

describe('the pieces of an instruction on paper', () => {
  it('reads headings, paragraphs, points and lines to write on', () => {
    expect(
      instructionBlocks(
        '# Widerrufsrecht\n\nErste Zeile\nzweite Zeile\n\n- An uns:\n- Datum\n___\n\n#ohne Abstand\n-5 Grad',
      ),
    ).toEqual([
      { kind: 'heading', text: 'Widerrufsrecht' },
      { kind: 'paragraph', text: 'Erste Zeile\nzweite Zeile' },
      { kind: 'item', text: 'An uns:' },
      { kind: 'item', text: 'Datum' },
      { kind: 'line' },
      { kind: 'paragraph', text: '#ohne Abstand\n-5 Grad' },
    ])
  })

  it('is nothing for an empty text', () => {
    expect(instructionBlocks('\n  \n')).toEqual([])
  })
})

describe('an instruction proposed for a document', () => {
  const withdrawal = { kinds: ['quote', 'cost_estimate'] as const, consumersOnly: true }

  it('is proposed for its kinds and a customer who is not a business', () => {
    expect(proposedFor(withdrawal, { kind: 'quote', recipientIsBusiness: false })).toBe(true)
    expect(proposedFor(withdrawal, { kind: 'cost_estimate', recipientIsBusiness: false })).toBe(
      true,
    )
  })

  it('is not proposed for another kind or, when it is for consumers, for a business', () => {
    expect(proposedFor(withdrawal, { kind: 'final_invoice', recipientIsBusiness: false })).toBe(
      false,
    )
    expect(proposedFor(withdrawal, { kind: 'quote', recipientIsBusiness: true })).toBe(false)
    expect(
      proposedFor(
        { ...withdrawal, consumersOnly: false },
        { kind: 'quote', recipientIsBusiness: true },
      ),
    ).toBe(true)
  })

  it('is proposed for nothing when it has no kinds', () => {
    expect(
      proposedFor(
        { kinds: [], consumersOnly: false },
        { kind: 'quote', recipientIsBusiness: false },
      ),
    ).toBe(false)
  })
})
