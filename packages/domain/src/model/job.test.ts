import { describe, expect, it } from 'vitest'

import { rolesAllow } from './authorization.js'
import { followUpProblem, isJobProgress } from './job.js'

describe('the progress of a job', () => {
  it('is finishing it and taking it up', () => {
    expect(isJobProgress([{ field: 'status', to: 'completed' }])).toBe(true)
    expect(isJobProgress([{ field: 'status', to: 'active' }])).toBe(true)
  })

  it('leaves the description with the office, since what happened on site is a note of its own (#220)', () => {
    expect(isJobProgress([{ field: 'description', to: 'Zähler getauscht.' }])).toBe(false)
    expect(
      isJobProgress([
        { field: 'status', to: 'completed' },
        { field: 'description', to: 'Fertig.' },
      ]),
    ).toBe(false)
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

describe('who holds the whole business on a device (#140)', () => {
  it('is the owner and the office, and not a technician', () => {
    expect(rolesAllow(['owner'], 'job.read.all')).toBe(true)
    expect(rolesAllow(['office'], 'job.read.all')).toBe(true)
    expect(rolesAllow(['technician'], 'job.read.all')).toBe(false)
  })
})

describe('a follow-up job (#170)', () => {
  const finished = { id: 'j-1', customerId: 'c-1', status: 'completed' } as const

  it('comes after a finished job of the same customer', () => {
    expect(followUpProblem({ id: 'j-2', customerId: 'c-1' }, finished)).toBeNull()
  })

  it('does not follow a job that is still open, or one that was called off', () => {
    for (const status of ['draft', 'active', 'cancelled'] as const) {
      expect(followUpProblem({ id: 'j-2', customerId: 'c-1' }, { ...finished, status })).toBe(
        'Ein Folgeauftrag schließt an einen abgeschlossenen Auftrag an.',
      )
    }
  })

  it('is for the customer of the job before it', () => {
    expect(followUpProblem({ id: 'j-2', customerId: 'c-2' }, finished)).toBe(
      'Ein Folgeauftrag ist für denselben Kunden wie der Auftrag davor.',
    )
  })

  it('never follows itself', () => {
    expect(followUpProblem({ id: 'j-1', customerId: 'c-1' }, finished)).toBe(
      'Ein Auftrag ist nicht sein eigener Vorgänger.',
    )
  })
})
