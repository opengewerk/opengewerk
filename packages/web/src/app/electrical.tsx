import type {
  CableInstallationMethod,
  CircuitFigures,
  DistributionBoardKind,
  OvercurrentDevice,
  RcdType,
  RecordState,
  TripCharacteristic,
} from '@opengewerk/domain'
import {
  cableInstallationMethodLabel,
  cableInstallationMethodName,
  cableInstallationMethods,
  cableLengthText,
  cableText,
  characteristicsFor,
  circuitProblems,
  distributionBoardKindLabel,
  distributionBoardKinds,
  inStructureOrder,
  milliText,
  overcurrentDeviceName,
  overcurrentDevices,
  overcurrentText,
  rcdText,
  rcdTypeLabel,
  rcdTypes,
  tripCharacteristicLabel,
  tripCharacteristics,
} from '@opengewerk/domain'
import { useId, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { Button, Field, FieldLabel, SelectField } from '../components/index.js'
import { refusalText } from '../sync/client.js'
import type { Draft, EditResult, SyncClient } from '../sync/client.js'
import { count, maybeText, oneOf, text } from '../sync/fields.js'
import { useRelated } from '../sync/provider.js'
import { scaledNumber } from './format.js'
import { asTextOrNull, type FormField } from './record-form.js'

/**
 * The structure below an installation as both entries show it: board,
 * section, circuit, equipment.
 *
 * One module for the office and the site, like the tasks. The office builds
 * the structure and the site completes it, a circuit a technician finds
 * missing in front of the board, and both write through the same forms, so
 * that a circuit entered on a phone reads the same in the office as one
 * entered there. Only the frames around them differ.
 *
 * Everything written here goes through the outbox. The four entities are
 * field work in the sync rules, so they are created and changed without a
 * network and merged afterwards, field by field.
 */

/** The parts of one level in the order the board lists them, F2 before F10. */
export function ordered(records: readonly RecordState[]): readonly RecordState[] {
  return [...records].sort((left, right) =>
    inStructureOrder(
      {
        id: String(left['id']),
        designation: text(left, 'designation'),
        position: count(left, 'position'),
      },
      {
        id: String(right['id']),
        designation: text(right, 'designation'),
        position: count(right, 'position'),
      },
    ),
  )
}

function useOrdered(entity: string, field: string, id: string | undefined) {
  const related = useRelated(entity, field, id)

  return useMemo(() => ordered(related), [related])
}

export function useBoards(installationId: string | undefined) {
  return useOrdered('distribution_boards', 'installationId', installationId)
}

export function useSections(boardId: string | undefined) {
  return useOrdered('board_sections', 'distributionBoardId', boardId)
}

export function useCircuits(boardId: string | undefined) {
  return useOrdered('circuits', 'distributionBoardId', boardId)
}

export function useEquipment(circuitId: string | undefined) {
  return useOrdered('equipment', 'circuitId', circuitId)
}

/** The place after every sibling, for a part added at the end. */
export function nextPosition(siblings: readonly RecordState[]): number {
  return (
    siblings.reduce((highest, sibling) => Math.max(highest, count(sibling, 'position')), -1) + 1
  )
}

/**
 * Moves a part one step among its siblings and numbers them afresh. Afresh
 * rather than by swapping two numbers: after a deletion the numbers have
 * gaps, two parts added on two devices can share one, and a swap of two equal
 * numbers moves nothing. Only the parts whose number changes are written.
 */
export async function moveAmong(
  client: SyncClient,
  entity: string,
  siblings: readonly RecordState[],
  id: string,
  step: -1 | 1,
): Promise<EditResult | null> {
  const order = [...siblings]
  const from = order.findIndex((sibling) => String(sibling['id']) === id)
  const [moved] = from < 0 ? [] : order.splice(from, 1)

  if (!moved) {
    return null
  }

  order.splice(Math.max(0, Math.min(order.length, from + step)), 0, moved)

  for (const [index, sibling] of order.entries()) {
    if (count(sibling, 'position') !== index) {
      const result = await client.update(entity, String(sibling['id']), { position: index })

      if (result.outcome === 'refused') {
        return result
      }
    }
  }

  return null
}

export function boardKindOf(record: RecordState | null | undefined): DistributionBoardKind {
  return oneOf(record, 'kind', distributionBoardKinds, 'sub_distribution')
}

/** "Unterverteilung UV Küche", the way the chart heads a board. */
export function boardTitle(board: RecordState): string {
  return `${distributionBoardKindLabel[boardKindOf(board)]} ${text(board, 'designation')}`
}

function known<Value extends string>(
  record: RecordState,
  field: string,
  allowed: readonly Value[],
): Value | null {
  const value = record[field]

  return allowed.includes(value as Value) ? (value as Value) : null
}

function figure(record: RecordState, field: string): number | null {
  const value = record[field]

  return typeof value === 'number' ? value : null
}

/** The figures of a circuit record, for the texts `domain` writes them with. */
export function figuresOf(circuit: RecordState): CircuitFigures {
  return {
    overcurrentDevice: known(circuit, 'overcurrentDevice', overcurrentDevices),
    tripCharacteristic: known(circuit, 'tripCharacteristic', tripCharacteristics),
    ratedCurrentMilli: figure(circuit, 'ratedCurrentMilli'),
    rcdType: known(circuit, 'rcdType', rcdTypes),
    ratedResidualCurrentMilli: figure(circuit, 'ratedResidualCurrentMilli'),
    cableType: maybeText(circuit, 'cableType'),
    cableCores: figure(circuit, 'cableCores'),
    cableCrossSectionMilli: figure(circuit, 'cableCrossSectionMilli'),
    cableLengthMilli: figure(circuit, 'cableLengthMilli'),
    cableInstallationMethod: known(circuit, 'cableInstallationMethod', cableInstallationMethods),
  }
}

/** What there is to know about a circuit, as one line: "LS B 16 A, Typ A 30 mA, NYM-J 3 × 1,5 mm²". */
export function circuitSummary(circuit: RecordState): string | null {
  const figures = figuresOf(circuit)
  const parts = [overcurrentText(figures), rcdText(figures), cableText(figures)].filter(
    (part): part is string => part !== null,
  )

  return parts.length === 0 ? null : parts.join(', ')
}

/** "3 Stromkreise", "1 Stromkreis", "kein Stromkreis", the same words on both entries. */
export function circuitsInWords(total: number): string {
  if (total === 0) {
    return 'kein Stromkreis'
  }

  return total === 1 ? '1 Stromkreis' : `${String(total)} Stromkreise`
}

/** The address of the chart, for a link that opens it: every board, or one. */
export function circuitChartAddress(installationId: string, boardId?: string): string {
  const base = `/installations/${encodeURIComponent(installationId)}/circuit-chart`

  return boardId === undefined ? base : `${base}?board=${encodeURIComponent(boardId)}`
}

export const boardFields: readonly FormField[] = [
  {
    name: 'designation',
    label: 'Bezeichnung',
    required: true,
    hint: 'Was auf der Tür steht: HV, UV Küche.',
  },
  {
    name: 'kind',
    label: 'Art',
    required: true,
    options: distributionBoardKinds.map((kind) => ({
      value: kind,
      label: distributionBoardKindLabel[kind],
    })),
  },
  { name: 'location', label: 'Ort', hint: 'Wo er hängt: Keller, Raum 2.' },
]

/**
 * What a new board starts as: the first one of an installation is usually its
 * main distribution, every one after it a sub distribution. A starting point
 * for the form and nothing more, the list lets anybody choose the other.
 */
export function newBoard(siblings: readonly RecordState[]): RecordState {
  return { kind: siblings.length === 0 ? 'main_distribution' : 'sub_distribution' }
}

export function asBoard(values: Record<string, string>): Draft {
  return {
    designation: values['designation']?.trim() ?? '',
    kind: values['kind'] ?? 'sub_distribution',
    location: asTextOrNull(values['location']),
  }
}

export const sectionFields: readonly FormField[] = [
  { name: 'designation', label: 'Bezeichnung', required: true, hint: 'Feld 1, Reihe 2.' },
]

export function asSection(values: Record<string, string>): Draft {
  return { designation: values['designation']?.trim() ?? '' }
}

export const equipmentFields: readonly FormField[] = [
  {
    name: 'designation',
    label: 'Bezeichnung',
    required: true,
    hint: 'Welches es ist: Steckdose Arbeitsplatte.',
  },
  { name: 'kind', label: 'Art', hint: 'Steckdose, Leuchte, Durchlauferhitzer.' },
  { name: 'manufacturer', label: 'Hersteller' },
  { name: 'model', label: 'Typ', hint: 'Die Typbezeichnung vom Typenschild.' },
  { name: 'serialNumber', label: 'Seriennummer' },
]

export function asEquipment(values: Record<string, string>): Draft {
  return {
    designation: values['designation']?.trim() ?? '',
    kind: asTextOrNull(values['kind']),
    manufacturer: asTextOrNull(values['manufacturer']),
    model: asTextOrNull(values['model']),
    serialNumber: asTextOrNull(values['serialNumber']),
  }
}

/** A figure as it is typed: "16" for 16000, "1,5" for 1500. */
function milliAsInput(value: number | null): string {
  return value === null ? '' : milliText(value).replaceAll('.', '')
}

function wholeAsInput(value: number | null): string {
  return value === null ? '' : String(value)
}

/** The cable types a list offers, the ones in nearly every board. Anything else may be typed. */
const cableTypes = ['NYM-J', 'NYM-O', 'NYY-J', 'NYY-O', 'H07V-K', 'H07V-U', 'H07RN-F', 'NYCWY']

type Read = { readonly value: number | null } | { readonly problem: string }

/**
 * A figure somebody typed, in units of a given number of places, or what is
 * wrong with it.
 *
 * The unit may come along, "16 A" in a field labelled "in A": it is what a
 * breaker says, and refusing it as no number would be refusing the right
 * answer. Only the unit of the field, and only at the end.
 */
function readFigure(input: string, places: number, units: readonly string[] = []): Read {
  const trimmed = input.trim()
  const unit = units.find((candidate) => trimmed.endsWith(candidate))
  const bare = unit === undefined ? trimmed : trimmed.slice(0, -unit.length).trim()

  if (bare === '') {
    return { value: null }
  }

  const value = scaledNumber(bare, places)

  if (value !== null) {
    return { value }
  }

  // Letters are a different mistake from one decimal place too many, and
  // the sentence says which, so that nobody hunts for a comma in "sechzehn".
  if (!/^[\s+-]*[\d.,\s]+$/.test(bare)) {
    return { problem: 'Das ist keine Zahl.' }
  }

  return {
    problem:
      places === 0
        ? 'Das ist keine ganze Zahl.'
        : `Das ist keine Zahl mit höchstens ${String(places)} Nachkommastellen.`,
  }
}

const nothing = { value: '', label: 'nicht angegeben' } as const

/**
 * A circuit, with everything section 3.2 asks for.
 *
 * Not a `RecordForm`: the curve depends on the device, the figures carry a
 * unit and have to be read the way somebody in Germany types them, and a
 * problem belongs to the field that has it. The checks are the ones in
 * `domain`, the same the server asks before it takes the circuit, so a
 * figure it would refuse never reaches the outbox, where a refusal would hold
 * up everything behind it.
 *
 * Every figure may stay empty. A circuit is written down in front of a board
 * before anybody has read what the breaker says, and the chart prints what
 * is there.
 */
export function CircuitForm({
  record,
  sections,
  section,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly record?: RecordState | null
  /** The sections of the board, in order. Empty when it has none, and then there is no choice. */
  readonly sections: readonly RecordState[]
  /** The section a new circuit starts in, when it is not the record's. */
  readonly section?: string | null
  readonly submitLabel: string
  readonly onSubmit: (values: Draft) => Promise<EditResult>
  readonly onCancel?: () => void
}) {
  const start = record ? figuresOf(record) : null
  const listId = useId()
  const [designation, setDesignation] = useState(text(record, 'designation'))
  const [consumer, setConsumer] = useState(text(record, 'consumer'))
  const [inSection, setInSection] = useState(maybeText(record, 'boardSectionId') ?? section ?? '')
  const [device, setDevice] = useState<string>(start?.overcurrentDevice ?? '')
  const [characteristic, setCharacteristic] = useState<string>(start?.tripCharacteristic ?? '')
  const [ratedCurrent, setRatedCurrent] = useState(milliAsInput(start?.ratedCurrentMilli ?? null))
  const [rcdType, setRcdType] = useState<string>(start?.rcdType ?? '')
  const [residualCurrent, setResidualCurrent] = useState(
    wholeAsInput(start?.ratedResidualCurrentMilli ?? null),
  )
  const [cableType, setCableType] = useState(start?.cableType ?? '')
  const [cores, setCores] = useState(wholeAsInput(start?.cableCores ?? null))
  const [crossSection, setCrossSection] = useState(
    milliAsInput(start?.cableCrossSectionMilli ?? null),
  )
  const [length, setLength] = useState(milliAsInput(start?.cableLengthMilli ?? null))
  const [method, setMethod] = useState<string>(start?.cableInstallationMethod ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const curves = characteristicsFor(device === '' ? null : (device as OvercurrentDevice))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const read: Record<string, Read> = {
      ratedCurrentMilli: readFigure(ratedCurrent, 3, ['A']),
      ratedResidualCurrentMilli: readFigure(residualCurrent, 0, ['mA']),
      cableCores: readFigure(cores, 0),
      cableCrossSectionMilli: readFigure(crossSection, 3, ['mm²', 'mm2', 'qmm']),
      cableLengthMilli: readFigure(length, 3, ['m']),
    }
    const figures = Object.fromEntries(
      Object.entries(read).map(([field, result]) => [
        field,
        'value' in result ? result.value : null,
      ]),
    )
    const values: Draft = {
      designation: designation.trim(),
      consumer: asTextOrNull(consumer),
      ...(sections.length > 0 || maybeText(record, 'boardSectionId') !== null
        ? { boardSectionId: inSection === '' ? null : inSection }
        : {}),
      overcurrentDevice: device === '' ? null : (device as OvercurrentDevice),
      tripCharacteristic: characteristic === '' ? null : (characteristic as TripCharacteristic),
      rcdType: rcdType === '' ? null : (rcdType as RcdType),
      cableType: asTextOrNull(cableType),
      cableInstallationMethod: method === '' ? null : (method as CableInstallationMethod),
      ...figures,
    }
    const found: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(read).flatMap(([field, result]) =>
          'problem' in result ? [[field, result.problem]] : [],
        ),
      ),
    }

    for (const [field, problem] of Object.entries(circuitProblems(values))) {
      found[field] ??= problem
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await onSubmit(values)

      if (result.outcome === 'refused') {
        setTrouble(refusalText[result.reason])
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Bezeichnung"
          required
          hint="Wie es am Gerät steht: F3, -1F3."
          value={designation}
          onChange={(event) => {
            setDesignation(event.target.value)
          }}
        />
        <Field
          label="Verbraucher"
          hint="Was der Stromkreis versorgt: Steckdosen Bad, Herd."
          value={consumer}
          onChange={(event) => {
            setConsumer(event.target.value)
          }}
        />
        {sections.length > 0 ? (
          <SelectField
            label="Feld"
            value={inSection}
            options={[
              { value: '', label: 'Ohne Feld' },
              ...sections.map((option) => ({
                value: String(option['id']),
                label: text(option, 'designation'),
              })),
            ]}
            onChange={setInSection}
          />
        ) : null}
      </div>

      <Group title="Schutzeinrichtung">
        <SelectField
          label="Art"
          value={device}
          options={[
            nothing,
            ...overcurrentDevices.map((option) => ({
              value: option,
              label: overcurrentDeviceName[option],
            })),
          ]}
          onChange={(value) => {
            setDevice(value)

            // A curve that does not go with the new device goes, instead of
            // being refused on saving for a choice nobody made twice.
            const offered = characteristicsFor(value === '' ? null : (value as OvercurrentDevice))

            if (!offered.includes(characteristic as TripCharacteristic)) {
              setCharacteristic('')
            }
          }}
          {...problemOf(problems, 'overcurrentDevice')}
        />
        <SelectField
          label="Charakteristik"
          value={characteristic}
          options={[
            nothing,
            ...curves.map((option) => ({ value: option, label: tripCharacteristicLabel[option] })),
          ]}
          onChange={setCharacteristic}
          {...problemOf(problems, 'tripCharacteristic')}
        />
        <Field
          label="Nennstrom in A"
          numeric
          inputMode="decimal"
          value={ratedCurrent}
          onChange={(event) => {
            setRatedCurrent(event.target.value)
          }}
          {...problemOf(problems, 'ratedCurrentMilli')}
        />
      </Group>

      <Group title="RCD">
        <SelectField
          label="Typ"
          value={rcdType}
          options={[
            nothing,
            ...rcdTypes.map((option) => ({ value: option, label: `Typ ${rcdTypeLabel[option]}` })),
          ]}
          onChange={setRcdType}
          {...problemOf(problems, 'rcdType')}
        />
        <Field
          label="Bemessungsdifferenzstrom in mA"
          numeric
          inputMode="numeric"
          hint="Zum Beispiel 30."
          value={residualCurrent}
          onChange={(event) => {
            setResidualCurrent(event.target.value)
          }}
          {...problemOf(problems, 'ratedResidualCurrentMilli')}
        />
      </Group>

      <Group title="Leitung">
        <Field
          label="Typ"
          list={listId}
          value={cableType}
          onChange={(event) => {
            setCableType(event.target.value)
          }}
        />
        <datalist id={listId}>
          {cableTypes.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <Field
          label="Aderzahl"
          numeric
          inputMode="numeric"
          value={cores}
          onChange={(event) => {
            setCores(event.target.value)
          }}
          {...problemOf(problems, 'cableCores')}
        />
        <Field
          label="Querschnitt in mm²"
          numeric
          inputMode="decimal"
          hint="Zum Beispiel 1,5."
          value={crossSection}
          onChange={(event) => {
            setCrossSection(event.target.value)
          }}
          {...problemOf(problems, 'cableCrossSectionMilli')}
        />
        <Field
          label="Länge in m"
          numeric
          inputMode="decimal"
          value={length}
          onChange={(event) => {
            setLength(event.target.value)
          }}
          {...problemOf(problems, 'cableLengthMilli')}
        />
        <SelectField
          label="Verlegeart"
          value={method}
          options={[
            nothing,
            ...cableInstallationMethods.map((option) => ({
              value: option,
              label: cableInstallationMethodName[option],
            })),
          ]}
          onChange={setMethod}
          {...problemOf(problems, 'cableInstallationMethod')}
        />
      </Group>

      {Object.keys(problems).length > 0 ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          Nicht gespeichert. Bitte die markierten Felder ansehen.
        </p>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary" disabled={working}>
          {working ? 'Wird gespeichert' : submitLabel}
        </Button>
        {onCancel ? (
          <Button tone="quiet" onClick={onCancel} disabled={working}>
            Abbrechen
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/** The problem of a field as the prop a field takes, or nothing at all. */
function problemOf(problems: Readonly<Record<string, string>>, field: string) {
  const problem = problems[field]

  return problem === undefined ? {} : { problem }
}

/**
 * A group of fields with a heading of its own. A `fieldset` with a `legend`,
 * so that a screen reader says "Leitung, Typ" and not just "Typ" twice.
 */
function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-line pt-3">
      <legend className="pr-2">
        <FieldLabel>{title}</FieldLabel>
      </legend>
      <div className="grid gap-4 sm:grid-cols-3">{children}</div>
    </fieldset>
  )
}

/**
 * What is known about a circuit, as the facts a detail screen lists. Only
 * what is there: the list says what was entered, the form shows what was not.
 */
export function circuitFacts(circuit: RecordState): readonly { label: string; value: string }[] {
  const figures = figuresOf(circuit)

  return [
    { label: 'Verbraucher', value: maybeText(circuit, 'consumer') },
    { label: 'Schutzeinrichtung', value: overcurrentText(figures) },
    { label: 'RCD', value: rcdText(figures) },
    { label: 'Leitung', value: cableText(figures) },
    { label: 'Länge', value: cableLengthText(figures) },
    {
      label: 'Verlegeart',
      value:
        figures.cableInstallationMethod === null
          ? null
          : cableInstallationMethodLabel[figures.cableInstallationMethod],
    },
  ].filter((fact): fact is { label: string; value: string } => fact.value !== null)
}
