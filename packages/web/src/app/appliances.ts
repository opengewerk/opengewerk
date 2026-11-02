import {
  applianceMobilities,
  applianceMobilityLabel,
  applianceProblems,
  applianceSubject,
  inspectionDueAfter,
  type IsoDate,
  protectionClasses,
  readFormValues,
  type RecordState,
} from '@opengewerk/domain'
import { amount, scaledNumber, today } from '@opengewerk/platform-web/format'
import {
  asTextOrNull,
  type FormField,
  maybeText,
  text,
  useRecords,
  useRelated,
} from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

import { definitionOf, isSigned } from './protocols.js'

/**
 * The register of appliances of a site (#303), as the office and the site
 * read it: the appliances, their tests, and how each stands today.
 */

/** Inventory numbers as a person counts them: 9 before 10. */
const byNumber = new Intl.Collator('de', { numeric: true })

/** The appliances of a site, by their number and then their designation; without a number last. */
export function useAppliances(siteId: string | undefined): readonly RecordState[] {
  const related = useRelated('appliances', 'siteId', siteId)

  return useMemo(
    () =>
      [...related].sort(
        (left, right) =>
          Number(maybeText(left, 'inventoryNumber') === null) -
            Number(maybeText(right, 'inventoryNumber') === null) ||
          byNumber.compare(text(left, 'inventoryNumber'), text(right, 'inventoryNumber')) ||
          byNumber.compare(text(left, 'designation'), text(right, 'designation')),
      ),
    [related],
  )
}

/** The tests of every appliance the device holds, by appliance, the newest first. */
export function useApplianceTests(): ReadonlyMap<string, readonly RecordState[]> {
  const records = useRecords('form_records')

  return useMemo(() => {
    const tests = new Map<string, RecordState[]>()

    for (const record of records) {
      const appliance = maybeText(record, 'applianceId')

      if (appliance !== null) {
        tests.set(appliance, [...(tests.get(appliance) ?? []), record])
      }
    }

    for (const list of tests.values()) {
      list.sort(
        (left, right) =>
          text(right, 'performedOn').localeCompare(text(left, 'performedOn')) ||
          String(right['id']).localeCompare(String(left['id'])),
      )
    }

    return tests
  }, [records])
}

/** "005 Kaffeemaschine", as the lists name it. */
export function applianceName(appliance: RecordState): string {
  const number = text(appliance, 'inventoryNumber').trim()
  const designation = text(appliance, 'designation')

  return number === '' ? designation : `${number} ${designation}`
}

/** "005 Kaffeemaschine, Schutzklasse I, Anschlussleitung 1,2 m", as the head of a protocol. */
export function applianceHeading(appliance: RecordState): string {
  const length = appliance['cordLengthMilli']

  return applianceSubject({
    inventoryNumber: maybeText(appliance, 'inventoryNumber'),
    designation: text(appliance, 'designation'),
    protectionClass: text(appliance, 'protectionClass') as 'I' | 'II' | 'III',
    cordLengthMilli: typeof length === 'number' ? length : null,
  })
}

/** What a signed test found, and the day it names for the next one. */
export interface TestResult {
  readonly performedOn: string
  readonly defects: boolean
  readonly nextOn: string | null
}

/** The last signed test of an appliance, as the register and the report read it. */
export function lastResult(tests: readonly RecordState[] | undefined): TestResult | null {
  const last = (tests ?? []).find((test) => isSigned(test) && definitionOf(test) !== null)

  if (!last) {
    return null
  }

  const values = readFormValues(last['values']) ?? {}
  const performedOn = text(last, 'performedOn')

  return {
    performedOn,
    defects: values['verdict'] === 'defects',
    nextOn: inspectionDueAfter(performedOn as IsoDate, values['next_inspection_months']),
  }
}

/**
 * How an appliance stands on the day of the list: tested today, with or
 * without defects, a draft of today, due, tested earlier, or never.
 */
export type ApplianceState =
  | { readonly kind: 'today'; readonly defects: boolean }
  | { readonly kind: 'draft'; readonly id: string }
  | { readonly kind: 'due'; readonly on: string }
  | { readonly kind: 'tested'; readonly on: string; readonly nextOn: string | null }
  | { readonly kind: 'untested' }

export function applianceState(
  tests: readonly RecordState[] | undefined,
  on: string = today(),
): ApplianceState {
  const draft = (tests ?? []).find((test) => !isSigned(test))

  if (draft && text(draft, 'performedOn') === on) {
    return { kind: 'draft', id: String(draft['id']) }
  }

  const last = lastResult(tests)

  if (last === null) {
    return draft ? { kind: 'draft', id: String(draft['id']) } : { kind: 'untested' }
  }

  if (last.performedOn === on) {
    return { kind: 'today', defects: last.defects }
  }

  if (last.nextOn !== null && last.nextOn <= on) {
    return { kind: 'due', on: last.nextOn }
  }

  return { kind: 'tested', on: last.performedOn, nextOn: last.nextOn }
}

/**
 * The appliance to test after this one: the next in the order of the list
 * that has no test of today yet, or the first such before it.
 */
export function nextToTest(
  appliances: readonly RecordState[],
  tests: ReadonlyMap<string, readonly RecordState[]>,
  after: string,
  on: string = today(),
): RecordState | null {
  const open = (appliance: RecordState) => {
    const state = applianceState(tests.get(String(appliance['id'])), on)

    return state.kind !== 'today' && String(appliance['id']) !== after
  }
  const at = appliances.findIndex((appliance) => String(appliance['id']) === after)

  return (
    appliances.slice(at + 1).find(open) ?? appliances.slice(0, Math.max(at, 0)).find(open) ?? null
  )
}

/** The fields of an appliance, in the office and on site, in the order of the boards. */
export const applianceFields: readonly FormField[] = [
  { name: 'designation', label: 'Bezeichnung', required: true },
  {
    name: 'inventoryNumber',
    label: 'Inventarnummer',
    hint: 'Wie sie auf dem Prüfetikett steht.',
  },
  { name: 'location', label: 'Standort' },
  { name: 'manufacturer', label: 'Hersteller' },
  { name: 'model', label: 'Typ' },
  { name: 'serialNumber', label: 'Seriennummer' },
  {
    name: 'protectionClass',
    label: 'Schutzklasse',
    required: true,
    hint: 'Nach ihr richten sich die Grenzwerte.',
    options: protectionClasses.map((value) => ({ value, label: `Schutzklasse ${value}` })),
  },
  {
    name: 'mobility',
    label: 'Art',
    required: true,
    options: applianceMobilities.map((value) => ({ value, label: applianceMobilityLabel[value] })),
  },
  {
    name: 'cordLength',
    label: 'Länge der Anschlussleitung in m',
    numeric: true,
    hint: 'Nach ihr richtet sich bei Schutzklasse I der Grenzwert des Schutzleiterwiderstands. Ohne Länge gilt der für bis zu 5 m.',
  },
  { name: 'notes', label: 'Notizen', kind: 'textarea' },
]

/** An appliance as the form shows it: the length of its lead in metres. */
export function applianceFormRecord(appliance: RecordState): RecordState {
  const length = appliance['cordLengthMilli']

  return { ...appliance, cordLength: typeof length === 'number' ? amount(length) : '' }
}

/** The length of the lead as typed, in millimetres; null for nothing typed, undefined for what is no figure. */
export function cordLengthOf(typed: string | undefined): number | null | undefined {
  if (typed === undefined || typed.trim() === '') {
    return null
  }

  return scaledNumber(typed, 3) ?? undefined
}

/** What is wrong with what the form holds, as the form says it, or null. */
export function applianceFormProblem(values: Record<string, string>): string | null {
  const length = cordLengthOf(values['cordLength'])

  if (length === undefined) {
    return 'Die Länge der Anschlussleitung ist eine Zahl in Metern, etwa 1,5.'
  }

  const problems = applianceProblems({
    designation: values['designation'] ?? '',
    cordLengthMilli: length,
  })

  return Object.values(problems)[0] ?? null
}

/** The values of the form as the record keeps them. */
export function asAppliance(values: Record<string, string>) {
  return {
    designation: values['designation']?.trim() ?? '',
    inventoryNumber: asTextOrNull(values['inventoryNumber']),
    location: asTextOrNull(values['location']),
    manufacturer: asTextOrNull(values['manufacturer']),
    model: asTextOrNull(values['model']),
    serialNumber: asTextOrNull(values['serialNumber']),
    protectionClass: values['protectionClass'] ?? 'I',
    mobility: values['mobility'] ?? 'portable',
    cordLengthMilli: cordLengthOf(values['cordLength']) ?? null,
    notes: asTextOrNull(values['notes']),
  }
}
