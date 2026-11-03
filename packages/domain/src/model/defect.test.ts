import { type IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { syncPolicies } from '../sync/policy.js'
import {
  defectDescriptionProblem,
  defectHomeProblem,
  defectIsOpen,
  defectMomentProblem,
  defectStatusOf,
  defectStepProblem,
  defectWarranty,
  defectWarrantyText,
  longestDefectDescription,
  nextDefectSteps,
  remedyDueProblem,
} from './defect.js'

const signer = { name: 'Petra Weber', path: 'M10,20L30,40L35,42' }

describe('a defect (#311)', () => {
  it('says what is wrong, and not more than a note may', () => {
    expect(defectDescriptionProblem('Abdeckung verkratzt.')).toBeNull()
    expect(defectDescriptionProblem(' \n')).toBe('Ein Mangel braucht eine Beschreibung.')
    expect(defectDescriptionProblem(undefined)).toBe('Ein Mangel braucht eine Beschreibung.')
    expect(defectDescriptionProblem('x'.repeat(longestDefectDescription))).toBeNull()
    expect(defectDescriptionProblem('x'.repeat(longestDefectDescription + 1))).toBe(
      'Eine Beschreibung hat höchstens 4000 Zeichen.',
    )
    expect(defectHomeProblem('j1', null)).toBeNull()
    expect(defectHomeProblem(null, 'i1')).toBeNull()
    expect(defectHomeProblem(null, '')).toBe(
      'Ein Mangel hängt an einem Auftrag oder an einer Anlage.',
    )
    expect(remedyDueProblem(null)).toBeNull()
    expect(remedyDueProblem('2026-11-19')).toBeNull()
    expect(remedyDueProblem('2026-02-30')).toBe(
      'Die Frist des Kunden ist ein Tag, etwa 19.11.2026.',
    )
    expect(remedyDueProblem('19.11.2026')).toBe(
      'Die Frist des Kunden ist ein Tag, etwa 19.11.2026.',
    )
    expect(defectMomentProblem('2026-11-10T10:42:00.000Z')).toBeNull()
    expect(defectMomentProblem('gestern')).toBe(
      'Es fehlt die Uhrzeit, zu der es eingetragen wurde.',
    )
  })

  it('takes its steps in order: in progress may be skipped, a failed remedy goes back, accepted is the end', () => {
    expect(nextDefectSteps).toEqual({
      reported: ['in_progress', 'resolved'],
      in_progress: ['resolved'],
      resolved: ['in_progress', 'accepted'],
      accepted: [],
    })
    expect(defectStepProblem('reported', 'resolved', null)).toBeNull()
    expect(defectStepProblem('resolved', 'in_progress', null)).toBeNull()
    expect(defectStepProblem('reported', 'accepted', signer)).toBe(
      'Auf „Gemeldet“ folgt nicht „Abgenommen“.',
    )
    expect(defectStepProblem('in_progress', 'in_progress', null)).toBe(
      'Auf „In Bearbeitung“ folgt nicht „In Bearbeitung“.',
    )
    expect(defectStepProblem('accepted', 'in_progress', null)).toBe(
      'Der Mangel ist abgenommen und ändert sich nicht mehr.',
    )
  })

  it('is accepted with the name and signature of the customer, and nothing else is signed', () => {
    expect(defectStepProblem('resolved', 'accepted', signer)).toBeNull()
    expect(defectStepProblem('resolved', 'accepted', null)).toBe(
      'Die Abnahme braucht die Unterschrift des Kunden.',
    )
    expect(defectStepProblem('resolved', 'accepted', { ...signer, path: 'kritzel' })).toBe(
      'Die Abnahme braucht die Unterschrift des Kunden.',
    )
    expect(defectStepProblem('resolved', 'accepted', { ...signer, name: ' ' })).not.toBeNull()
    expect(defectStepProblem('reported', 'resolved', signer)).toBe(
      'Unterschrieben wird nur die Abnahme eines Mangels.',
    )
  })

  it('stands at its last step, and at reported without one', () => {
    expect(defectStatusOf([])).toBe('reported')
    expect(
      defectStatusOf([
        { id: 'b', step: 'resolved', takenAt: '2026-11-07T09:00:00.000Z' },
        { id: 'a', step: 'in_progress', takenAt: '2026-11-06T08:30:00.000Z' },
      ]),
    ).toBe('resolved')
    expect(
      defectStatusOf([
        { id: 'a', step: 'resolved', takenAt: new Date('2026-11-07T09:00:00Z') },
        { id: 'b', step: 'in_progress', takenAt: new Date('2026-11-08T07:00:00Z') },
      ]),
    ).toBe('in_progress')
    expect(defectIsOpen('reported')).toBe(true)
    expect(defectIsOpen('in_progress')).toBe(true)
    expect(defectIsOpen('resolved')).toBe(false)
    expect(defectIsOpen('accepted')).toBe(false)
  })

  it('says whether the day it was reported lies within the warranty', () => {
    const warranty = { acceptedOn: '2026-11-05' as IsoDate, endsOn: '2031-11-05' as IsoDate }

    expect(defectWarranty('2027-03-12' as IsoDate, false, warranty)).toEqual({
      kind: 'within',
      endsOn: '2031-11-05',
    })
    expect(defectWarranty('2031-11-05' as IsoDate, false, warranty)).toEqual({
      kind: 'within',
      endsOn: '2031-11-05',
    })
    expect(defectWarranty('2031-11-06' as IsoDate, false, warranty)).toEqual({
      kind: 'after',
      endedOn: '2031-11-05',
    })
    expect(defectWarranty('2026-11-04' as IsoDate, false, warranty)).toEqual({
      kind: 'before_acceptance',
    })
    expect(defectWarranty('2026-11-05' as IsoDate, true, warranty)).toEqual({
      kind: 'before_acceptance',
    })
    expect(defectWarranty('2027-03-12' as IsoDate, false, null)).toBeNull()
    // An end typed in at the installation has no day of acceptance to be before.
    expect(
      defectWarranty('2020-01-10' as IsoDate, false, {
        acceptedOn: null,
        endsOn: '2024-11-04' as IsoDate,
      }),
    ).toEqual({ kind: 'within', endsOn: '2024-11-04' })
    expect(defectWarrantyText({ kind: 'within', endsOn: '2031-11-05' as IsoDate })).toBe(
      'In der Gewährleistung bis 05.11.2031',
    )
    expect(defectWarrantyText({ kind: 'after', endedOn: '2031-11-05' as IsoDate })).toBe(
      'Nach dem Ende der Gewährleistung am 05.11.2031',
    )
    expect(defectWarrantyText({ kind: 'before_acceptance' })).toBeNull()
  })

  it('travels as field work until it is accepted, its status and origin the server writes', () => {
    expect(syncPolicies['defects']).toEqual({
      create: true,
      change: 'merge',
      onlyWhile: { field: 'status', values: ['reported', 'in_progress', 'resolved'] },
      reserved: ['status', 'createdBy', 'acceptanceRecordId', 'acceptanceLine'],
      createdAs: { status: 'reported' },
    })
    expect(syncPolicies['defect_steps']).toEqual({
      create: true,
      change: 'never',
      reserved: ['createdBy'],
    })
  })
})
