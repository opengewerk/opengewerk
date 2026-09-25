import type {
  BlockField,
  ChoiceField,
  FieldValue,
  FormDefinition,
  FormField,
  FormSection,
  GroupBlock,
  GroupField,
  RecordState,
  SignatureField,
  SignatureValue,
} from '@opengewerk/domain'
import {
  circuitBlocks,
  formatMeasured,
  formValuesText,
  limitVerdict,
  measuredNumber,
  measurementUnitSign,
  sealingField,
} from '@opengewerk/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import clsx from 'clsx'
import { Check, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import {
  Button,
  Cell,
  Column,
  Field,
  FieldLabel,
  Panel,
  Status,
  statusIcons,
  TablePanel,
} from '../../components/index.js'
import type { TableCard } from '../../components/index.js'
import { date } from '../../app/format.js'
import {
  blockHeading,
  blocksOf,
  circuitProtection,
  FieldInput,
  FieldText,
  filledIn,
  isSigned,
  outsideIn,
  protocolRules,
  ProtocolPdfLink,
  ProtocolsList,
  shownValue,
  UnknownVersion,
  useProtocolDraft,
} from '../../app/protocols.js'
import type { ProtocolDraft } from '../../app/protocols.js'
import { SignaturePicture } from '../../app/signature.js'
import { text } from '../../sync/fields.js'
import { useRecord } from '../../sync/provider.js'
import { Chip, Empty, NoteBox, PageHead, Screen } from '../kit.js'
import type { Crumb } from '../kit.js'
import { Section } from '../layout.js'

/**
 * The test protocols in the office (#79): found at the installation, read and
 * printed here. They are filled in on site, and signed there by whoever did
 * the test; a draft can be completed here, a name corrected, a remark added.
 *
 * The screen follows the board "Prüfprotokoll im Büro" (#219), and it draws
 * a form from what its definition holds, not from what it is called: a
 * section of nothing but choices is a table of test points with a button for
 * each answer, a section with a group per circuit is a table of what was
 * measured on each, a section with a signature is the result beside it.
 */

function protocolPath(recordId: string): string {
  return `/pruefprotokolle/${recordId}`
}

/** The protocols of an installation, on its screen. */
export function ProtocolsSection({ installationId }: { readonly installationId: string }) {
  const navigate = useNavigate()

  return (
    <Section title="Prüfprotokolle">
      <ProtocolsList
        installationId={installationId}
        jobId={null}
        pathOf={protocolPath}
        onStarted={(recordId) => {
          void navigate({ to: protocolPath(recordId) })
        }}
      />
    </Section>
  )
}

export function ProtocolScreen() {
  const { recordId } = useParams({ strict: false }) as { recordId?: string }
  const record = useRecord('form_records', recordId)
  const installation = useRecord(
    'installations',
    record ? text(record, 'installationId') : undefined,
  )
  const site = useRecord('sites', installation ? text(installation, 'siteId') : undefined)
  const customer = useRecord('customers', site ? text(site, 'customerId') : undefined)

  if (!record || !recordId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/anlagen', label: 'Anlagen' }]} />
        <Empty>Dieses Protokoll gibt es nicht, oder dieses Gerät kennt es noch nicht.</Empty>
      </Screen>
    )
  }

  const crumbs: Crumb[] = [
    { to: '/', label: 'Kunden' },
    ...(customer
      ? [{ to: `/kunden/${String(customer['id'])}`, label: text(customer, 'name') }]
      : []),
    ...(site ? [{ to: `/objekte/${String(site['id'])}`, label: text(site, 'designation') }] : []),
    ...(installation
      ? [
          {
            to: `/anlagen/${String(installation['id'])}`,
            label: text(installation, 'designation'),
          },
        ]
      : []),
  ]

  return <OfficeProtocol key={recordId} record={record} crumbs={crumbs} />
}

function OfficeProtocol({
  record,
  crumbs,
}: {
  readonly record: RecordState
  readonly crumbs: readonly Crumb[]
}) {
  const protocol = useProtocolDraft(record)
  const { definition, editable, performedOn, trouble, unsaved, working } = protocol
  const formId = useId()
  const recordId = String(record['id'])
  const signed = isSigned(record)

  return (
    <Screen>
      <PageHead
        crumbs={crumbs}
        title={definition?.title ?? 'Prüfprotokoll'}
        badges={
          <>
            {signed ? (
              <Status tone="done" icon={statusIcons.sign}>
                Unterschrieben
              </Status>
            ) : (
              <Status tone="draft">Entwurf</Status>
            )}
            <span className="numeric text-[13px] text-ink-faint">{date(performedOn)}</span>
          </>
        }
        sub={unsaved ? 'Nicht gespeicherte Änderungen.' : undefined}
        actions={
          <>
            <ProtocolPdfLink recordId={recordId} />
            {editable && definition ? (
              <Button type="submit" form={formId} tone="primary" icon={Check} disabled={working}>
                Speichern
              </Button>
            ) : null}
          </>
        }
      />

      <NoteBox tone={signed ? 'done' : 'neutral'} icon={statusIcons.sign}>
        {signed ? signedNote(definition, protocol) : unsignedNote}
      </NoteBox>

      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {definition ? (
        <form
          id={formId}
          className="flex flex-col gap-3.5"
          onSubmit={(event) => {
            event.preventDefault()
            void protocol.save()
          }}
        >
          <Sections definition={definition} protocol={protocol} />
        </form>
      ) : (
        <UnknownVersion />
      )}
    </Screen>
  )
}

const unsignedNote =
  'Unterschrieben wird auf der Baustelle, von der Person, die geprüft hat. Danach ändert sich an ' +
  'diesem Protokoll nichts mehr.'

/** "Unterschrieben von Anna Weber am 18.09.2026. …", from the signature that sealed it. */
function signedNote(definition: FormDefinition | null, protocol: ProtocolDraft): string {
  const field = definition ? sealingField(definition) : null
  const signature = field ? (protocol.draft[field.key] as SignatureValue | undefined) : undefined

  return signature
    ? `Unterschrieben von ${signature.name} am ${date(signature.signedAt)}. An diesem Protokoll ` +
        'ändert sich nichts mehr.'
    : 'Unterschrieben. An diesem Protokoll ändert sich nichts mehr.'
}

type Layout = 'fields' | 'checks' | 'measurements' | 'result'

/** How a section is drawn, from the kinds of its fields. */
function layoutOf(section: FormSection): Layout {
  if (section.fields.some((field) => field.kind === 'group')) {
    return 'measurements'
  }

  if (
    section.fields.some(
      (field) => field.kind === 'signature' || (field.kind === 'text' && field.multiline === true),
    )
  ) {
    return 'result'
  }

  return section.fields.length > 0 && section.fields.every((field) => field.kind === 'choice')
    ? 'checks'
    : 'fields'
}

/**
 * The title of each card: the section and the part of the standard it is,
 * "Besichtigen, DIN VDE 0100-600, Abschnitt 6.4.2". The standard is named
 * once, where it comes first, and the later cards say only their part of it,
 * as the board writes "Messen, Abschnitt 6.4.3".
 */
function cardTitles(sections: readonly FormSection[]): ReadonlyMap<string, string> {
  const named = new Set<string>()
  const titles = new Map<string, string>()

  for (const section of sections) {
    let hint = section.hint?.trim().replace(/\.$/, '') ?? ''
    const cut = hint.indexOf(', ')

    if (cut > 0) {
      const standard = hint.slice(0, cut)

      if (named.has(standard)) {
        hint = hint.slice(cut + 2)
      } else {
        named.add(standard)
      }
    }

    titles.set(section.key, hint === '' ? section.title : `${section.title}, ${hint}`)
  }

  return titles
}

function Sections({
  definition,
  protocol,
}: {
  readonly definition: FormDefinition
  readonly protocol: ProtocolDraft
}) {
  const titles = cardTitles(definition.sections)
  const dated = definition.sections.find((section) => layoutOf(section) === 'fields')
  const cards: ReactNode[] = []
  const sections = definition.sections

  // The day of the test is the record's and not a field of the form; it
  // stands first in the first card of plain fields, or on its own.
  if (!dated) {
    cards.push(
      <Panel key="performed-on" title="Prüfung">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PerformedOn protocol={protocol} />
        </div>
      </Panel>,
    )
  }

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index] as FormSection
    const title = titles.get(section.key) ?? section.title
    const layout = layoutOf(section)
    const key = `${section.key}-${String(protocol.generation)}`

    if (layout === 'checks') {
      // Two lists of test points side by side, as "Besichtigen" and
      // "Erproben" stand on the board.
      const next = sections[index + 1]

      if (next && layoutOf(next) === 'checks') {
        cards.push(
          <div
            key={key}
            className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
          >
            <ChecksCard section={section} title={title} protocol={protocol} />
            <ChecksCard
              section={next}
              title={titles.get(next.key) ?? next.title}
              protocol={protocol}
            />
          </div>,
        )
        index += 1
        continue
      }

      cards.push(<ChecksCard key={key} section={section} title={title} protocol={protocol} />)
      continue
    }

    if (layout === 'measurements') {
      cards.push(
        <MeasurementsCards key={key} section={section} title={title} protocol={protocol} />,
      )
      continue
    }

    if (layout === 'result') {
      cards.push(<ResultCard key={key} section={section} title={title} protocol={protocol} />)
      continue
    }

    cards.push(
      <Panel key={key} title={title}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {section === dated ? <PerformedOn protocol={protocol} /> : null}
          {section.fields.map((field) => (
            <OneField key={field.key} field={field} protocol={protocol} />
          ))}
        </div>
      </Panel>,
    )
  }

  return <>{cards}</>
}

/** The day of the test, which decides which limits apply. */
function PerformedOn({ protocol }: { readonly protocol: ProtocolDraft }) {
  if (!protocol.editable) {
    return (
      <div className="flex flex-col gap-1">
        <FieldLabel>Tag der Prüfung</FieldLabel>
        <p className="numeric text-body">{date(protocol.performedOn)}</p>
      </div>
    )
  }

  return (
    <Field
      label="Tag der Prüfung"
      type="date"
      hint="Nach diesem Tag richten sich die Grenzwerte."
      value={protocol.performedOn}
      onChange={(event) => {
        protocol.setPerformedOn(event.target.value)
      }}
    />
  )
}

/** One field of a section: an input in a draft, its value once signed. */
function OneField({
  field,
  protocol,
}: {
  readonly field: FormField
  readonly protocol: ProtocolDraft
}) {
  if (field.kind === 'group') {
    return null
  }

  if (field.kind === 'signature') {
    return <SignatureBox field={field} value={protocol.draft[field.key]} />
  }

  const value = protocol.draft[field.key] as FieldValue | undefined

  return protocol.editable ? (
    <FieldInput
      field={field}
      value={value}
      circuit={null}
      performedOn={protocol.performedOn}
      photos={protocol.photos}
      onChange={(changed) => {
        protocol.set(field.key, changed)
      }}
    />
  ) : (
    <FieldText
      field={field}
      value={value}
      circuit={null}
      performedOn={protocol.performedOn}
      photos={protocol.photos}
    />
  )
}

/** The answers of a test point as buttons, "in Ordnung", "Mangel", "entfällt". */
function Choices({
  field,
  value,
  onChange,
}: {
  readonly field: ChoiceField
  readonly value: FieldValue | undefined
  readonly onChange: (value: string | undefined) => void
}) {
  return (
    <span role="group" aria-label={field.label} className="flex flex-wrap gap-1">
      {field.options.map((option) => (
        <Chip
          key={option.value}
          pressed={value === option.value}
          onPress={() => {
            // Pressed again, the answer is taken back.
            onChange(value === option.value ? undefined : option.value)
          }}
        >
          {option.label}
        </Chip>
      ))}
    </span>
  )
}

/** A section of test points, `Besichtigen` and `Erproben`: a point and its answer per row. */
function ChecksCard({
  section,
  title,
  protocol,
}: {
  readonly section: FormSection
  readonly title: string
  readonly protocol: ProtocolDraft
}) {
  const points = section.fields.filter((field): field is ChoiceField => field.kind === 'choice')
  const answer = (field: ChoiceField) => {
    const value = protocol.draft[field.key] as FieldValue | undefined

    return protocol.editable ? (
      <Choices
        field={field}
        value={value}
        onChange={(chosen) => {
          protocol.set(field.key, chosen)
        }}
      />
    ) : (
      <span className={clsx(value === undefined && 'text-ink-muted')}>
        {shownValue(field, value, protocol.photos)}
      </span>
    )
  }
  const cards: TableCard[] = points.map((field) => ({
    key: field.key,
    title: field.label,
    ...(protocol.editable ? { actions: answer(field) } : { right: answer(field) }),
  }))

  return (
    <TablePanel title={title} caption={section.title} cards={cards}>
      <thead>
        <tr>
          <Column>Prüfpunkt</Column>
          <Column className="w-[290px]">Ergebnis</Column>
        </tr>
      </thead>
      <tbody>
        {points.map((field) => (
          <tr key={field.key}>
            <Cell>{field.label}</Cell>
            <Cell>{answer(field)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The groups of a section, each as a table of what was measured per circuit. */
function MeasurementsCards({
  section,
  title,
  protocol,
}: {
  readonly section: FormSection
  readonly title: string
  readonly protocol: ProtocolDraft
}) {
  const groups = section.fields.filter((field): field is GroupField => field.kind === 'group')

  return (
    <>
      {groups.map((field) => (
        <MeasurementsCard
          key={field.key}
          field={field}
          title={groups.length === 1 ? title : `${title}, ${field.label}`}
          protocol={protocol}
        />
      ))}
    </>
  )
}

/**
 * The head of a column: the symbol a measured value is known by, the last
 * word of its name, and its unit, "Zs Ω" for "Schleifenimpedanz Zs". A choice
 * keeps its name.
 */
function columnHead(field: BlockField): string {
  if (field.kind !== 'measurement' && field.kind !== 'number') {
    return field.label
  }

  const words = field.label.trim().split(/\s+/)
  const symbol = words.length > 1 ? (words.at(-1) as string) : field.label

  return `${symbol} ${measurementUnitSign[field.unit]}`
}

/** One value in its column: a figure in its colour, a choice as its answer. */
function ValueCell({
  field,
  block,
  performedOn,
  photos,
}: {
  readonly field: BlockField
  readonly block: GroupBlock
  readonly performedOn: string
  readonly photos: ProtocolDraft['photos']
}) {
  const value = block.values[field.key]

  if (value === undefined) {
    return <Cell numeric={field.kind === 'measurement' || field.kind === 'number'}>{''}</Cell>
  }

  if (field.kind === 'measurement' && typeof value === 'number') {
    const verdict = limitVerdict(field, value, {
      rules: protocolRules,
      on: performedOn,
      circuit: block.circuit,
    })

    // Green while it holds, red outside its limit, as the board colours
    // them; the words for it stand in the column "Stand".
    return (
      <Cell numeric>
        <span
          className={clsx(
            'font-semibold',
            verdict.within === false ? 'text-conflict' : 'text-done',
          )}
        >
          {measuredNumber(value, field.decimals)}
        </span>
      </Cell>
    )
  }

  if (field.kind === 'number' && typeof value === 'number') {
    return <Cell numeric>{measuredNumber(value, field.decimals)}</Cell>
  }

  return <Cell>{shownValue(field, value, photos)}</Cell>
}

/** "7 von 7 eingetragen", "1 Wert außerhalb", "noch nichts eingetragen". */
function Progress({
  field,
  block,
  performedOn,
}: {
  readonly field: GroupField
  readonly block: GroupBlock
  readonly performedOn: string
}) {
  const outside = outsideIn(field, block, performedOn)
  const filled = filledIn(field, block)

  if (outside > 0) {
    return (
      <span className="font-semibold text-conflict">
        {outside === 1 ? '1 Wert außerhalb' : `${String(outside)} Werte außerhalb`}
      </span>
    )
  }

  return (
    <span className="text-ink-faint">
      {filled === 0
        ? 'noch nichts eingetragen'
        : `${String(filled)} von ${String(field.fields.length)} eingetragen`}
    </span>
  )
}

/** Each value outside its limit in a sentence, with the limit and where it comes from. */
function outsideLines(
  field: GroupField,
  blocks: readonly GroupBlock[],
  performedOn: string,
): readonly { readonly key: string; readonly said: string; readonly source: string | null }[] {
  return blocks.flatMap((block, index) =>
    field.fields.flatMap((nested) => {
      const value = block.values[nested.key]

      if (nested.kind !== 'measurement' || typeof value !== 'number') {
        return []
      }

      const verdict = limitVerdict(nested, value, {
        rules: protocolRules,
        on: performedOn,
        circuit: block.circuit,
      })

      return verdict.within === false
        ? [
            {
              key: `${String(index)}-${nested.key}`,
              said:
                `${block.circuit?.designation ?? blockHeading(block, index)}, ${nested.label} ` +
                `${formatMeasured(value, nested.unit, nested.decimals)}: ${verdict.text}`,
              source: verdict.source,
            },
          ]
        : []
    }),
  )
}

/**
 * A group per circuit as the board draws "Messen": a row per circuit with a
 * column per value and how far it is, and under the table every value
 * outside its limit in words. A row opens to what can be changed in it,
 * the remark included, which has no column.
 */
function MeasurementsCard({
  field,
  title,
  protocol,
}: {
  readonly field: GroupField
  readonly title: string
  readonly protocol: ProtocolDraft
}) {
  const { editable, performedOn, photos } = protocol
  const [open, setOpen] = useState<number | null>(null)
  const blocks = blocksOf(protocol.draft[field.key])
  const followed = field.repeat === 'circuits' ? circuitBlocks(blocks, protocol.circuits) : blocks
  const behind =
    editable &&
    field.repeat === 'circuits' &&
    formValuesText({ blocks: followed }) !== formValuesText({ blocks })
  const columns = field.fields.filter((nested) => nested.kind !== 'text')
  const outside = outsideLines(field, blocks, performedOn)

  const change = (index: number, block: GroupBlock) => {
    protocol.set(
      field.key,
      blocks.map((entry, at) => (at === index ? block : entry)),
    )
  }
  const remove =
    editable && field.repeat === 'free'
      ? (index: number) => {
          setOpen(null)
          protocol.set(
            field.key,
            blocks.filter((_, at) => at !== index),
          )
        }
      : null
  const toggle = (index: number) => {
    setOpen((current) => (current === index ? null : index))
  }
  const editor = (block: GroupBlock, index: number) => (
    <BlockEditor
      field={field}
      block={block}
      index={index}
      protocol={protocol}
      onChange={(changed) => {
        change(index, changed)
      }}
      onRemove={
        remove
          ? () => {
              remove(index)
            }
          : null
      }
      onClose={() => {
        setOpen(null)
      }}
    />
  )
  const opener = (block: GroupBlock, index: number) => {
    const protection = block.circuit ? circuitProtection(block.circuit) : null

    return (
      <button
        type="button"
        aria-expanded={open === index}
        onClick={() => {
          toggle(index)
        }}
        className="cursor-pointer text-left text-inherit"
      >
        <span>{blockHeading(block, index)}</span>
        {protection ? <span>{`, ${protection}`}</span> : null}
      </button>
    )
  }

  const lead = behind ? (
    <NoteBox
      tone="waiting"
      action={
        <Button
          size="small"
          onClick={() => {
            protocol.set(field.key, followed)
          }}
        >
          Stromkreise übernehmen
        </Button>
      }
    >
      Das Stromkreisverzeichnis der Anlage hat sich geändert, seit die Blöcke angelegt wurden.
    </NoteBox>
  ) : null
  const action =
    editable && field.repeat === 'free' ? (
      <Button
        size="small"
        icon={Plus}
        onClick={() => {
          protocol.set(field.key, [...blocks, { circuitId: null, circuit: null, values: {} }])
          setOpen(blocks.length)
        }}
      >
        Block hinzufügen
      </Button>
    ) : null

  if (blocks.length === 0) {
    return (
      <Panel title={title} action={action}>
        {lead}
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {field.repeat === 'circuits'
            ? 'Die Anlage hat kein Stromkreisverzeichnis, aus dem die Blöcke kommen.'
            : 'Noch kein Block.'}
        </p>
      </Panel>
    )
  }

  const cards: TableCard[] = blocks.map((block, index) => ({
    key: block.circuitId ?? `free-${String(index)}`,
    title: opener(block, index),
    right: <Progress field={field} block={block} performedOn={performedOn} />,
    ...(open === index ? { form: editor(block, index) } : {}),
  }))

  return (
    <TablePanel
      title={title}
      caption={field.label}
      lead={lead}
      action={action}
      cards={cards}
      note={
        outside.length > 0 ? (
          <div className="flex flex-col gap-1">
            {outside.map((line) => (
              <p key={line.key}>
                <span className="font-semibold text-conflict">{line.said}</span>
                {line.source ? ` Quelle: ${line.source}.` : null}
              </p>
            ))}
          </div>
        ) : null
      }
    >
      <thead>
        <tr>
          <Column>Stromkreis</Column>
          {columns.map((nested) => (
            <Column
              key={nested.key}
              numeric={nested.kind === 'measurement' || nested.kind === 'number'}
              className={
                nested.kind === 'measurement' || nested.kind === 'number'
                  ? columnHead(nested).length > 6
                    ? 'w-[78px]'
                    : 'w-[70px]'
                  : 'w-[84px]'
              }
            >
              <span aria-hidden="true">{columnHead(nested)}</span>
              <span className="sr-only">{nested.label}</span>
            </Column>
          ))}
          <Column className="w-[160px]">Stand</Column>
        </tr>
      </thead>
      <tbody>
        {blocks.flatMap((block, index) => {
          const key = block.circuitId ?? `free-${String(index)}`
          const row = (
            <tr key={key}>
              <Cell>{opener(block, index)}</Cell>
              {columns.map((nested) => (
                <ValueCell
                  key={nested.key}
                  field={nested}
                  block={block}
                  performedOn={performedOn}
                  photos={photos}
                />
              ))}
              <Cell>
                <Progress field={field} block={block} performedOn={performedOn} />
              </Cell>
            </tr>
          )

          return open === index
            ? [
                row,
                <tr key={`${key}-open`}>
                  <Cell colSpan={columns.length + 2}>{editor(block, index)}</Cell>
                </tr>,
              ]
            : [row]
        })}
      </tbody>
    </TablePanel>
  )
}

/** What can be changed in one block, opened under its row. */
function BlockEditor({
  field,
  block,
  index,
  protocol,
  onChange,
  onRemove,
  onClose,
}: {
  readonly field: GroupField
  readonly block: GroupBlock
  readonly index: number
  readonly protocol: ProtocolDraft
  readonly onChange: (block: GroupBlock) => void
  readonly onRemove: (() => void) | null
  readonly onClose: () => void
}) {
  const { editable, performedOn, photos } = protocol

  return (
    <div className="flex flex-col gap-3 py-1">
      <p className="text-[14px] font-semibold">{blockHeading(block, index)}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field.fields.map((nested) => (
          <div
            key={`${nested.key}-${String(protocol.generation)}`}
            className={clsx(nested.kind === 'text' && 'sm:col-span-full')}
          >
            {editable ? (
              <FieldInput
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
                field={nested}
                value={block.values[nested.key]}
                circuit={block.circuit}
                performedOn={performedOn}
                photos={photos}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {onRemove ? (
          <Button size="small" tone="danger" onClick={onRemove}>
            Block entfernen
          </Button>
        ) : null}
        <Button size="small" onClick={onClose}>
          Schließen
        </Button>
      </div>
    </div>
  )
}

/**
 * The result as the board draws it: the answers at the left, what is longer
 * than a line in the middle, the signature at the right.
 */
function ResultCard({
  section,
  title,
  protocol,
}: {
  readonly section: FormSection
  readonly title: string
  readonly protocol: ProtocolDraft
}) {
  const long = (field: FormField) => field.kind === 'text' && field.multiline === true
  const answers = section.fields.filter(
    (field) => field.kind !== 'signature' && field.kind !== 'group' && !long(field),
  )
  const texts = section.fields.filter(long)
  const signatures = section.fields.filter(
    (field): field is SignatureField => field.kind === 'signature',
  )

  return (
    <Panel title={title}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2.5">
          {answers.map((field) => (
            <OneField key={field.key} field={field} protocol={protocol} />
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {texts.map((field) => (
            <OneField key={field.key} field={field} protocol={protocol} />
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {signatures.map((field) => (
            <SignatureBox key={field.key} field={field} value={protocol.draft[field.key]} />
          ))}
        </div>
      </div>
    </Panel>
  )
}

/** The signature, or the box it will stand in; given on site, never here. */
function SignatureBox({
  field,
  value,
}: {
  readonly field: SignatureField
  readonly value: unknown
}) {
  const signature =
    typeof value === 'object' && value !== null && 'path' in value
      ? (value as SignatureValue)
      : null

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{field.label}</FieldLabel>
      {signature ? (
        <>
          <SignaturePicture path={signature.path} label={`${field.label}, ${signature.name}`} />
          <p className="text-[13px]">{`${signature.name}, ${date(signature.signedAt)}`}</p>
        </>
      ) : (
        <div className="flex h-[84px] items-center justify-center rounded-[5px] border-2 border-dashed border-control text-[13px] text-ink-faint">
          Noch nicht unterschrieben.
        </div>
      )}
    </div>
  )
}
