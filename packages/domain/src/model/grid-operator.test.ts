import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  type GridOperator,
  gridOperatorLinkProblem,
  gridOperatorProblems,
  gridOperatorReferenceProblem,
  registrationFor,
  registrationHolds,
  reportsToGridOperator,
} from './grid-operator.js'
import type { GridOperatorId } from './identifier.js'

function operator(id: string, values: Partial<GridOperator> = {}): GridOperator {
  return {
    id: id as GridOperatorId,
    name: `Netz ${id}`,
    portalUrl: null,
    requirements: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    registrationNumber: null,
    registeredUntil: null,
    responsibleElectrician: null,
    ...values,
  }
}

const today = '2026-11-02' as IsoDate

describe('the grid operator of an installation', () => {
  it('is named by a PV system, a battery and a wallbox only', () => {
    expect(gridOperatorLinkProblem('pv_system', 'operator-1')).toBeNull()
    expect(gridOperatorLinkProblem('battery', 'operator-1')).toBeNull()
    expect(gridOperatorLinkProblem('wallbox', 'operator-1')).toBeNull()
    expect(gridOperatorLinkProblem('meter', 'operator-1')).toBe(
      'Einen Netzbetreiber nennt nur eine PV-Anlage, ein Speicher oder eine Wallbox.',
    )
    expect(gridOperatorLinkProblem('meter', null)).toBeNull()
  })

  it('is reported to by what stands on its own, not by what belongs to a PV system', () => {
    expect(reportsToGridOperator('pv_system', null)).toBe(true)
    expect(reportsToGridOperator('wallbox', null)).toBe(true)
    expect(reportsToGridOperator('wallbox', 'pv-1')).toBe(false)
    expect(reportsToGridOperator('meter', null)).toBe(false)
  })

  it('knows it by a number of at most a hundred characters', () => {
    expect(gridOperatorReferenceProblem('SNN-2026-04711')).toBeNull()
    expect(gridOperatorReferenceProblem(null)).toBeNull()
    expect(gridOperatorReferenceProblem('x'.repeat(101))).toBe(
      'Die Kennung beim Netzbetreiber hat höchstens 100 Zeichen.',
    )
  })
})

describe('the entry in an installer directory', () => {
  it('holds until its last day and without one for good, but never without a number', () => {
    expect(registrationHolds({ registrationNumber: 'IV-1', registeredUntil: today }, today)).toBe(
      true,
    )
    expect(
      registrationHolds(
        { registrationNumber: 'IV-1', registeredUntil: '2026-11-01' as IsoDate },
        today,
      ),
    ).toBe(false)
    expect(registrationHolds({ registrationNumber: 'IV-1', registeredUntil: null }, today)).toBe(
      true,
    )
    expect(registrationHolds({ registrationNumber: ' ', registeredUntil: null }, today)).toBe(false)
  })

  it('is the one at the grid operator of the installation where it holds', () => {
    const own = operator('a', {
      registrationNumber: 'IV-A',
      registeredUntil: '2027-01-31' as IsoDate,
    })
    const other = operator('b', { registrationNumber: 'IV-B', registeredUntil: null })

    expect(registrationFor([other, own], own.id, today)).toBe(own)
  })

  it('is another that holds where the own one ran out, the longest first', () => {
    const own = operator('a', {
      registrationNumber: 'IV-A',
      registeredUntil: '2026-10-31' as IsoDate,
    })
    const short = operator('b', {
      registrationNumber: 'IV-B',
      registeredUntil: '2026-12-31' as IsoDate,
    })
    const long = operator('c', {
      registrationNumber: 'IV-C',
      registeredUntil: '2028-06-30' as IsoDate,
    })
    const gone = operator('d', {
      registrationNumber: 'IV-D',
      registeredUntil: '2025-01-01' as IsoDate,
    })

    expect(registrationFor([own, short, long, gone], own.id, today)).toBe(long)
    expect(registrationFor([own, gone], own.id, today)).toBeNull()
    expect(registrationFor([short], null, today)).toBe(short)
  })
})

describe('a grid operator as the office keeps it', () => {
  it('needs a name, and nothing else', () => {
    expect(gridOperatorProblems({ name: 'Stadtwerke Neckartal Netze GmbH' })).toEqual({})
    expect(gridOperatorProblems({ name: '  ' })).toEqual({
      name: 'Ein Netzbetreiber braucht einen Namen.',
    })
    expect(gridOperatorProblems({ portalUrl: null, contactEmail: null })).toEqual({})
  })

  it('takes a portal only as an address a browser opens', () => {
    expect(
      gridOperatorProblems({ portalUrl: 'https://netzportal.neckartal-netze.de/anmeldung' }),
    ).toEqual({})
    expect(gridOperatorProblems({ portalUrl: 'netzportal.neckartal-netze.de' })).toEqual({
      portalUrl: 'Das Portal ist eine Adresse, die mit https:// beginnt.',
    })
    expect(gridOperatorProblems({ portalUrl: 'https://intranet' })).toHaveProperty('portalUrl')
  })

  it('takes an e-mail address only with something on both sides of the at', () => {
    expect(gridOperatorProblems({ contactEmail: 'netz@example.org' })).toEqual({})
    expect(gridOperatorProblems({ contactEmail: 'netz@' })).toEqual({
      contactEmail: 'Diese E-Mail-Adresse ist unvollständig.',
    })
  })

  it('keeps each text within its length', () => {
    expect(gridOperatorProblems({ registrationNumber: 'x'.repeat(65) })).toEqual({
      registrationNumber: 'Hier stehen höchstens 64 Zeichen.',
    })
    expect(gridOperatorProblems({ requirements: 'x'.repeat(2000) })).toEqual({})
  })

  it('takes a last day only as a day of the calendar, and only with the number of the entry', () => {
    expect(
      gridOperatorProblems({ registrationNumber: 'IV-1', registeredUntil: '2026-12-31' }),
    ).toEqual({})
    expect(
      gridOperatorProblems({ registrationNumber: 'IV-1', registeredUntil: '2026-02-30' }),
    ).toEqual({
      registeredUntil: 'Gültig bis ist ein Tag des Kalenders.',
    })
    expect(
      gridOperatorProblems({ registrationNumber: null, registeredUntil: '2026-12-31' }),
    ).toEqual({
      registeredUntil: 'Ein letzter Tag gehört zu einer Eintragung mit Nummer.',
    })
  })
})
