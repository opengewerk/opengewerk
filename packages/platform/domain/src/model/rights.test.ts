import { describe, expect, it } from 'vitest'

import { accessRights, rightsCatalogue, type RoleDefinition } from './rights.js'

// A catalogue that is nobody's: two rights of its own next to the two the
// foundation asks for, and two roles. Nothing in here knows an application.
const catalogue = rightsCatalogue([
  'membership.read',
  'membership.write',
  'shelf.read',
  'shelf.write',
])

type Right = (typeof catalogue.rights)[number]

const keeper: RoleDefinition<Right> = {
  key: 'keeper',
  label: 'Keeper',
  rights: ['shelf.write', 'shelf.read', 'membership.read', 'membership.write'],
  leads: true,
  secondFactor: true,
}

const reader: RoleDefinition<Right> = {
  key: 'reader',
  label: 'Reader',
  rights: ['shelf.read'],
  leads: false,
  secondFactor: false,
}

describe('a catalogue of rights', () => {
  it('knows its own rights and no others', () => {
    expect(catalogue.isRight('shelf.read')).toBe(true)
    expect(catalogue.isRight('shelf.burn')).toBe(false)
    expect(catalogue.isRight('')).toBe(false)
  })

  it('is refused without the rights the foundation asks for on its own routes', () => {
    expect(() => rightsCatalogue(['shelf.read', accessRights.read])).toThrow(
      'The catalogue lacks the rights of the foundation: membership.write',
    )
  })

  it('is refused when a right stands in it twice', () => {
    expect(() =>
      rightsCatalogue(['membership.read', 'membership.write', 'shelf.read', 'shelf.read']),
    ).toThrow('A right stands twice in the catalogue: shelf.read')
  })
})

describe('what roles add up to', () => {
  it('is every right one of them gives, once and in the order of the catalogue', () => {
    expect(catalogue.sumOf([reader, keeper])).toEqual({
      rights: ['membership.read', 'membership.write', 'shelf.read', 'shelf.write'],
      leads: true,
      secondFactor: true,
    })
    expect(catalogue.sumOf([reader])).toEqual({
      rights: ['shelf.read'],
      leads: false,
      secondFactor: false,
    })
  })

  it('is nothing for nobody', () => {
    expect(catalogue.sumOf([])).toEqual({ rights: [], leads: false, secondFactor: false })
  })

  /**
   * A row can hold a right this version does not know: one a newer version
   * wrote, or one an older version had. It gives nothing.
   */
  it('leaves out a right the catalogue does not know', () => {
    const sum = catalogue.sumOf([
      { rights: ['shelf.read', 'shelf.burn'], leads: false, secondFactor: false },
    ])

    expect(sum.rights).toEqual(['shelf.read'])
  })

  /**
   * What keeps a tenant from locking itself out by editing the one role that
   * could let it back in: leading is a flag of the role and brings the
   * administration with it, whatever the rights of the row say.
   */
  it('lets whoever leads administer who works in the tenant, whatever the role holds', () => {
    const stripped = { rights: ['shelf.read'], leads: true, secondFactor: false }

    expect(catalogue.sumOf([stripped]).rights).toEqual([
      'membership.read',
      'membership.write',
      'shelf.read',
    ])
  })

  it('does not hand the administration to a role that does not lead', () => {
    expect(catalogue.sumOf([reader]).rights).not.toContain('membership.write')
  })

  it('asks for a second factor as soon as one of the roles does', () => {
    const careful = { rights: [], leads: false, secondFactor: true }

    expect(catalogue.sumOf([reader, careful]).secondFactor).toBe(true)
    expect(catalogue.sumOf([reader]).secondFactor).toBe(false)
  })
})

describe('whether somebody holds a right', () => {
  it('is asked of the rights their identity carries', () => {
    const identity = { rights: catalogue.sumOf([reader]).rights }

    expect(catalogue.isAllowed(identity, 'shelf.read')).toBe(true)
    expect(catalogue.isAllowed(identity, 'shelf.write')).toBe(false)
    expect(catalogue.isAllowed({ rights: [] }, 'shelf.read')).toBe(false)
  })
})
