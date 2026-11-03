import { addMonths, type IsoDate, type RuleSet } from '@opengewerk/platform-domain'

import type { FormValues } from '../forms/values.js'
import type { JobKind } from './job.js'

/**
 * The acceptance of a job after § 640 BGB (#310, Feature-Gliederung 4.11): a
 * form at the job, signed by customer and contractor on the device. Its day
 * starts the warranty (§ 634a Abs. 2 BGB, § 13 Abs. 4 Nr. 3 VOB/B), whose
 * length the rules of the package `warranty` give: by whether the work is a
 * building, whether the VOB/B is agreed as a whole and, with the VOB/B,
 * whether the maintenance of the parts that need it is handed over.
 */

/** The key of the form in the core registry. */
export const acceptanceFormKey = 'acceptance'

/** What came of it: accepted, accepted with reservations for known defects, or refused. */
export const acceptanceResults = ['accepted', 'accepted_with_reservations', 'refused'] as const

export type AcceptanceResult = (typeof acceptanceResults)[number]

/** What a signed protocol says that the warranty and the defects of #311 read. */
export interface Acceptance {
  readonly result: AcceptanceResult
  readonly building: boolean
  readonly vob: boolean
  /** Only with the VOB/B; null where the protocol does not say. */
  readonly maintenanceTransferred: boolean | null
  /** One line a defect, as the protocol has them. */
  readonly reservations: readonly string[]
}

/** The fields of the form these come out of. */
export const acceptanceFields = {
  result: 'result',
  building: 'building_work',
  vob: 'vob_agreed',
  maintenanceTransferred: 'maintenance_transferred',
  reservations: 'reservations',
} as const

/**
 * What a protocol says, or null where it says no result: a draft half filled
 * in. Building and VOB/B read as no where they are not answered, the shorter
 * period, which is the one a business is held to at least.
 */
export function acceptanceOf(values: FormValues): Acceptance | null {
  const result = values[acceptanceFields.result]

  if (typeof result !== 'string' || !(acceptanceResults as readonly string[]).includes(result)) {
    return null
  }

  const transferred = values[acceptanceFields.maintenanceTransferred]
  const reservations = values[acceptanceFields.reservations]

  return {
    result: result as AcceptanceResult,
    building: values[acceptanceFields.building] === true,
    vob: values[acceptanceFields.vob] === true,
    maintenanceTransferred: typeof transferred === 'boolean' ? transferred : null,
    reservations:
      typeof reservations === 'string'
        ? reservations
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== '')
        : [],
  }
}

/** A period of the warranty: its length, the rule it comes from, the day it ends. */
export interface WarrantyTerm {
  readonly years: number
  readonly source: string
  readonly endsOn: IsoDate
}

/**
 * The warranty that runs from an acceptance, or null for a refused one, which
 * starts none, and where the rules have no answer for the day.
 *
 * `whole` is the period of the work; `parts` the shorter one of § 13 Abs. 4
 * Nr. 2 VOB/B for the parts of electrical installations whose maintenance
 * bears on safety, where the VOB/B is agreed and the maintenance not handed
 * over, and only where it is shorter than the whole. A period of years ends
 * on the day of the last year that has the number of the day of acceptance
 * (§ 188 Abs. 2 BGB).
 */
export function warrantyTerms(
  acceptedOn: IsoDate,
  acceptance: Pick<Acceptance, 'result' | 'building' | 'vob' | 'maintenanceTransferred'>,
  rules: RuleSet,
): { readonly whole: WarrantyTerm; readonly parts: WarrantyTerm | null } | null {
  if (acceptance.result === 'refused') {
    return null
  }

  const term = (key: string): WarrantyTerm | null => {
    const rule = rules.at(key, acceptedOn)

    return rule?.unit === 'years' && typeof rule.value === 'number'
      ? { years: rule.value, source: rule.source, endsOn: addMonths(acceptedOn, rule.value * 12) }
      : null
  }
  const whole = term(
    `warranty.${acceptance.vob ? 'vob' : 'bgb'}.${acceptance.building ? 'building' : 'other'}`,
  )

  if (whole === null) {
    return null
  }

  const parts =
    acceptance.vob && acceptance.maintenanceTransferred === false
      ? term('warranty.vob.unmaintained_parts')
      : null

  return { whole, parts: parts !== null && parts.years < whole.years ? parts : null }
}

/** "fünf Jahre", "zwei Jahre": a length as the screens and the paper say it. */
export function yearsText(years: number): string {
  const words = [
    'null',
    'ein',
    'zwei',
    'drei',
    'vier',
    'fünf',
    'sechs',
    'sieben',
    'acht',
    'neun',
    'zehn',
  ]

  return years === 1 ? 'ein Jahr' : `${words[years] ?? String(years)} Jahre`
}

/**
 * What a job suggests for building or not, where the business has not said:
 * a project builds, a service job repairs. A suggestion and no more; whether
 * a PV system on a roof is a building is a question of the single case (BGH,
 * Urteil vom 02.06.2016, VII ZR 348/13).
 */
export function suggestedBuildingWork(kind: JobKind): boolean {
  return kind === 'project'
}
