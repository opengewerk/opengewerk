import { describe, expect, it } from 'vitest'

import { rolesAllow } from './authorization.js'
import { isJobProgress } from './job.js'

describe('the progress of a job', () => {
  it('is finishing it, taking it up and writing down what happened', () => {
    expect(isJobProgress([{ field: 'status', to: 'completed' }])).toBe(true)
    expect(isJobProgress([{ field: 'status', to: 'active' }])).toBe(true)
    expect(isJobProgress([{ field: 'description', to: 'Zähler getauscht.' }])).toBe(true)
    expect(isJobProgress([{ field: 'description', to: null }])).toBe(true)
    expect(
      isJobProgress([
        { field: 'status', to: 'completed' },
        { field: 'description', to: 'Fertig.' },
      ]),
    ).toBe(true)
  })

  it('is not cancelling a job or sending it back to draft', () => {
    expect(isJobProgress([{ field: 'status', to: 'cancelled' }])).toBe(false)
    expect(isJobProgress([{ field: 'status', to: 'draft' }])).toBe(false)
    expect(isJobProgress([{ field: 'status', to: null }])).toBe(false)
  })

  it('is not saying what the job is, and not alongside a report either', () => {
    expect(isJobProgress([{ field: 'designation', to: 'Wallbox' }])).toBe(false)
    expect(isJobProgress([{ field: 'customerId', to: 'someone' }])).toBe(false)
    expect(
      isJobProgress([
        { field: 'status', to: 'completed' },
        { field: 'siteId', to: 'somewhere' },
      ]),
    ).toBe(false)
  })

  it('is not an empty change', () => {
    expect(isJobProgress([])).toBe(false)
  })
})

describe('who reports the progress of a job', () => {
  it('is everybody who works in the business, the technician included', () => {
    expect(rolesAllow(['technician'], 'job.progress')).toBe(true)
    expect(rolesAllow(['office'], 'job.progress')).toBe(true)
    expect(rolesAllow(['owner'], 'job.progress')).toBe(true)
  })

  it('is not the technician deciding what the job is', () => {
    expect(rolesAllow(['technician'], 'job.write')).toBe(false)
  })
})
