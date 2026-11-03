import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { definitionProblems } from '../forms/definition.js'
import { coreForms } from '../forms/core.js'
import { formSubjectProblem } from '../forms/record.js'
import { structureValues } from '../forms/structure-values.js'
import { shippedRules } from '../rules/shipped.js'
import { acceptanceOf, suggestedBuildingWork, warrantyTerms, yearsText } from './acceptance.js'

const on = '2026-11-05' as IsoDate
const accepted = {
  result: 'accepted' as const,
  building: true,
  vob: false,
  maintenanceTransferred: null,
}

describe('the warranty that runs from an acceptance (#310)', () => {
  it('is five years for a building and two otherwise after the BGB', () => {
    expect(warrantyTerms(on, accepted, shippedRules)).toEqual({
      whole: { years: 5, source: '§ 634a Abs. 1 Nr. 2 BGB', endsOn: '2031-11-05' },
      parts: null,
    })
    expect(warrantyTerms(on, { ...accepted, building: false }, shippedRules)?.whole).toEqual({
      years: 2,
      source: '§ 634a Abs. 1 Nr. 1 BGB',
      endsOn: '2028-11-05',
    })
  })

  it('is four years for a building and two otherwise with the VOB/B', () => {
    expect(warrantyTerms(on, { ...accepted, vob: true }, shippedRules)?.whole).toMatchObject({
      years: 4,
      endsOn: '2030-11-05',
    })
    expect(
      warrantyTerms(on, { ...accepted, vob: true, building: false }, shippedRules)?.whole.years,
    ).toBe(2)
  })

  it('is two years for the parts that need maintenance where the VOB/B applies and it is not handed over', () => {
    const vob = { ...accepted, vob: true }

    expect(
      warrantyTerms(on, { ...vob, maintenanceTransferred: false }, shippedRules)?.parts,
    ).toEqual({
      years: 2,
      source: '§ 13 Abs. 4 Nr. 2 VOB/B',
      endsOn: '2028-11-05',
    })
    expect(
      warrantyTerms(on, { ...vob, maintenanceTransferred: true }, shippedRules)?.parts,
    ).toBeNull()
    expect(
      warrantyTerms(on, { ...vob, maintenanceTransferred: null }, shippedRules)?.parts,
    ).toBeNull()
    // Without the VOB/B the BGB knows no such period.
    expect(
      warrantyTerms(on, { ...accepted, maintenanceTransferred: false }, shippedRules)?.parts,
    ).toBeNull()
    // Not where the whole is no longer anyway.
    expect(
      warrantyTerms(on, { ...vob, building: false, maintenanceTransferred: false }, shippedRules)
        ?.parts,
    ).toBeNull()
  })

  it('starts none for a refused acceptance, and ends on the day with the number of the acceptance', () => {
    expect(warrantyTerms(on, { ...accepted, result: 'refused' }, shippedRules)).toBeNull()
    expect(
      warrantyTerms(on, { ...accepted, result: 'accepted_with_reservations' }, shippedRules)?.whole
        .endsOn,
    ).toBe('2031-11-05')
    // A leap day ends at the end of February (§ 188 Abs. 3 BGB).
    expect(warrantyTerms('2028-02-29' as IsoDate, accepted, shippedRules)?.whole.endsOn).toBe(
      '2033-02-28',
    )
  })

  it('says its length in words', () => {
    expect(yearsText(5)).toBe('fünf Jahre')
    expect(yearsText(1)).toBe('ein Jahr')
  })
})

describe('what a signed acceptance says (#310)', () => {
  it('reads the result, building, VOB/B, maintenance and one reservation a line', () => {
    expect(
      acceptanceOf({
        result: 'accepted_with_reservations',
        building_work: true,
        vob_agreed: true,
        maintenance_transferred: false,
        reservations: 'Abdeckung verkratzt\n\n  Klemme lose  \n',
      }),
    ).toEqual({
      result: 'accepted_with_reservations',
      building: true,
      vob: true,
      maintenanceTransferred: false,
      reservations: ['Abdeckung verkratzt', 'Klemme lose'],
    })
  })

  it('says nothing without a result, and reads no for what is not answered', () => {
    expect(acceptanceOf({ building_work: true })).toBeNull()
    expect(acceptanceOf({ result: 'maybe' })).toBeNull()
    expect(acceptanceOf({ result: 'accepted' })).toMatchObject({
      building: false,
      vob: false,
      maintenanceTransferred: null,
      reservations: [],
    })
  })

  it('suggests a building for a project and none for a service job', () => {
    expect(suggestedBuildingWork('project')).toBe(true)
    expect(suggestedBuildingWork('service')).toBe(false)
  })
})

describe('the acceptance as a form of the core (#310)', () => {
  const form = coreForms.find((definition) => definition.key === 'acceptance')

  it('is a form of a job without problems, signed by the contractor last', () => {
    expect(form).toMatchObject({ attachesTo: 'job', purpose: 'acceptance', version: 1 })
    expect(form ? definitionProblems(form) : ['missing']).toEqual([])
  })

  it('hangs on a job alone', () => {
    const sentence = 'Dieses Formular gehört an einen Auftrag.'

    expect(
      formSubjectProblem(form ?? null, { installationId: null, applianceId: null, jobId: 'j-1' }),
    ).toBeNull()
    expect(
      formSubjectProblem(form ?? null, { installationId: null, applianceId: null, jobId: null }),
    ).toBe(sentence)
    expect(
      formSubjectProblem(form ?? null, { installationId: 'i-1', applianceId: null, jobId: 'j-1' }),
    ).toBe(sentence)
  })

  it('starts from the customer and the job, building and VOB/B as the job has them', () => {
    expect(
      form &&
        structureValues(form, {
          operator: { name: 'Familie Weber', address: 'Birkenweg 7, 69214 Eppelheim' },
          inverters: [],
          modules: [],
          batteries: [],
          meters: [],
          job: {
            designation: 'Wallbox Garage montieren',
            number: 'AU-2026-0231',
            building: true,
            vob: false,
          },
        }),
    ).toEqual({
      client: 'Familie Weber\nBirkenweg 7, 69214 Eppelheim',
      work: 'Wallbox Garage montieren, AU-2026-0231',
      building_work: true,
      vob_agreed: false,
    })
  })
})
