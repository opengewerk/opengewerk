import { describe, expect, it } from 'vitest'

import { contactParentProblem, contactParentText } from './contact.js'

const customer = '0199a1b2-0000-7000-8000-000000000001'
const site = '0199a1b2-0000-7000-8000-000000000002'
const supplier = '0199a1b2-0000-7000-8000-000000000003'

describe('where a contact hangs', () => {
  it('is one customer, one site or one supplier', () => {
    expect(contactParentProblem({ customerId: customer, siteId: null })).toBeNull()
    expect(contactParentProblem({ customerId: null, siteId: site })).toBeNull()
    expect(contactParentProblem({ siteId: site })).toBeNull()
    expect(
      contactParentProblem({ customerId: null, siteId: null, supplierId: supplier }),
    ).toBeNull()
  })

  it('is none when all are empty, however a form hands them over', () => {
    expect(contactParentProblem({})).toBe('none')
    expect(contactParentProblem({ customerId: null, siteId: null })).toBe('none')
    expect(contactParentProblem({ customerId: '', siteId: '', supplierId: '' })).toBe('none')
  })

  it('is refused on more than one', () => {
    expect(contactParentProblem({ customerId: customer, siteId: site })).toBe('several')
    expect(contactParentProblem({ customerId: customer, supplierId: supplier })).toBe('several')
    expect(contactParentProblem({ siteId: site, supplierId: supplier })).toBe('several')
  })

  it('says so in a sentence for each', () => {
    expect(contactParentText.none).toMatch(/zu keinem davon/)
    expect(contactParentText.several).toMatch(/nicht zu mehreren/)
  })
})
