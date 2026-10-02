import type { RecordState } from '@opengewerk/domain'
import {
  azimuthName,
  azimuthText,
  belongsToPvSystemKind,
  inModuleOrder,
  inverterPowerText,
  moduleBatchMax,
  peakPower,
  peakPowerText,
  pvLimits,
  pvModuleProblems,
} from '@opengewerk/domain'
import { Button, Field, SelectField, useEntry } from '@opengewerk/platform-web'
import { SiteActionBar } from '@opengewerk/platform-web/site'
import {
  count,
  maybeText,
  refusalFor,
  text,
  useRecords,
  useRelated,
} from '@opengewerk/platform-web/sync'
import type { Draft, EditResult, FormField } from '@opengewerk/platform-web/sync'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type { SyncClient } from '../sync/client.js'
import { Group, nextPosition, ordered, problemOf, readFigure } from './electrical.js'

/**
 * The PV structure below a PV system as both entries show it (#300): inverter,
 * string, module, and the battery, meter or wallbox that belongs to the
 * system.
 *
 * One module for the office and the site, like the electrical structure next
 * to it: the office builds the structure and the site completes it, a string a
 * technician finds missing on the roof, and both write through the same forms.
 * Everything goes through the outbox; the three entities are field work in the
 * sync rules.
 */

function useOrdered(entity: string, field: string, id: string | undefined) {
  const related = useRelated(entity, field, id)

  return useMemo(() => ordered(related), [related])
}

export function useInverters(installationId: string | undefined) {
  return useOrdered('inverters', 'installationId', installationId)
}

export function usePvStrings(inverterId: string | undefined) {
  return useOrdered('pv_strings', 'inverterId', inverterId)
}

/** The modules of a string in the order they were put there; they have no name to sort by. */
export function usePvModules(stringId: string | undefined) {
  const related = useRelated('pv_modules', 'pvStringId', stringId)

  return useMemo(() => inModules(related), [related])
}

export function inModules(modules: readonly RecordState[]): readonly RecordState[] {
  return [...modules].sort((left, right) =>
    inModuleOrder(
      { id: String(left['id']), position: count(left, 'position') },
      { id: String(right['id']), position: count(right, 'position') },
    ),
  )
}

/** The batteries, meters and wallboxes that say they belong to this PV system. */
export function useCompanions(pvSystemId: string | undefined) {
  return useOrdered('installations', 'pvSystemId', pvSystemId)
}

/** The modules below a PV system, over its inverters and their strings. */
export function useSystemModules(installationId: string | undefined): readonly RecordState[] {
  const inverters = useInverters(installationId)
  const strings = useRecords('pv_strings')
  const modules = useRecords('pv_modules')

  return useMemo(() => {
    const ids = new Set(inverters.map((inverter) => String(inverter['id'])))
    const stringIds = new Set(
      strings
        .filter((pvString) => ids.has(text(pvString, 'inverterId')))
        .map((pvString) => String(pvString['id'])),
    )

    return modules.filter((module) => stringIds.has(text(module, 'pvStringId')))
  }, [inverters, strings, modules])
}

/**
 * The peak power of a PV system: "9,60 kWp aus 24 Modulen", and how many
 * have no figure, or null while no module has one.
 */
export function systemPeakText(modules: readonly RecordState[]): string | null {
  const { watts, unknown } = peakOf(modules)
  const known = modules.length - unknown

  if (known === 0) {
    return null
  }

  return `${peakPowerText(watts)} aus ${String(known)} ${known === 1 ? 'Modul' : 'Modulen'}${
    unknown > 0 ? `, ${String(unknown)} ohne Angabe` : ''
  }`
}

/** A whole figure of a record, or null where none is known. */
export function figureOf(record: RecordState | null | undefined, field: string): number | null {
  const value = record?.[field]

  return typeof value === 'number' ? value : null
}

/** "2 Strings", "1 String", "kein String". */
export function stringsInWords(total: number): string {
  if (total === 0) {
    return 'kein String'
  }

  return total === 1 ? '1 String' : `${String(total)} Strings`
}

/** "12 Module", "1 Modul", "keine Module". */
export function modulesInWords(total: number): string {
  if (total === 0) {
    return 'keine Module'
  }

  return total === 1 ? '1 Modul' : `${String(total)} Module`
}

function peakOf(modules: readonly RecordState[]) {
  return peakPower(modules.map((module) => ({ ratedPowerW: figureOf(module, 'ratedPowerW') })))
}

/**
 * The peak power of these modules as a table cell: "4,80 kWp", and how many
 * have none where some have, so that a sum over part of a string does not
 * read as the string's power. Empty where no module has a figure.
 */
export function peakCell(modules: readonly RecordState[]): string {
  const { watts, unknown } = peakOf(modules)

  if (unknown === modules.length) {
    return ''
  }

  return unknown === 0
    ? peakPowerText(watts)
    : `${peakPowerText(watts)}, ${String(unknown)} ohne Angabe`
}

/** "12 Module, zusammen 4,80 kWp", as the facts of a string say it. */
export function modulesPowerText(modules: readonly RecordState[]): string {
  const words = modulesInWords(modules.length)
  const peak = peakCell(modules)

  if (modules.length === 0) {
    return words
  }

  return peak === '' ? `${words}, ohne Angabe der Leistung` : `${words}, zusammen ${peak}`
}

/** "Fronius Symo GEN24 10.0 Plus", maker and model as the plate reads them. */
export function makeAndModel(record: RecordState | null | undefined): string | null {
  const parts = [maybeText(record, 'manufacturer'), maybeText(record, 'model')].filter(
    (part): part is string => part !== null,
  )

  return parts.length === 0 ? null : parts.join(' ')
}

/** "10,0 kW", or null where the plate was not read yet. */
export function inverterPower(inverter: RecordState | null | undefined): string | null {
  const watts = figureOf(inverter, 'ratedPowerW')

  return watts === null ? null : inverterPowerText(watts)
}

/**
 * An inverter in one line: "Fronius Symo GEN24 10.0 Plus, 10,0 kW, 2 Strings,
 * 24 Module, 9,60 kWp", the modules only once there are any.
 */
export function inverterLine(
  inverter: RecordState,
  strings: readonly RecordState[],
  modules: readonly RecordState[],
  withModules = true,
): string {
  const peak = peakCell(modules)

  return [
    makeAndModel(inverter),
    inverterPower(inverter),
    stringsInWords(strings.length),
    withModules && modules.length > 0 ? modulesInWords(modules.length) : null,
    withModules && peak !== '' ? peak : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
}

/** "West, 270°", "30°": where a string faces and how steep it is, or null. */
export function azimuthOf(pvString: RecordState | null | undefined): string | null {
  const degrees = figureOf(pvString, 'azimuthDeg')

  return degrees === null ? null : azimuthText(degrees)
}

export function tiltOf(pvString: RecordState | null | undefined): string | null {
  const degrees = figureOf(pvString, 'tiltDeg')

  return degrees === null ? null : `${String(degrees)}°`
}

/** "West 30°", the short form a line of the site has room for. */
function lieOf(pvString: RecordState): string | null {
  const azimuth = figureOf(pvString, 'azimuthDeg')
  const tilt = tiltOf(pvString)

  if (azimuth === null) {
    return tilt === null ? null : `Neigung ${tilt}`
  }

  return tilt === null ? azimuthName(azimuth) : `${azimuthName(azimuth)} ${tilt}`
}

/**
 * A string in one line, as the site lists it: "MPP-Eingang 2, 12 Module,
 * 4,80 kWp, West 30°", or "MPP-Eingang 2, noch keine Module".
 */
export function stringLine(pvString: RecordState, modules: readonly RecordState[]): string {
  const input = figureOf(pvString, 'mppInput')
  const peak = peakCell(modules)

  return [
    input === null ? null : `MPP-Eingang ${String(input)}`,
    modules.length === 0 ? 'noch keine Module' : modulesInWords(modules.length),
    modules.length > 0 && peak !== '' ? peak : null,
    lieOf(pvString),
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
}

/** "2 von 2": the input of a string among those of its inverter, where both are known. */
export function inputOf(
  pvString: RecordState | null | undefined,
  inverter: RecordState | null | undefined,
): string | null {
  const input = figureOf(pvString, 'mppInput')
  const inputs = figureOf(inverter, 'mppInputs')

  if (input === null) {
    return null
  }

  return inputs === null ? String(input) : `${String(input)} von ${String(inputs)}`
}

/** How many modules of a string have no serial number yet. */
export function withoutSerial(modules: readonly RecordState[]): number {
  return modules.filter((module) => maybeText(module, 'serialNumber') === null).length
}

/** "3 von 12 Modulen ohne Seriennummer.", or null when every one has one. */
export function serialsMissingText(modules: readonly RecordState[]): string | null {
  const missing = withoutSerial(modules)

  if (missing === 0) {
    return null
  }

  return missing === 1 && modules.length === 1
    ? 'Das Modul hat noch keine Seriennummer.'
    : `${String(missing)} von ${String(modules.length)} Modulen ohne Seriennummer.`
}

/** "WR 1, Fronius Symo GEN24 10.0 Plus", as the list of a battery offers an inverter. */
export function inverterChoice(inverter: RecordState): string {
  return [text(inverter, 'designation'), makeAndModel(inverter)]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ')
}

/**
 * The two fields of a battery, a meter or a wallbox that say where it belongs
 * (#300): the PV systems at its site, and the inverters of the one chosen.
 * Only for those three kinds, and the inverter only once a system is chosen;
 * the form hands back what does not stand as empty.
 */
export function companionFields(
  pvSystems: readonly RecordState[],
  inverters: readonly RecordState[],
): readonly FormField[] {
  return [
    {
      name: 'pvSystemId',
      label: 'Gehört zu PV-Anlage',
      hint: 'Nur PV-Anlagen an diesem Objekt.',
      options: [
        { value: '', label: 'Zu keiner' },
        ...pvSystems.map((system) => ({
          value: String(system['id']),
          label: text(system, 'designation'),
        })),
      ],
      shownWhen: (values) => belongsToPvSystemKind(values['kind']),
    },
    {
      name: 'inverterId',
      label: 'Am Wechselrichter',
      hint: 'Leer, wenn er an keinem hängt.',
      optionsFor: (values) => [
        { value: '', label: 'An keinem' },
        ...inverters
          .filter((inverter) => text(inverter, 'installationId') === values['pvSystemId'])
          .map((inverter) => ({ value: String(inverter['id']), label: inverterChoice(inverter) })),
      ],
      shownWhen: (values) =>
        belongsToPvSystemKind(values['kind']) && (values['pvSystemId'] ?? '') !== '',
    },
  ]
}

/** The link the two fields above hand back, as the installation keeps it. */
export function asCompanion(values: Readonly<Record<string, string>>): Draft {
  const pvSystemId = values['pvSystemId'] ?? ''
  const inverterId = values['inverterId'] ?? ''

  return {
    pvSystemId: pvSystemId === '' ? null : pvSystemId,
    inverterId: pvSystemId === '' || inverterId === '' ? null : inverterId,
  }
}

// --- The forms -----------------------------------------------------------------------------------

/** One field of a form of the PV structure. */
export interface PvField {
  readonly name: string
  readonly label: string
  /** The unit, beside the figure on site and in the label in the office: "kW". */
  readonly unit?: string
  readonly hint?: string
  readonly required?: boolean
  /**
   * A figure, read the way somebody in Germany types it and kept in these
   * places: 3 for kilowatts kept in watts, 0 for a whole number.
   */
  readonly places?: number
  /** A choice; the values are the figures as text, and empty is "not given". */
  readonly options?: readonly { readonly value: string; readonly label: string }[]
  /** The box it stands in with the fields beside it, "Lage". */
  readonly group?: string
}

/** A figure as it is typed: 10000 watts as "10" kilowatts, 4600 as "4,6". */
function figureAsInput(value: unknown, places: number): string {
  if (typeof value !== 'number') {
    return ''
  }

  return new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: places,
    useGrouping: false,
  }).format(value / 10 ** places)
}

function startOf(field: PvField, record: RecordState | null | undefined): string {
  const value = record?.[field.name]

  if (field.places !== undefined && field.options === undefined) {
    return figureAsInput(value, field.places)
  }

  return value === null || value === undefined ? '' : String(value)
}

/** What the fields say, as the record keeps it, and what is wrong with any of them. */
function readAll(
  fields: readonly PvField[],
  inputs: Readonly<Record<string, string>>,
): { readonly values: Draft; readonly problems: Record<string, string> } {
  const values: Record<string, Draft[string]> = {}
  const problems: Record<string, string> = {}

  for (const field of fields) {
    const input = inputs[field.name] ?? ''

    if (field.options) {
      values[field.name] = input === '' ? null : field.places === undefined ? input : Number(input)
    } else if (field.places !== undefined) {
      const read = readFigure(input, field.places, field.unit ? [field.unit] : [])

      if ('value' in read) {
        values[field.name] = read.value
      } else {
        problems[field.name] = read.problem
      }
    } else {
      const trimmed = input.trim()

      values[field.name] = field.required ? trimmed : trimmed === '' ? null : trimmed
    }
  }

  return { values, problems }
}

/**
 * A form of the PV structure, in the one shape both entries use.
 *
 * Not a `RecordForm`: the power is typed in kilowatts and kept in watts, the
 * figures are read the way somebody in Germany types them, a problem belongs
 * to the field that has it, and the directions of a string stand in a box of
 * their own. The rules are the ones in `domain`, the same the server asks, so
 * that a figure it would refuse never reaches the outbox.
 */
export function PvForm({
  fields,
  record,
  rules,
  columns,
  note,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly fields: readonly PvField[]
  readonly record?: RecordState | null
  /** The rules of `domain` over the values, one sentence per field. */
  readonly rules?: (values: Draft) => Readonly<Record<string, string>>
  /** The columns of the fields outside a box from 640 pixels on, in the office. */
  readonly columns?: string
  /** A sentence under the fields, for what is typed so far. */
  readonly note?: (inputs: Readonly<Record<string, string>>) => ReactNode
  readonly submitLabel: string | ((inputs: Readonly<Record<string, string>>) => string)
  readonly onSubmit: (values: Draft) => Promise<EditResult>
  readonly onCancel?: () => void
}) {
  const site = useEntry() === 'site'
  const formId = useId()
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, startOf(field, record)])),
  )
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const label = typeof submitLabel === 'string' ? submitLabel : submitLabel(inputs)

  async function submit(event: FormEvent) {
    event.preventDefault()

    // One press is one write: a batch of modules sent twice is twice the roof.
    if (working) {
      return
    }

    setTrouble(null)

    const read = readAll(fields, inputs)
    const found: Record<string, string> = { ...read.problems }

    for (const [field, problem] of Object.entries(rules?.(read.values) ?? {})) {
      found[field] ??= problem
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await onSubmit(read.values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
      }
    } finally {
      setWorking(false)
    }
  }

  const control = (field: PvField) => {
    const change = (value: string) => {
      setInputs((current) => ({ ...current, [field.name]: value }))
    }

    if (field.options) {
      return (
        <SelectField
          key={field.name}
          label={field.label}
          value={inputs[field.name] ?? ''}
          options={field.options}
          hint={field.hint}
          onChange={change}
          {...problemOf(problems, field.name)}
        />
      )
    }

    const figure = field.places !== undefined

    return (
      <Field
        key={field.name}
        label={site || !field.unit ? field.label : `${field.label} in ${field.unit}`}
        required={field.required}
        hint={field.hint}
        numeric={figure}
        inputMode={figure ? (field.places === 0 ? 'numeric' : 'decimal') : undefined}
        {...(site && field.unit ? { unit: field.unit } : {})}
        value={inputs[field.name] ?? ''}
        onChange={(event) => {
          change(event.target.value)
        }}
        {...problemOf(problems, field.name)}
      />
    )
  }

  const loose = fields.filter((field) => field.group === undefined)
  const groups = [...new Set(fields.flatMap((field) => (field.group ? [field.group] : [])))]

  return (
    <form
      id={formId}
      className={clsx('flex flex-col', site ? 'gap-3.5' : 'grow gap-3')}
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <div className={site ? 'flex flex-col gap-3.5' : clsx('grid gap-3 sm:grid-cols-2', columns)}>
        {loose.map(control)}
      </div>

      {groups.map((group) => (
        <Group key={group} title={group} columns="two">
          {fields.filter((field) => field.group === group).map(control)}
        </Group>
      ))}

      {note ? (
        <p className={clsx('leading-[1.4] text-ink-muted', site ? 'text-[15px]' : 'text-[13px]')}>
          {note(inputs)}
        </p>
      ) : null}

      {Object.keys(problems).length > 0 ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          Nicht gespeichert. Bitte die markierten Felder ansehen.
        </p>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {site ? (
        <SiteActionBar>
          {onCancel ? (
            <Button wide className="flex-1 basis-0" onClick={onCancel} disabled={working}>
              Abbrechen
            </Button>
          ) : null}
          <Button
            type="submit"
            form={formId}
            tone="primary"
            wide
            icon={Check}
            className="flex-2 basis-0"
            disabled={working}
          >
            {working ? 'Wird gespeichert' : label}
          </Button>
        </SiteActionBar>
      ) : (
        <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {onCancel ? (
            <Button onClick={onCancel} disabled={working}>
              Abbrechen
            </Button>
          ) : null}
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Wird gespeichert' : label}
          </Button>
        </div>
      )}
    </form>
  )
}

export const inverterFields: readonly PvField[] = [
  {
    name: 'designation',
    label: 'Bezeichnung',
    required: true,
    hint: 'Wie es am Gerät oder im Stringplan steht.',
  },
  { name: 'manufacturer', label: 'Hersteller' },
  { name: 'model', label: 'Modell' },
  { name: 'serialNumber', label: 'Seriennummer' },
  {
    name: 'ratedPowerW',
    label: 'Nennleistung',
    unit: 'kW',
    places: 3,
    hint: 'Die Leistung am Netz, zum Beispiel 10,0.',
  },
  {
    name: 'mppInputs',
    label: 'MPP-Eingänge',
    places: 0,
    hint: 'Wie viele Strings er getrennt regelt.',
  },
]

/**
 * The fields of a string. The input is a choice among the inputs of its
 * inverter, all 24 where the inverter does not say, and the one the string
 * names kept among them, so that an inverter written down with fewer does not
 * quietly move the string.
 */
export function stringFields(
  inverter: RecordState | null | undefined,
  pvString?: RecordState | null,
): readonly PvField[] {
  const inputs = figureOf(inverter, 'mppInputs')
  const current = figureOf(pvString, 'mppInput')
  const offered = Math.max(inputs ?? pvLimits.mppInputs, current ?? 0)

  return [
    {
      name: 'designation',
      label: 'Bezeichnung',
      required: true,
      hint: 'Wie es im Stringplan steht: String 2, S2.',
    },
    {
      name: 'mppInput',
      label: 'MPP-Eingang',
      places: 0,
      hint:
        inputs === null
          ? 'Wie viele der Wechselrichter hat, steht an ihm.'
          : `Der Wechselrichter hat ${String(inputs)}.`,
      options: [
        { value: '', label: 'nicht angegeben' },
        ...Array.from({ length: offered }, (_, index) => ({
          value: String(index + 1),
          label: `Eingang ${String(index + 1)}`,
        })),
      ],
    },
    {
      name: 'azimuthDeg',
      label: 'Ausrichtung',
      unit: 'Grad',
      places: 0,
      group: 'Lage',
      hint: '0 Nord, 90 Ost, 180 Süd, 270 West.',
    },
    {
      name: 'tiltDeg',
      label: 'Neigung',
      unit: 'Grad',
      places: 0,
      group: 'Lage',
      hint: '0 flach, 90 senkrecht.',
    },
  ]
}

export const moduleFields: readonly PvField[] = [
  { name: 'manufacturer', label: 'Hersteller' },
  { name: 'model', label: 'Modell' },
  {
    name: 'serialNumber',
    label: 'Seriennummer',
    hint: 'Groß und klein wie auf dem Etikett.',
  },
  { name: 'ratedPowerW', label: 'Leistung', unit: 'Wp', places: 0, hint: 'Zum Beispiel 400.' },
]

/** The fields of "Module anlegen": how many, and what all of them are. */
export const moduleBatchFields: readonly PvField[] = [
  {
    name: 'count',
    label: 'Anzahl',
    required: true,
    places: 0,
    hint: `Höchstens ${String(moduleBatchMax)} auf einmal.`,
  },
  { name: 'manufacturer', label: 'Hersteller' },
  { name: 'model', label: 'Modell' },
  { name: 'ratedPowerW', label: 'Leistung', unit: 'Wp', places: 0, hint: 'Zum Beispiel 400.' },
]

export function batchProblems(values: Draft): Readonly<Record<string, string>> {
  const total = values['count']
  const problems: Record<string, string> = { ...pvModuleProblems(values) }

  if (typeof total !== 'number' || total < 1 || total > moduleBatchMax) {
    problems['count'] = `Auf einmal gehen 1 bis ${String(moduleBatchMax)} Module.`
  }

  return problems
}

/**
 * Writes a batch of modules at the end of a string, one operation each, and
 * answers with the first refusal, or with the last one queued. What was
 * queued before a refusal stays queued: each module is a record of its own.
 */
export async function addModules(
  client: SyncClient,
  stringId: string,
  modules: readonly RecordState[],
  values: Draft,
): Promise<EditResult> {
  const { count: total, ...shared } = values
  const times = typeof total === 'number' ? total : 0
  const from = nextPosition(modules)
  let last: EditResult = { outcome: 'queued', id: stringId }

  for (let index = 0; index < times; index += 1) {
    last = await client.create('pv_modules', {
      ...shared,
      pvStringId: stringId,
      position: from + index,
    })

    if (last.outcome === 'refused') {
      return last
    }
  }

  return last
}

/** How many modules the batch form would add for what is typed, or null while it is no count. */
export function batchCount(inputs: Readonly<Record<string, string>>): number | null {
  const read = readFigure(inputs['count'] ?? '', 0)

  return 'value' in read && read.value !== null && read.value >= 1 && read.value <= moduleBatchMax
    ? read.value
    : null
}

/**
 * What a new batch starts as: the maker, model and power of the modules the
 * string has, since a string is one kind of module nearly always.
 */
export function batchStart(modules: readonly RecordState[]): RecordState {
  const last = modules.at(-1)

  return {
    manufacturer: maybeText(last, 'manufacturer'),
    model: maybeText(last, 'model'),
    ratedPowerW: figureOf(last, 'ratedPowerW'),
  }
}
