import { describe, expect, it } from 'vitest'

import { contactFamilyNameMissing, contactRules, type ContactTexts } from './contact.js'

// The contacts of an application that is nobody's: somebody to ask about a
// shelf, or the person a letter goes to. An application of the organisation
// binds the rules to its own records and asks them the same way.

const shelf = '0199a1b2-0000-7000-8000-000000000001'
const letter = '0199a1b2-0000-7000-8000-000000000002'

const parentText = {
  none: 'Ein Ansprechpartner gehört zu einem Regal oder zu einem Brief, dieser zu keinem davon.',
  several: 'Ein Ansprechpartner gehört zu einem Regal oder zu einem Brief, nicht zu beiden.',
}

const rules = contactRules({ parents: ['shelfId', 'letterId'], parentText })

describe('where a contact hangs', () => {
  it('is exactly one of the records its application names', () => {
    expect(rules.parentProblem({ shelfId: shelf, letterId: null })).toBeNull()
    expect(rules.parentProblem({ shelfId: null, letterId: letter })).toBeNull()
    expect(rules.parentProblem({ letterId: letter })).toBeNull()
  })

  it('is none when all are empty, however a form hands them over', () => {
    expect(rules.parentProblem({})).toBe('none')
    expect(rules.parentProblem({ shelfId: null, letterId: null })).toBe('none')
    expect(rules.parentProblem({ shelfId: '', letterId: '' })).toBe('none')
    expect(rules.parentProblem({ shelfId: undefined })).toBe('none')
  })

  it('is refused on more than one', () => {
    expect(rules.parentProblem({ shelfId: shelf, letterId: letter })).toBe('several')
  })

  it('is said in the sentences of the application', () => {
    expect(rules.parentText).toEqual(parentText)
    expect(rules.parents).toEqual(['shelfId', 'letterId'])
  })

  it('is named with its field, where it is exactly one', () => {
    expect(rules.parentOf({ shelfId: shelf })).toEqual({ field: 'shelfId', id: shelf })
    expect(rules.parentOf({ shelfId: '', letterId: letter })).toEqual({
      field: 'letterId',
      id: letter,
    })
    expect(rules.parentOf({})).toBeNull()
    expect(rules.parentOf({ shelfId: shelf, letterId: letter })).toBeNull()
  })

  it('can be a single kind of record, and then never several', () => {
    const one = contactRules({ parents: ['shelfId'], parentText })

    expect(one.parentProblem({ shelfId: shelf })).toBeNull()
    expect(one.parentProblem({})).toBe('none')
    // A field the application did not name is not a parent, whatever it holds.
    expect(
      one.parentProblem({ shelfId: shelf, letterId: letter } as { shelfId: string }),
    ).toBeNull()
  })

  it('names each kind of record once', () => {
    expect(() => contactRules({ parents: ['shelfId', 'shelfId'], parentText })).toThrow(/once/)
  })
})

describe('the texts of a contact', () => {
  it('need a family name, whatever stands in its place', () => {
    for (const familyName of [null, undefined, '', '   ', 7, false]) {
      expect(rules.personProblems({ familyName })).toEqual({ familyName: contactFamilyNameMissing })
    }

    expect(rules.personProblems({ familyName: 'Brandt' })).toEqual({})
    expect(rules.personProblems({ familyName: ' Brandt ' })).toEqual({})
  })

  it('are judged over the fields that are there, so a change to another field says nothing of the name', () => {
    expect(rules.personProblems({})).toEqual({})
    expect(rules.personProblems({ role: 'Empfang', phone: null })).toEqual({})
  })

  it('take what the application finds wrong beside, the family name first', () => {
    const strict = contactRules({
      parents: ['shelfId'],
      parentText,
      problems: (texts: ContactTexts) => ({
        ...(typeof texts.role === 'string' && texts.role.length > 5
          ? { role: 'Die Funktion hat höchstens 5 Zeichen.' }
          : {}),
        ...('familyName' in texts ? { familyName: 'Der Nachname ist zu lang.' } : {}),
      }),
    })

    expect(strict.personProblems({ role: 'Empfang', familyName: '' })).toEqual({
      familyName: contactFamilyNameMissing,
      role: 'Die Funktion hat höchstens 5 Zeichen.',
    })
    expect(Object.keys(strict.personProblems({ role: 'Empfang', familyName: '' }))).toEqual([
      'familyName',
      'role',
    ])
    // Where the foundation has nothing to say about the name, the application does.
    expect(strict.personProblems({ familyName: 'Brandt' })).toEqual({
      familyName: 'Der Nachname ist zu lang.',
    })
    expect(strict.personProblems({ role: 'Tor' })).toEqual({})
  })
})
