import {
  type BlockCircuit,
  type BlockField,
  circuitBlocks,
  type FieldValue,
  fieldsOf,
  type FormDefinition,
  type FormField,
  formRecordProblem,
  formValuesText,
  type FormValue,
  type FormValues,
  formatMeasured,
  type GroupBlock,
  type GroupField,
  limitVerdict,
  type MeasurementField,
  measurementUnitSign,
  type NumberField,
  readFormValues,
  type RecordState,
  sealProblems,
  type SignatureValue,
  templateValues,
  type TripCharacteristic,
  tripCharacteristicLabel,
  tripCharacteristics,
} from '@opengewerk/domain'
import { elektroRegistry, elektroRules } from '@opengewerk/gewerk-elektro'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { Copy, Eye, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import {
  Button,
  Field,
  FieldLabel,
  SelectField,
  Status,
  statusIcons,
  TextArea,
  useEntry,
} from '../components/index.js'
import { type EditResult, refusalText, type SyncClient } from '../sync/client.js'
import { maybeText, text } from '../sync/fields.js'
import { useRecords, useRelated, useSync, useSyncStatus } from '../sync/provider.js'
import { ordered, useBoards } from './electrical.js'
import { amount, date, scaledNumber, today } from './format.js'
import { SignaturePicture } from './signature.js'

/**
 * The test protocol of #79 on both entries, over the form engine of #78.
 *
 * One module for the office and the site, like the structure of an
 * installation: the site fills in a protocol in front of the board, without
 * a network, and the office finds it at the installation, reads it and prints
 * it. The form is drawn from its definition, field by field; nothing here
 * knows what a loop impedance is, only what a measured value with a limit is.
 *
 * The values travel as one field of JSON text through the outbox, so a form
 * keeps what is typed in a draft of its own and writes it when somebody saves:
 * a record written on every keystroke would put the whole protocol into the
 * outbox twice for every figure.
 */

/** The forms this build fills in and reads, those of the trade packages; the server asks the same. */
export const protocolRegistry = elektroRegistry

/** The limits the verdicts are asked of, the day of the test deciding which apply. */
export const protocolRules = elektroRules

export function definitionOf(record: RecordState): FormDefinition | null {
  const key = record['definitionKey']
  const version = record['definitionVersion']

  return typeof key === 'string' && typeof version === 'number'
    ? protocolRegistry.definitionFor(key, version)
    : null
}

export function valuesOf(record: RecordState): FormValues {
  return readFormValues(record['values']) ?? {}
}

export function isSigned(record: RecordState): boolean {
  return record['status'] === 'signed'
}

/** The protocols of an installation, the newest test first. */
export function useProtocols(installationId: string | undefined): readonly RecordState[] {
  const related = useRelated('form_records', 'installationId', installationId)

  return useMemo(
    () =>
      [...related].sort(
        (left, right) =>
          text(right, 'performedOn').localeCompare(text(left, 'performedOn')) ||
          String(right['id']).localeCompare(String(left['id'])),
      ),
    [related],
  )
}

function tripOf(circuit: RecordState): TripCharacteristic | null {
  const value = circuit['tripCharacteristic']

  return tripCharacteristics.includes(value as TripCharacteristic)
    ? (value as TripCharacteristic)
    : null
}

function figureOf(circuit: RecordState, field: string): number | null {
  const value = circuit[field]

  return typeof value === 'number' ? value : null
}

/**
 * The circuits of an installation as a block keeps them, in the order of the
 * circuit chart: board by board, on each the circuits on the board directly
 * first and then section by section, as the chart on the door lists them.
 * With more than one board the board goes in front of the designation, since
 * F1 is then no longer one circuit.
 */
export function useBlockCircuits(
  installationId: string | undefined,
): readonly (BlockCircuit & { readonly id: string })[] {
  const boards = useBoards(installationId)
  const sections = useRecords('board_sections')
  const circuits = useRecords('circuits')

  return useMemo(() => {
    const several = boards.length > 1

    return boards.flatMap((board) => {
      const own = ordered(
        sections.filter((section) => section['distributionBoardId'] === board['id']),
      )
      const known = new Set(own.map((section) => String(section['id'])))
      const onBoard = circuits.filter((circuit) => circuit['distributionBoardId'] === board['id'])
      // A circuit whose section is gone, or not on this device yet, counts as
      // on the board directly, the way the chart prints it.
      const direct = ordered(
        onBoard.filter((circuit) => {
          const section = maybeText(circuit, 'boardSectionId')

          return section === null || !known.has(section)
        }),
      )
      const inChartOrder = [
        ...direct,
        ...own.flatMap((section) =>
          ordered(onBoard.filter((circuit) => circuit['boardSectionId'] === section['id'])),
        ),
      ]

      return inChartOrder.map((circuit) => ({
        id: String(circuit['id']),
        designation: several
          ? `${text(board, 'designation')} ${text(circuit, 'designation')}`
          : text(circuit, 'designation'),
        consumer: maybeText(circuit, 'consumer'),
        tripCharacteristic: tripOf(circuit),
        ratedCurrentMilli: figureOf(circuit, 'ratedCurrentMilli'),
        ratedResidualCurrentMilli: figureOf(circuit, 'ratedResidualCurrentMilli'),
      }))
    })
  }, [boards, sections, circuits])
}

/** What a circuit is protected by, as a line under its designation: "B 16 A, 30 mA". */
export function circuitProtection(circuit: BlockCircuit): string | null {
  const breaker =
    circuit.ratedCurrentMilli === null
      ? null
      : [
          circuit.tripCharacteristic ? tripCharacteristicLabel[circuit.tripCharacteristic] : null,
          `${amount(circuit.ratedCurrentMilli)} A`,
        ]
          .filter((part): part is string => part !== null)
          .join(' ')
  const rcd =
    circuit.ratedResidualCurrentMilli === null
      ? null
      : `${String(circuit.ratedResidualCurrentMilli)} mA`
  const parts = [breaker, rcd].filter((part): part is string => part !== null)

  return parts.length === 0 ? null : parts.join(', ')
}

/**
 * Only what a definition knows, for values carried over from a form of an
 * older version: a key it no longer has would make the new form refused.
 */
function knownTo(definition: FormDefinition, values: FormValues): FormValues {
  const kept: Record<string, FormValue> = {}

  for (const field of fieldsOf(definition)) {
    const value = values[field.key]

    if (value === undefined) {
      continue
    }

    if (field.kind === 'group') {
      kept[field.key] = (Array.isArray(value) ? (value as readonly GroupBlock[]) : []).map(
        (block) => ({
          ...block,
          values: Object.fromEntries(
            Object.entries(block.values).filter(([key]) =>
              field.fields.some((nested) => nested.key === key),
            ),
          ),
        }),
      )
      continue
    }

    kept[field.key] = value
  }

  return kept
}

/**
 * The values a new protocol starts with: those of the last one where it is
 * taken as the template (#79), without what was measured and signed, and
 * every group per circuit laid over the chart as it is now.
 */
export function startingValues(
  definition: FormDefinition,
  circuits: readonly (BlockCircuit & { readonly id: string })[],
  template: RecordState | null,
): FormValues {
  const templateDefinition = template ? definitionOf(template) : null
  const carried =
    template && templateDefinition
      ? knownTo(definition, templateValues(templateDefinition, valuesOf(template)))
      : {}
  const values: Record<string, FormValue> = { ...carried }

  for (const field of fieldsOf(definition)) {
    if (field.kind === 'group' && field.repeat === 'circuits') {
      const blocks = values[field.key]

      values[field.key] = circuitBlocks(
        Array.isArray(blocks) ? (blocks as readonly GroupBlock[]) : [],
        circuits,
      )
    }
  }

  return values
}

/** A new protocol at an installation, through the outbox like everything written on site. */
export async function startProtocol(
  client: SyncClient,
  input: {
    readonly definition: FormDefinition
    readonly installationId: string
    readonly jobId: string | null
    readonly circuits: readonly (BlockCircuit & { readonly id: string })[]
    readonly template: RecordState | null
  },
): Promise<EditResult> {
  return client.create('form_records', {
    definitionKey: input.definition.key,
    definitionVersion: input.definition.version,
    installationId: input.installationId,
    jobId: input.jobId,
    performedOn: today(),
    status: 'draft',
    values: formValuesText(startingValues(input.definition, input.circuits, input.template)),
  })
}

/**
 * The protocols of an installation, and the way to a new one: blank, or with
 * the last one as its template, which keeps what describes the installation
 * and the test and leaves out what was measured.
 */
export function ProtocolsList({
  installationId,
  jobId,
  pathOf,
  onStarted,
}: {
  readonly installationId: string
  readonly jobId: string | null
  /** Where a protocol opens, on the entry that shows the list. */
  readonly pathOf: (recordId: string) => string
  readonly onStarted: (recordId: string) => void
}) {
  const client = useSync()
  const entry = useEntry()
  const protocols = useProtocols(installationId)
  const circuits = useBlockCircuits(installationId)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function start(definition: FormDefinition, template: RecordState | null) {
    setWorking(true)
    setTrouble(null)

    try {
      const made = await startProtocol(client, {
        definition,
        installationId,
        jobId,
        circuits,
        template,
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalText[made.reason])
      } else {
        onStarted(made.id)
      }
    } finally {
      setWorking(false)
    }
  }

  if (entry === 'office') {
    // The card "Prüfprotokolle" of the record of an installation, as the
    // canvas draws it (#219): a line per protocol with its day and its state,
    // then the way to a new one, and to one that starts from the last.
    return (
      <div className="flex flex-col gap-2.5">
        {protocols.length === 0 ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            An dieser Anlage gibt es noch kein Prüfprotokoll.
          </p>
        ) : (
          <ul>
            {/* In the order they were done, as the card lists them, so that the
                newest stands right above the way to the next. */}
            {[...protocols].reverse().map((protocol) => {
              const id = String(protocol['id'])

              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-row py-2 last:border-b-0"
                >
                  <Link
                    to={pathOf(id)}
                    className="text-[14px] font-medium text-copper-text underline underline-offset-2"
                  >
                    {definitionOf(protocol)?.title ?? 'Formular einer anderen Fassung'}
                  </Link>
                  <div className="grow" />
                  <span className="numeric text-[13px] text-ink-faint">
                    {date(protocol['performedOn'])}
                    {client.isPending('form_records', id) ? ', noch nicht übertragen' : ''}
                  </span>
                  {isSigned(protocol) ? (
                    <Status tone="done" icon={statusIcons.sign}>
                      Unterschrieben
                    </Status>
                  ) : (
                    <Status tone="draft">Entwurf</Status>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {circuits.length === 0 ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Gemessen wird je Stromkreis aus dem Stromkreisverzeichnis. Solange die Anlage keinen
            hat, bleibt der Teil "Messen" leer.
          </p>
        ) : null}

        {protocolRegistry.current().map((definition) => {
          const template = protocols.find(
            (protocol) => protocol['definitionKey'] === definition.key && isSigned(protocol),
          )

          return (
            <div key={definition.key} className="flex flex-col items-start gap-2.5">
              <Button
                icon={Plus}
                disabled={working}
                onClick={() => {
                  void start(definition, null)
                }}
              >
                {`${definition.title} anlegen`}
              </Button>
              {template ? (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => {
                    void start(definition, template)
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-copper-text underline underline-offset-2"
                >
                  <Copy size={14} strokeWidth={1.9} aria-hidden="true" />
                  {`Mit dem Protokoll vom ${date(template['performedOn'])} als Vorlage`}
                </button>
              ) : null}
            </div>
          )
        })}

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {protocols.length === 0 ? (
        <p className="text-body text-ink-muted">
          An dieser Anlage gibt es noch kein Prüfprotokoll.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {protocols.map((protocol) => {
            const id = String(protocol['id'])

            return (
              <li key={id}>
                <Link
                  to={pathOf(id)}
                  className="flex flex-col gap-1 p-3 rounded-card border border-line bg-surface min-h-tap"
                >
                  <span className="text-body font-semibold">
                    {definitionOf(protocol)?.title ?? 'Formular einer anderen Fassung'}
                  </span>
                  <span className="text-body text-ink-muted">
                    {[
                      date(protocol['performedOn']),
                      isSigned(protocol) ? 'unterschrieben' : 'Entwurf',
                      client.isPending('form_records', id) ? 'noch nicht übertragen' : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(', ')}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {circuits.length === 0 ? (
        <p className="text-body text-ink-muted">
          Gemessen wird je Stromkreis aus dem Stromkreisverzeichnis. Solange die Anlage keinen hat,
          bleibt der Teil "Messen" leer.
        </p>
      ) : null}

      {protocolRegistry.current().map((definition) => {
        // The last signed one: a draft is a test nobody has vouched for yet.
        const template = protocols.find(
          (protocol) => protocol['definitionKey'] === definition.key && isSigned(protocol),
        )

        return (
          <div key={definition.key} className="flex flex-col gap-2">
            <Button
              tone="secondary"
              wide
              disabled={working}
              onClick={() => {
                void start(definition, null)
              }}
            >
              {`${definition.title} anlegen`}
            </Button>
            {template ? (
              <Button
                tone="quiet"
                wide
                disabled={working}
                onClick={() => {
                  void start(definition, template)
                }}
              >
                {`Mit dem Protokoll vom ${date(template['performedOn'])} als Vorlage`}
              </Button>
            ) : null}
          </div>
        )
      })}

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </div>
  )
}

/** How a limit reads under a value, with the place it comes from. */
export function Verdict({
  field,
  value,
  circuit,
  performedOn,
}: {
  readonly field: MeasurementField
  readonly value: FieldValue | undefined
  readonly circuit: BlockCircuit | null
  readonly performedOn: string
}) {
  if (!field.limit) {
    return null
  }

  const verdict = limitVerdict(field, typeof value === 'number' ? value : null, {
    rules: protocolRules,
    on: performedOn,
    circuit,
  })

  return (
    <p
      className={clsx(
        'text-table',
        verdict.within === false ? 'font-semibold text-conflict' : 'text-ink-muted',
      )}
    >
      {verdict.text}
      {verdict.source ? ` Quelle: ${verdict.source}.` : null}
    </p>
  )
}

/**
 * A figure as typed, kept as text until it reads as one. A value that does
 * not read is not written into the draft, and the field says so; the draft
 * keeps the last one that did.
 */
function FigureInput({
  field,
  value,
  onChange,
}: {
  readonly field: NumberField | MeasurementField
  readonly value: FieldValue | undefined
  readonly onChange: (value: number | undefined) => void
}) {
  const [typed, setTyped] = useState(typeof value === 'number' ? amount(value) : '')
  const [problem, setProblem] = useState<string | undefined>(undefined)

  return (
    <Field
      label={`${field.label} in ${measurementUnitSign[field.unit]}`}
      hint={field.hint}
      inputMode="decimal"
      autoComplete="off"
      numeric
      value={typed}
      problem={problem}
      onChange={(event) => {
        const input = event.target.value
        const read = scaledNumber(input, 3)

        setTyped(input)

        if (input.trim() === '') {
          setProblem(undefined)
          onChange(undefined)
        } else if (read === null) {
          setProblem('Eine Zahl, etwa 0,85.')
        } else {
          setProblem(undefined)
          onChange(read)
        }
      }}
    />
  )
}

const unanswered = { value: '', label: 'nicht angegeben' } as const

/**
 * One field of a section or a block, as an input. Also the input of the
 * fields a business gives its reports (#78), which are text, numbers,
 * choices and yes or no and so never ask for a circuit or a photo.
 */
export function FieldInput({
  field,
  value,
  circuit,
  performedOn,
  photos,
  onChange,
}: {
  readonly field: BlockField
  readonly value: FieldValue | undefined
  readonly circuit: BlockCircuit | null
  readonly performedOn: string
  readonly photos: readonly { readonly value: string; readonly label: string }[]
  readonly onChange: (value: FieldValue | undefined) => void
}) {
  switch (field.kind) {
    case 'text':
      return field.multiline ? (
        <TextArea
          label={field.label}
          hint={field.hint}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : event.target.value)
          }}
        />
      ) : (
        <Field
          label={field.label}
          hint={field.hint}
          autoComplete="off"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : event.target.value)
          }}
        />
      )
    case 'number':
      return <FigureInput field={field} value={value} onChange={onChange} />
    case 'measurement':
      return (
        <div className="flex flex-col gap-1">
          <FigureInput field={field} value={value} onChange={onChange} />
          <Verdict field={field} value={value} circuit={circuit} performedOn={performedOn} />
        </div>
      )
    case 'choice':
      return (
        <SelectField
          label={field.label}
          hint={field.hint}
          value={typeof value === 'string' ? value : ''}
          options={[unanswered, ...field.options]}
          onChange={(chosen) => {
            onChange(chosen === '' ? undefined : chosen)
          }}
        />
      )
    case 'yes_no':
      return (
        <SelectField
          label={field.label}
          hint={field.hint}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          options={[unanswered, { value: 'yes', label: 'ja' }, { value: 'no', label: 'nein' }]}
          onChange={(chosen) => {
            onChange(chosen === 'yes' ? true : chosen === 'no' ? false : undefined)
          }}
        />
      )
    case 'photo':
      return (
        <SelectField
          label={field.label}
          hint={field.hint ?? 'Ein Foto aus den Dateien der Anlage.'}
          value={typeof value === 'string' ? value : ''}
          options={[{ value: '', label: 'keines' }, ...photos]}
          onChange={(chosen) => {
            onChange(chosen === '' ? undefined : chosen)
          }}
        />
      )
  }
}

/** A value as it is read, for a protocol that is signed. */
export function shownValue(
  field: BlockField,
  value: FieldValue | undefined,
  photos: readonly { readonly value: string; readonly label: string }[],
): string {
  if (value === undefined) {
    return 'nicht angegeben'
  }

  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? value : ''
    case 'number':
    case 'measurement':
      return typeof value === 'number' ? formatMeasured(value, field.unit, field.decimals) : ''
    case 'choice':
      return field.options.find((option) => option.value === value)?.label ?? ''
    case 'yes_no':
      return value === true ? 'ja' : 'nein'
    case 'photo':
      return photos.find((photo) => photo.value === value)?.label ?? 'ein Foto der Anlage'
  }
}

export function FieldText({
  field,
  value,
  circuit,
  performedOn,
  photos,
}: {
  readonly field: BlockField
  readonly value: FieldValue | undefined
  readonly circuit: BlockCircuit | null
  readonly performedOn: string
  readonly photos: readonly { readonly value: string; readonly label: string }[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{field.label}</FieldLabel>
      <p className={clsx('text-body whitespace-pre-line', value === undefined && 'text-ink-muted')}>
        {shownValue(field, value, photos)}
      </p>
      {field.kind === 'measurement' ? (
        <Verdict field={field} value={value} circuit={circuit} performedOn={performedOn} />
      ) : null}
    </div>
  )
}

export function blocksOf(value: FormValue | undefined): readonly GroupBlock[] {
  return Array.isArray(value) ? (value as readonly GroupBlock[]) : []
}

/** The name of a block: its circuit and what hangs on it, or its place among free ones. */
export function blockHeading(block: GroupBlock, index: number): string {
  return block.circuit
    ? [block.circuit.designation, block.circuit.consumer].filter(Boolean).join(' ')
    : `Block ${String(index + 1)}`
}

/** How many fields of a block are filled in. */
export function filledIn(field: GroupField, block: GroupBlock): number {
  return field.fields.filter((nested) => block.values[nested.key] !== undefined).length
}

/** How many measured values of a block lie outside their limits. */
export function outsideIn(field: GroupField, block: GroupBlock, performedOn: string): number {
  return field.fields.filter((nested) => {
    const value = block.values[nested.key]

    return (
      nested.kind === 'measurement' &&
      typeof value === 'number' &&
      limitVerdict(nested, value, { rules: protocolRules, on: performedOn, circuit: block.circuit })
        .within === false
    )
  }).length
}

/**
 * One block of a group: a circuit and what was measured on it, folded to a
 * line so that sixty circuits stay a list somebody can find their way in.
 */
function BlockCard({
  field,
  block,
  index,
  performedOn,
  photos,
  editable,
  onChange,
  onRemove,
}: {
  readonly field: GroupField
  readonly block: GroupBlock
  readonly index: number
  readonly performedOn: string
  readonly photos: readonly { readonly value: string; readonly label: string }[]
  readonly editable: boolean
  readonly onChange: (block: GroupBlock) => void
  readonly onRemove: (() => void) | null
}) {
  const heading = blockHeading(block, index)
  const protection = block.circuit ? circuitProtection(block.circuit) : null
  const filled = filledIn(field, block)
  const outside = outsideIn(field, block, performedOn)

  return (
    <details className="rounded-card border border-line bg-surface">
      <summary className="flex flex-col gap-1 p-3 min-h-tap cursor-pointer">
        <span className="text-body font-semibold">{heading}</span>
        <span className={clsx('text-table', outside > 0 ? 'text-conflict' : 'text-ink-muted')}>
          {[
            protection,
            filled === 0
              ? 'noch nichts eingetragen'
              : `${String(filled)} von ${String(field.fields.length)} eingetragen`,
            outside === 0
              ? null
              : outside === 1
                ? '1 Wert außerhalb'
                : `${String(outside)} Werte außerhalb`,
          ]
            .filter((part): part is string => part !== null)
            .join(', ')}
        </span>
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-3">
        {field.fields.map((nested) =>
          editable ? (
            <FieldInput
              key={nested.key}
              field={nested}
              value={block.values[nested.key]}
              circuit={block.circuit}
              performedOn={performedOn}
              photos={photos}
              onChange={(value) => {
                const values: Record<string, FieldValue> = { ...block.values }

                if (value === undefined) {
                  delete values[nested.key]
                } else {
                  values[nested.key] = value
                }

                onChange({ ...block, values })
              }}
            />
          ) : (
            <FieldText
              key={nested.key}
              field={nested}
              value={block.values[nested.key]}
              circuit={block.circuit}
              performedOn={performedOn}
              photos={photos}
            />
          ),
        )}
        {onRemove ? (
          <Button tone="quiet" onClick={onRemove}>
            Block entfernen
          </Button>
        ) : null}
      </div>
    </details>
  )
}

/** A repeating group: its blocks, and for one per circuit the way to follow the chart. */
function GroupSection({
  field,
  value,
  circuits,
  performedOn,
  photos,
  editable,
  onChange,
}: {
  readonly field: GroupField
  readonly value: FormValue | undefined
  readonly circuits: readonly (BlockCircuit & { readonly id: string })[]
  readonly performedOn: string
  readonly photos: readonly { readonly value: string; readonly label: string }[]
  readonly editable: boolean
  readonly onChange: (blocks: readonly GroupBlock[]) => void
}) {
  const blocks = blocksOf(value)
  const followed = field.repeat === 'circuits' ? circuitBlocks(blocks, circuits) : blocks
  const behind =
    editable &&
    field.repeat === 'circuits' &&
    formValuesText({ blocks: followed }) !== formValuesText({ blocks })

  return (
    <div className="flex flex-col gap-2">
      {behind ? (
        <div className="flex flex-col gap-2 p-3 rounded-card border border-line bg-surface-sunken">
          <p className="text-body">
            Das Stromkreisverzeichnis der Anlage hat sich geändert, seit die Blöcke angelegt wurden.
          </p>
          <Button
            tone="secondary"
            onClick={() => {
              onChange(followed)
            }}
          >
            Stromkreise übernehmen
          </Button>
        </div>
      ) : null}

      {blocks.length === 0 ? (
        <p className="text-body text-ink-muted">
          {field.repeat === 'circuits'
            ? 'Die Anlage hat kein Stromkreisverzeichnis, aus dem die Blöcke kommen.'
            : 'Noch kein Block.'}
        </p>
      ) : (
        blocks.map((block, index) => (
          <BlockCard
            key={block.circuitId ?? `free-${String(index)}`}
            field={field}
            block={block}
            index={index}
            performedOn={performedOn}
            photos={photos}
            editable={editable}
            onChange={(changed) => {
              onChange(blocks.map((entry, at) => (at === index ? changed : entry)))
            }}
            onRemove={
              editable && field.repeat === 'free'
                ? () => {
                    onChange(blocks.filter((_, at) => at !== index))
                  }
                : null
            }
          />
        ))
      )}

      {editable && field.repeat === 'free' ? (
        <Button
          tone="secondary"
          onClick={() => {
            onChange([...blocks, { circuitId: null, circuit: null, values: {} }])
          }}
        >
          Block hinzufügen
        </Button>
      ) : null}
    </div>
  )
}

function SignatureText({
  field,
  value,
}: {
  readonly field: FormField
  readonly value: FormValue | undefined
}) {
  const signature = value as SignatureValue | undefined

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{field.label}</FieldLabel>
      {signature && typeof signature === 'object' && 'path' in signature ? (
        <>
          <SignaturePicture path={signature.path} label={`${field.label}, ${signature.name}`} />
          <p className="text-body">{`${signature.name}, ${date(signature.signedAt)}`}</p>
        </>
      ) : (
        <p className="text-body text-ink-muted">Noch nicht unterschrieben.</p>
      )}
    </div>
  )
}

/** The pictures of an installation, for the field that takes a photo. */
function usePhotos(
  installationId: string,
): readonly { readonly value: string; readonly label: string }[] {
  const attachments = useRelated('attachments', 'installationId', installationId)

  return useMemo(
    () =>
      attachments.map((attachment) => ({
        value: String(attachment['id']),
        label: text(attachment, 'title'),
      })),
    [attachments],
  )
}

/** What a screen needs of a protocol to show it and to save what is typed into it. */
export interface ProtocolDraft {
  readonly definition: FormDefinition | null
  readonly circuits: readonly (BlockCircuit & { readonly id: string })[]
  readonly photos: readonly { readonly value: string; readonly label: string }[]
  readonly editable: boolean
  readonly draft: FormValues
  readonly set: (key: string, value: FormValue | undefined) => void
  readonly performedOn: string
  readonly setPerformedOn: (value: string) => void
  readonly unsaved: boolean
  /** How often the draft was replaced from elsewhere: inputs keyed on it start afresh. */
  readonly generation: number
  readonly trouble: string | null
  readonly working: boolean
  readonly save: () => Promise<void>
}

/**
 * A protocol as a screen holds it, on site and in the office alike. What is
 * typed stays in a draft of the screen until somebody saves, and a save asks
 * the same question the server will, so a protocol it would refuse never
 * reaches the outbox.
 */
export function useProtocolDraft(record: RecordState): ProtocolDraft {
  const client = useSync()
  const definition = definitionOf(record)
  const installationId = text(record, 'installationId')
  const circuits = useBlockCircuits(installationId)
  const photos = usePhotos(installationId)
  const editable = !isSigned(record)
  // Read and written again, so that two texts of the same values compare
  // equal whoever wrote them.
  const saved = formValuesText(valuesOf(record))
  const [draft, setDraft] = useState<FormValues>(() => valuesOf(record))
  const [performedOn, setPerformedOn] = useState(text(record, 'performedOn'))
  const [base, setBase] = useState({ values: saved, performedOn: text(record, 'performedOn') })
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  // Counts the times the draft was replaced from elsewhere. The inputs keep
  // what was typed into them, so they are drawn afresh when that happens.
  const [generation, setGeneration] = useState(0)

  // A change that arrives from elsewhere, the office saving what the site has
  // open, replaces the draft only while nothing here is unsaved. Otherwise
  // the save that follows collides with it, and the conflict is shown.
  const unsaved = formValuesText(draft) !== base.values || performedOn !== base.performedOn

  if (!unsaved && (saved !== base.values || text(record, 'performedOn') !== base.performedOn)) {
    setBase({ values: saved, performedOn: text(record, 'performedOn') })
    setDraft(valuesOf(record))
    setPerformedOn(text(record, 'performedOn'))
    setGeneration((count) => count + 1)
  }

  function set(key: string, value: FormValue | undefined) {
    setDraft((current) => {
      const next: Record<string, FormValue> = { ...current }

      if (value === undefined) {
        delete next[key]
      } else {
        next[key] = value
      }

      return next
    })
  }

  async function save() {
    // Nothing typed, nothing to send: the button stays where it is drawn,
    // and a click on it writes no second copy of the same values.
    if (!unsaved) {
      return
    }

    const values = formValuesText(draft)
    const problem = formRecordProblem(protocolRegistry, {
      definitionKey: definition?.key,
      definitionVersion: definition?.version,
      status: 'draft',
      values,
    })

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setTrouble(null)
    setWorking(true)

    try {
      const result = await client.update('form_records', String(record['id']), {
        values,
        performedOn,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalText[result.reason])
      } else {
        setBase({ values, performedOn })
      }
    } finally {
      setWorking(false)
    }
  }

  return {
    definition,
    circuits,
    photos,
    editable,
    draft,
    set,
    performedOn,
    setPerformedOn,
    unsaved,
    generation,
    trouble,
    working,
    save,
  }
}

/**
 * A protocol on screen: as a form while it is a draft, as text once it is
 * signed.
 *
 * `children` is what the entry puts under the form: the signature on site.
 */
export function ProtocolSheet({
  record,
  children,
}: {
  readonly record: RecordState
  readonly children?: (state: { readonly unsaved: boolean }) => ReactNode
}) {
  const {
    definition,
    circuits,
    photos,
    editable,
    draft,
    set,
    performedOn,
    setPerformedOn,
    unsaved,
    generation,
    trouble,
    working,
    save,
  } = useProtocolDraft(record)

  if (!definition) {
    return <UnknownVersion />
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        void save()
      }}
    >
      {editable ? (
        <Field
          label="Tag der Prüfung"
          type="date"
          hint="Nach diesem Tag richten sich die Grenzwerte."
          value={performedOn}
          onChange={(event) => {
            setPerformedOn(event.target.value)
          }}
        />
      ) : null}

      {definition.sections.map((section) => (
        <section
          key={`${section.key}-${String(generation)}`}
          aria-label={section.title}
          className="flex flex-col gap-4 p-4 rounded-card border border-line bg-surface"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-body font-semibold">{section.title}</h2>
            {section.hint ? <p className="text-table text-ink-muted">{section.hint}</p> : null}
          </div>
          {section.fields.map((field) => {
            if (field.kind === 'group') {
              return (
                <GroupSection
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  circuits={circuits}
                  performedOn={performedOn}
                  photos={photos}
                  editable={editable}
                  onChange={(blocks) => {
                    set(field.key, blocks)
                  }}
                />
              )
            }

            if (field.kind === 'signature') {
              return <SignatureText key={field.key} field={field} value={draft[field.key]} />
            }

            const value = draft[field.key] as FieldValue | undefined

            return editable ? (
              <FieldInput
                key={field.key}
                field={field}
                value={value}
                circuit={null}
                performedOn={performedOn}
                photos={photos}
                onChange={(changed) => {
                  set(field.key, changed)
                }}
              />
            ) : (
              <FieldText
                key={field.key}
                field={field}
                value={value}
                circuit={null}
                performedOn={performedOn}
                photos={photos}
              />
            )
          })}
        </section>
      ))}

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {editable ? (
        <div className="sticky bottom-0 flex flex-col gap-2 py-3 bg-ground">
          {unsaved ? (
            <p className="text-table text-ink-muted">Nicht gespeicherte Änderungen.</p>
          ) : null}
          <Button type="submit" tone="primary" wide disabled={working || !unsaved}>
            Speichern
          </Button>
        </div>
      ) : null}

      {children ? children({ unsaved }) : null}
    </form>
  )
}

/** A protocol filled in on a version of OpenGewerk newer than this one. */
export function UnknownVersion() {
  return (
    <p className="text-body">
      Dieses Formular ist in einer Fassung ausgefüllt, die diese Fassung von OpenGewerk nicht kennt.
      Nach einem Update ist es wieder lesbar.
    </p>
  )
}

/**
 * What is still missing before the tester signs, the signature itself left
 * out: the sentences to show, empty when it can be signed.
 */
export function missingBeforeSigning(record: RecordState): readonly string[] {
  const definition = definitionOf(record)

  return definition ? sealProblems(definition, valuesOf(record), { seal: false }) : []
}

/** The address of a protocol on paper. */
export function protocolPdfAddress(recordId: string): string {
  return `/form-records/${encodeURIComponent(recordId)}/pdf`
}

/**
 * The way to the protocol on paper, and the sentence when it cannot help.
 * The server prints it out of what it holds: without a connection there is
 * nothing to print from, and with the protocol still in the outbox the page
 * would show an older state, or none.
 */
export function ProtocolPdfLink({ recordId }: { readonly recordId: string }) {
  const client = useSync()
  const entry = useEntry()
  const { online } = useSyncStatus()
  const reason = !online
    ? 'Das PDF druckt der Server, dafür braucht es Verbindung.'
    : client.isPending('form_records', recordId)
      ? 'Das PDF gibt es, sobald das Protokoll übertragen ist.'
      : null

  // In the office a button of the head with an eye, as the board draws it;
  // the reason it cannot help is in its title there, a line under it would
  // push the head apart.
  if (entry === 'office') {
    return reason ? (
      <Button icon={Eye} disabled title={reason}>
        Als PDF
      </Button>
    ) : (
      <a
        href={protocolPdfAddress(recordId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap"
      >
        <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
        Als PDF
      </a>
    )
  }

  if (reason) {
    return (
      <span className="inline-flex flex-col gap-1">
        <Button disabled title={reason}>
          Als PDF
        </Button>
        <span className="text-table text-ink-muted">{reason}</span>
      </span>
    )
  }

  return (
    <a
      href={protocolPdfAddress(recordId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center h-control min-h-tap px-4 rounded-control text-body font-semibold bg-surface text-ink border border-line-strong"
    >
      Als PDF
    </a>
  )
}
