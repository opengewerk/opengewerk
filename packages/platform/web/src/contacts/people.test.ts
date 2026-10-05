import type { RecordState } from '@opengewerk/platform-domain'
import { probeContactRules } from '@opengewerk/platform-domain/testing'
import { describe, expect, it } from 'vitest'

import {
  asContact,
  byName,
  contactFields,
  contactName,
  contactTextProblem,
  dialable,
  personName,
} from './people.js'

/**
 * What every screen says and asks about a contact, in an application that
 * belongs to nobody: its fields, the values a form hands over, the rule asked
 * before anything is kept, the name and the order of a list.
 */

const person = (fields: Record<string, unknown>) => fields as RecordState

describe('the fields of the form for a contact', () => {
  it('are a name, what somebody is there in the words of the application, and how to reach them', () => {
    const fields = contactFields({
      role: { label: 'Aufgabe', hint: 'Zum Beispiel Lagerleitung oder Empfang.' },
      add: 'Eintragen',
    })

    expect(fields.map((field) => [field.name, field.label])).toEqual([
      ['givenName', 'Vorname'],
      ['familyName', 'Nachname'],
      ['role', 'Aufgabe'],
      ['phone', 'Telefon'],
      ['email', 'E-Mail'],
    ])
    expect(fields.find((field) => field.name === 'role')?.hint).toBe(
      'Zum Beispiel Lagerleitung oder Empfang.',
    )
    expect(fields.filter((field) => field.required).map((field) => field.name)).toEqual([
      'familyName',
    ])
    expect(fields.map((field) => field.kind)).toEqual([
      undefined,
      undefined,
      undefined,
      'tel',
      'email',
    ])
  })

  it('carry no hint an application did not give', () => {
    const fields = contactFields({ role: { label: 'Aufgabe' }, add: 'Eintragen' })

    expect(fields.map((field) => field.hint)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('the values a form for a contact hands over', () => {
  it('are trimmed, and a field left empty is none', () => {
    expect(
      asContact({
        givenName: '  Lena ',
        familyName: ' Brandt  ',
        role: '   ',
        phone: '',
        email: ' lena@probewerk.example ',
      }),
    ).toEqual({
      givenName: 'Lena',
      familyName: 'Brandt',
      role: null,
      phone: null,
      email: 'lena@probewerk.example',
    })
  })

  it('keep a family name of nothing as an empty text, for the rule to say it is missing', () => {
    expect(asContact({ familyName: '   ' }).familyName).toBe('')
    expect(asContact({}).familyName).toBe('')
  })
})

describe('what the rules say to a form for a contact', () => {
  it('is nothing for a contact with a family name', () => {
    expect(contactTextProblem(probeContactRules, { familyName: 'Brandt' })).toBeNull()
  })

  it('is the sentence of the foundation for a family name of nothing but spaces', () => {
    expect(contactTextProblem(probeContactRules, { givenName: 'Lena', familyName: '   ' })).toBe(
      'Der Nachname fehlt.',
    )
  })

  it('is the sentence of the application for what it finds wrong beside', () => {
    expect(
      contactTextProblem(probeContactRules, {
        familyName: 'Brandt',
        role: 'Stellvertretende Leitung des Wareneingangs am Standort Nord',
      }),
    ).toBe('Die Funktion hat höchstens 40 Zeichen.')
  })

  it('is the missing family name first, where both have something to say', () => {
    expect(
      contactTextProblem(probeContactRules, {
        familyName: '',
        role: 'Stellvertretende Leitung des Wareneingangs am Standort Nord',
      }),
    ).toBe('Der Nachname fehlt.')
  })
})

describe('the name of a contact', () => {
  it('is the given and the family name as one, or the one that is there', () => {
    expect(personName(person({ givenName: 'Ole', familyName: 'Jensen' }))).toBe('Ole Jensen')
    expect(personName(person({ givenName: null, familyName: 'Albers' }))).toBe('Albers')
    expect(personName(person({ givenName: 'Ole', familyName: '' }))).toBe('Ole')
  })

  it('is none for a record with neither, and for no record', () => {
    expect(personName(person({ givenName: null, familyName: '' }))).toBeNull()
    expect(personName(null)).toBeNull()
  })

  it('says what somebody is in a list that has to call them something', () => {
    expect(contactName(person({ givenName: 'Ole', familyName: 'Jensen' }))).toBe('Ole Jensen')
    expect(contactName(person({ givenName: null, familyName: '' }))).toBe(
      'Ansprechpartner ohne Namen',
    )
  })
})

describe('a phone number to dial', () => {
  it('is its digits, and the plus of another country', () => {
    expect(dialable('040 / 123-45')).toBe('04012345')
    expect(dialable('+49 (40) 123 45')).toBe('+494012345')
    expect(dialable('0171.22 33')).toBe('01712233')
  })
})

describe('a list of contacts', () => {
  it('goes by family name, then given name, the way German sorts, and is the same every time', () => {
    const contacts = [
      person({ id: 'c', givenName: 'Ole', familyName: 'Zander' }),
      person({ id: 'b', givenName: 'Bea', familyName: 'Ärmel' }),
      person({ id: 'e', givenName: 'Ina', familyName: 'Brandt' }),
      // The same name twice, the later id first: by id, so that two renders
      // agree whatever order the device holds them in.
      person({ id: 'f', givenName: 'Ada', familyName: 'Brandt' }),
      person({ id: 'g', givenName: null, familyName: 'Albers' }),
      person({ id: 'd', givenName: 'Ada', familyName: 'Brandt' }),
    ]

    // "Ärmel" stands with the A, after "Albers" and before "Brandt".
    expect(byName(contacts).map((contact) => contact['id'])).toEqual(['g', 'b', 'd', 'f', 'e', 'c'])
    // The list it was handed stays as it was.
    expect(contacts.map((contact) => contact['id'])).toEqual(['c', 'b', 'e', 'f', 'g', 'd'])
  })
})
