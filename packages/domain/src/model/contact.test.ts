import { describe, expect, it } from 'vitest'

import { contactParentProblem, contactParentText } from './contact.js'

const customer = '0199a1b2-0000-7000-8000-000000000001'
const site = '0199a1b2-0000-7000-8000-000000000002'

describe('where a contact hangs', () => {
  it('is one customer or one site', () => {
    expect(contactParentProblem({ customerId: customer, siteId: null })).toBeNull()
    expect(contactParentProblem({ customerId: null, siteId: site })).toBeNull()
    expect(contactParentProblem({ siteId: site })).toBeNull()
  })

  it('is neither when both are empty, however a form hands them over', () => {
    expect(contactParentProblem({})).toBe('none')
    expect(contactParentProblem({ customerId: null, siteId: null })).toBe('none')
    expect(contactParentProblem({ customerId: '', siteId: '' })).toBe('none')
  })

  it('is refused on both', () => {
    expect(contactParentProblem({ customerId: customer, siteId: site })).toBe('both')
  })

  it('says so in a sentence for each', () => {
    expect(contactParentText.none).toMatch(/keinem von beiden/)
    expect(contactParentText.both).toMatch(/nicht zu beiden/)
  })
})
