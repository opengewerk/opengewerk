import {
  type BlockCircuit,
  type BlockField,
  circuitBlocks,
  type FieldValue,
  formatMeasured,
  type FormSection,
  formValuesText,
  type GroupField,
  limitVerdict,
  type MeasurementField,
  measurementUnitSign,
  type RecordState,
  sealingField,
  signerNameProblem,
} from '@opengewerk/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import clsx from 'clsx'
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Signature,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field, Panel } from '../../components/index.js'
import { addAttachment } from '../../app/attachments.js'
import { amount, date, scaledNumber } from '../../app/format.js'
import {
  blocksOf,
  circuitProtection,
  definitionOf,
  FieldInput,
  filledIn,
  isSigned,
  missingBeforeSigning,
  outsideIn,
  type ProtocolDraft,
  ProtocolPdfLink,
  ProtocolSheet,
  protocolRules,
  ProtocolsList,
  UnknownVersion,
  useProtocolDraft,
  valuesOf,
} from '../../app/protocols.js'
import { useMay } from '../../app/queries.js'
import { refusalFor } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useSync } from '../../sync/provider.js'
import { SiteActionBar } from '../action-bar.js'
import { SiteHeader } from '../header.js'
import { SiteLabel, SiteScreen, SiteText, SiteTrouble } from '../kit.js'
import { SignaturePad } from '../signature-pad.js'

/**
 * The test protocol on site (#79), as the boards "Prüfprotokoll, Messen je
 * Stromkreis" and "Prüfprotokoll, Übersicht und Ergebnis" draw it (#219):
 * started at the installation of the job, an overview of its sections with
 * the result and the signature, each section a step of its own, and the
 * measuring one circuit at a time in front of the board. Everything works
 * without a network, and once signed the protocol is fixed, on the device as
 * in the database; a new test is a new protocol.
 *
 * Nothing here knows the standard. The steps come out of the definition:
 * every section is one, a group repeated per circuit is one per block, and
 * the section with the signature is the result on the overview.
 */

function protocolPath(jobId: string, recordId: string): string {
  return `/auftraege/${jobId}/pruefprotokolle/${recordId}`
}

/** The protocols of the job's installation, in its card on the job's screen. */
export function InstallationProtocols({
  jobId,
  installationId,
}: {
  readonly jobId: string
  readonly installationId: string
}) {
  const navigate = useNavigate()

  return (
    <section aria-label="Prüfprotokolle">
      <SiteLabel className="mt-1">Prüfprotokolle</SiteLabel>
      <ProtocolsList
        installationId={installationId}
        jobId={jobId}
        pathOf={(recordId) => protocolPath(jobId, recordId)}
        onStarted={(recordId) => {
          void navigate({ to: protocolPath(jobId, recordId) })
        }}
      />
    </section>
  )
}

/**
 * What kind of protocol, for the line under "Prüfprotokoll" in the header:
 * "Erstprüfung nach DIN VDE 0100-600" rather than the whole title again.
 */
function kindOfProtocol(record: RecordState): string {
  const title = definitionOf(record)?.title ?? ''
  const word = 'Prüfprotokoll '

  return title.startsWith(word) ? title.slice(word.length) : title
}

/** Where on the protocol somebody is, apart from the overview: a section, or one block of its group. */
type Step =
  | { readonly kind: 'section'; readonly section: string }
  | { readonly kind: 'block'; readonly section: string; readonly index: number }

/** Whether a section carries the signature, which makes it the result on the overview. */
function isResult(section: FormSection): boolean {
  return section.fields.some((field) => field.kind === 'signature')
}

/** The repeating group of a section, if it has one. */
function groupOf(section: FormSection): GroupField | null {
  return section.fields.find((field): field is GroupField => field.kind === 'group') ?? null
}

/** The fields of a section filled in on its own step: not the group, not the signature. */
function plainFields(section: FormSection): readonly BlockField[] {
  return section.fields.filter(
    (field): field is BlockField => field.kind !== 'group' && field.kind !== 'signature',
  )
}

/**
 * The steps of a section, in the order of the definition: the section itself
 * where it has something of its own to show, then its blocks one by one. A
 * group without blocks keeps its own step, which says why there are none,
 * and a group of free blocks the step that adds one.
 */
function stepsOfSection(section: FormSection, protocol: ProtocolDraft): readonly Step[] {
  const group = groupOf(section)
  const blocks = group ? blocksOf(protocol.draft[group.key]) : []
  const own =
    !group || plainFields(section).length > 0 || blocks.length === 0 || group.repeat === 'free'

  return [
    ...(own ? [{ kind: 'section', section: section.key } as const] : []),
    ...blocks.map((_, index) => ({ kind: 'block', section: section.key, index }) as const),
  ]
}

/** Every step after the overview. The result is not among them; it is on the overview. */
function stepsOf(protocol: ProtocolDraft): readonly Step[] {
  return (protocol.definition?.sections ?? [])
    .filter((section) => !isResult(section))
    .flatMap((section) => stepsOfSection(section, protocol))
}

function sameStep(left: Step, right: Step): boolean {
  if (left.kind === 'block' && right.kind === 'block') {
    return left.section === right.section && left.index === right.index
  }

  return left.kind === right.kind && left.section === right.section
}

/**
 * Where a row of the overview leads: the section, or for a section that is
 * only its group the first block nothing is entered in yet, since that is
 * where the measuring goes on.
 */
function entryOf(section: FormSection, protocol: ProtocolDraft): Step | null {
  const steps = stepsOfSection(section, protocol)
  const group = groupOf(section)

  if (!group || steps[0]?.kind === 'section') {
    return steps[0] ?? null
  }

  const open = blocksOf(protocol.draft[group.key]).findIndex(
    (block) => filledIn(group, block) === 0,
  )

  return { kind: 'block', section: section.key, index: open === -1 ? 0 : open }
}

type Tone = 'muted' | 'done' | 'wait' | 'bad'

/**
 * How far a section is, `section_row()` of the board: a few words and the
 * colour they are said in. What "fehlt" counts is what has to be there before
 * the signature, as the list under "Unterschrift des Prüfers" does.
 */
function stateOf(
  section: FormSection,
  protocol: ProtocolDraft,
): { readonly text: string; readonly tone: Tone } {
  const group = groupOf(section)

  if (group) {
    const blocks = blocksOf(protocol.draft[group.key])
    const started = blocks.filter((block) => filledIn(group, block) > 0).length
    const outside = blocks.reduce(
      (sum, block) => sum + outsideIn(group, block, protocol.performedOn),
      0,
    )
    const counted = `${String(started)} von ${String(blocks.length)}`

    if (outside > 0) {
      return {
        text: `${counted}, ${outside === 1 ? '1 Wert' : `${String(outside)} Werte`} außerhalb`,
        tone: 'bad',
      }
    }

    return {
      text: counted,
      tone:
        blocks.length > 0 && started === blocks.length ? 'done' : started > 0 ? 'wait' : 'muted',
    }
  }

  const fields = plainFields(section)
  const filled = fields.filter((field) => protocol.draft[field.key] !== undefined).length
  const missing = fields.filter(
    (field) => field.required === true && protocol.draft[field.key] === undefined,
  ).length

  if (filled === 0) {
    return { text: 'noch nichts eingetragen', tone: 'muted' }
  }

  if (missing > 0) {
    return { text: missing === 1 ? '1 fehlt' : `${String(missing)} fehlen`, tone: 'wait' }
  }

  return { text: isResult(section) ? 'eingetragen' : 'vollständig', tone: 'done' }
}

const toneIcon: Readonly<Record<Tone, LucideIcon>> = {
  muted: ChevronRight,
  done: Check,
  wait: Clock,
  bad: TriangleAlert,
}

const toneColour: Readonly<Record<Tone, string>> = {
  muted: 'text-ink-muted',
  done: 'text-done',
  wait: 'text-waiting',
  bad: 'text-conflict',
}

/**
 * Back to the top after a step: the page scrolls on a phone, the screen
 * beside the rail from 1024 pixels on.
 */
function toTop() {
  globalThis.scrollTo?.({ top: 0 })
  document.getElementById('inhalt')?.scrollTo?.({ top: 0 })
}

export function SiteProtocolScreen() {
  const { jobId, recordId } = useParams({ strict: false }) as {
    jobId?: string
    recordId?: string
  }
  const record = useRecord('form_records', recordId)
  const installation = useRecord(
    'installations',
    record ? text(record, 'installationId') : undefined,
  )

  if (!record || !recordId || !jobId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Dieses Protokoll hat dieses Gerät nicht. Mit Verbindung holt der Abgleich es.
        </SiteText>
      </SiteScreen>
    )
  }

  const place = installation ? text(installation, 'designation') : ''

  return (
    <SiteScreen>
      <SiteHeader
        title="Prüfprotokoll"
        sub={[kindOfProtocol(record), place].filter((part) => part !== '').join(', ')}
      />
      {isSigned(record) ? (
        <>
          <SiteText muted>{`${date(record['performedOn'])}, unterschrieben`}</SiteText>
          <ProtocolPdfLink recordId={recordId} />
          <ProtocolSheet key={recordId} record={record} />
        </>
      ) : (
        // Keyed, so that a second protocol never opens on the step of the first.
        <DraftProtocol key={recordId} record={record} jobId={jobId} place={place} />
      )}
    </SiteScreen>
  )
}

/** A protocol being filled in: the overview, one of its steps, or the signing. */
function DraftProtocol({
  record,
  jobId,
  place,
}: {
  readonly record: RecordState
  readonly jobId: string
  readonly place: string
}) {
  const protocol = useProtocolDraft(record)
  const [step, setStep] = useState<Step | null>(null)
  const [signing, setSigning] = useState(false)
  const latestSave = useRef(protocol.save)

  // The save of the last render, which knows the last draft.
  useEffect(() => {
    latestSave.current = protocol.save
  })

  // Whoever leaves by the header or the gesture of the phone takes what was
  // typed on the step along: a protocol measured in a cellar must not live
  // only in a screen that closes. With nothing unsaved it sends nothing.
  useEffect(
    () => () => {
      void latestSave.current()
    },
    [],
  )

  if (!protocol.definition) {
    return <UnknownVersion />
  }

  // Saved on every step, forward or back, for the same reason; a draft the
  // form would refuse keeps the step open and says why.
  async function go(next: Step | null) {
    if (await protocol.save()) {
      setStep(next)
      toTop()
    }
  }

  if (signing) {
    return (
      <SigningStep
        record={record}
        onBack={() => {
          setSigning(false)
        }}
      />
    )
  }

  if (!step) {
    return (
      <Overview
        record={record}
        protocol={protocol}
        onOpen={(next) => void go(next)}
        onSign={() => {
          setSigning(true)
        }}
      />
    )
  }

  const steps = stepsOf(protocol)
  const at = steps.findIndex((candidate) => sameStep(candidate, step))
  const before = at > 0 ? steps[at - 1] : undefined
  const after = at >= 0 && at < steps.length - 1 ? steps[at + 1] : undefined

  return (
    <>
      {step.kind === 'section' ? (
        <SectionStep
          protocol={protocol}
          sectionKey={step.section}
          onAdded={(index) => {
            setStep({ kind: 'block', section: step.section, index })
            toTop()
          }}
        />
      ) : (
        <BlockStep
          protocol={protocol}
          step={step}
          record={record}
          jobId={jobId}
          place={place}
          onRemoved={() => {
            setStep({ kind: 'section', section: step.section })
            toTop()
          }}
        />
      )}
      {protocol.trouble ? <SiteTrouble>{protocol.trouble}</SiteTrouble> : null}
      <SiteActionBar
        {...(step.kind === 'block'
          ? {
              note: 'Ein Mangel sperrt das Protokoll nicht. Er steht am Ende im Ergebnis und im Bericht für den Kunden.',
            }
          : {})}
      >
        {/* Twice back to the overview is one button too many, for a
            definition of a single step. */}
        {before || after ? (
          <Button
            wide
            icon={ChevronLeft}
            className="flex-1 basis-0"
            disabled={protocol.working}
            onClick={() => void go(before ?? null)}
          >
            {before ? `Zu ${stepName(protocol, before)}` : 'Zur Übersicht'}
          </Button>
        ) : null}
        <Button
          tone="primary"
          wide
          className="flex-2 basis-0"
          disabled={protocol.working}
          onClick={() => void go(after ?? null)}
        >
          {after ? `Weiter zu ${stepName(protocol, after)}` : 'Zur Übersicht'}
        </Button>
      </SiteActionBar>
    </>
  )
}

/** What a step is called on the buttons that lead to it: "Besichtigen", "F10". */
function stepName(protocol: ProtocolDraft, step: Step): string {
  const section = protocol.definition?.sections.find((candidate) => candidate.key === step.section)

  if (step.kind === 'block') {
    const group = section ? groupOf(section) : null
    const block = group ? blocksOf(protocol.draft[group.key])[step.index] : undefined

    return block?.circuit?.designation ?? `Block ${String(step.index + 1)}`
  }

  return section?.title ?? ''
}

/**
 * The overview, the board "Prüfprotokoll, Übersicht und Ergebnis": the day of
 * the test, how far each section is, the result, and the signature of the
 * tester. "Speichern" waits at the foot while something here is unsaved.
 */
function Overview({
  record,
  protocol,
  onOpen,
  onSign,
}: {
  readonly record: RecordState
  readonly protocol: ProtocolDraft
  readonly onOpen: (step: Step) => void
  readonly onSign: () => void
}) {
  const formId = useId()
  const result = useRef<HTMLDivElement>(null)
  const definition = protocol.definition

  if (!definition) {
    return <UnknownVersion />
  }

  const resultSection = definition.sections.find(isResult)
  const missing = protocol.unsaved ? [] : missingBeforeSigning(record)
  const seal = sealingField(definition)

  return (
    <>
      <form
        id={formId}
        className="contents"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void protocol.save()
        }}
      >
        <Field
          label="Tag der Prüfung"
          type="date"
          hint="Nach diesem Tag richten sich die Grenzwerte."
          value={protocol.performedOn}
          onChange={(event) => {
            protocol.setPerformedOn(event.target.value)
          }}
        />

        <StaleBlocks protocol={protocol} />

        <Panel title="Übersicht">
          <ul aria-label="Abschnitte" className="flex flex-col">
            {definition.sections.map((section) => {
              const state = stateOf(section, protocol)
              const Icon = toneIcon[state.tone]
              const entry = isResult(section) ? null : entryOf(section, protocol)

              return (
                <li key={section.key}>
                  <button
                    type="button"
                    className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 border-b border-row text-left text-ink"
                    onClick={() => {
                      if (entry) {
                        onOpen(entry)
                      } else {
                        result.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
                      }
                    }}
                  >
                    <Icon
                      size={20}
                      strokeWidth={2.3}
                      aria-hidden="true"
                      className={clsx('shrink-0', toneColour[state.tone])}
                    />
                    {/* Not below its longest word: at 320 pixels the state
                        beside it wraps, and "Messen" stays one word. */}
                    <span className="grow text-[17px] font-semibold">{section.title}</span>
                    <span
                      className={clsx(
                        'text-right text-[15px]',
                        toneColour[state.tone],
                        state.tone === 'bad' && 'font-semibold',
                      )}
                    >
                      {state.text}
                    </span>
                    <ChevronRight
                      size={18}
                      strokeWidth={2.2}
                      aria-hidden="true"
                      className="shrink-0 text-ink-faint"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>

        {resultSection ? (
          <div ref={result} className="scroll-mt-4">
            <Panel title={resultSection.title}>
              <div className="flex flex-col gap-3">
                {plainFields(resultSection).map((field) => (
                  <FieldInput
                    key={`${field.key}-${String(protocol.generation)}`}
                    field={field}
                    value={protocol.draft[field.key] as FieldValue | undefined}
                    circuit={null}
                    performedOn={protocol.performedOn}
                    photos={protocol.photos}
                    onChange={(changed) => {
                      protocol.set(field.key, changed)
                    }}
                  />
                ))}
              </div>
            </Panel>
          </div>
        ) : null}
      </form>

      <Panel title={seal?.label ?? 'Unterschrift'}>
        <div className="flex flex-col gap-2.5">
          {protocol.unsaved ? (
            <SiteText>Erst speichern, dann unterschreiben.</SiteText>
          ) : missing.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-[17px] font-semibold">Vor der Unterschrift fehlt noch:</p>
              <ul className="list-disc pl-5 text-[16px] leading-[1.5]">
                {missing.slice(0, 5).map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ul>
              {missing.length > 5 ? (
                <SiteText muted>{`und ${String(missing.length - 5)} weitere.`}</SiteText>
              ) : null}
            </div>
          ) : (
            <SiteText>
              Das Protokoll ist vollständig. Mit der Unterschrift wird es festgeschrieben.
            </SiteText>
          )}
          {/* Copper only while it can be pressed: until then the copper is
              "Speichern" at the foot, one at a time (#223). */}
          <Button
            tone="primary"
            wide
            icon={Signature}
            disabled={protocol.unsaved || missing.length > 0}
            onClick={onSign}
          >
            Unterschreiben
          </Button>
        </div>
      </Panel>

      {protocol.trouble ? <SiteTrouble>{protocol.trouble}</SiteTrouble> : null}

      <SiteActionBar>
        <p
          className={clsx(
            'min-w-0 grow self-center text-[15px]',
            protocol.unsaved ? 'font-semibold text-waiting' : 'text-ink-muted',
          )}
        >
          {protocol.unsaved ? 'Nicht gespeicherte Änderungen.' : 'Alles gespeichert.'}
        </p>
        <Button
          type="submit"
          form={formId}
          tone="primary"
          height={52}
          icon={Check}
          className="shrink-0 px-[22px]"
          disabled={protocol.working || !protocol.unsaved}
        >
          Speichern
        </Button>
      </SiteActionBar>
    </>
  )
}

/**
 * The blocks of a group follow the circuit chart of the installation. When
 * the chart changed since they were made, the overview says so and offers to
 * take the circuits over, as the office does.
 */
function StaleBlocks({ protocol }: { readonly protocol: ProtocolDraft }) {
  const behind = (protocol.definition?.sections ?? [])
    .map(groupOf)
    .filter((group): group is GroupField => group?.repeat === 'circuits')
    .filter((group) => {
      const blocks = blocksOf(protocol.draft[group.key])

      return (
        formValuesText({ blocks: circuitBlocks(blocks, protocol.circuits) }) !==
        formValuesText({ blocks })
      )
    })

  if (behind.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[6px] border border-waiting-edge bg-waiting-fill px-3.5 py-3">
      <SiteText size={16}>
        Das Stromkreisverzeichnis der Anlage hat sich geändert, seit die Blöcke angelegt wurden.
      </SiteText>
      <Button
        wide
        height={48}
        onClick={() => {
          for (const group of behind) {
            protocol.set(
              group.key,
              circuitBlocks(blocksOf(protocol.draft[group.key]), protocol.circuits),
            )
          }
        }}
      >
        Stromkreise übernehmen
      </Button>
    </div>
  )
}

/** A section of its own: its title, what it says, and its fields. */
function SectionStep({
  protocol,
  sectionKey,
  onAdded,
}: {
  readonly protocol: ProtocolDraft
  readonly sectionKey: string
  readonly onAdded: (index: number) => void
}) {
  const section = protocol.definition?.sections.find((candidate) => candidate.key === sectionKey)

  if (!section) {
    return null
  }

  const group = groupOf(section)
  const blocks = group ? blocksOf(protocol.draft[group.key]) : []

  return (
    <Panel title={section.title}>
      <div className="flex flex-col gap-3">
        {section.hint ? (
          <SiteText muted size={15}>
            {section.hint}
          </SiteText>
        ) : null}
        {plainFields(section).map((field) => (
          <FieldInput
            key={`${field.key}-${String(protocol.generation)}`}
            field={field}
            value={protocol.draft[field.key] as FieldValue | undefined}
            circuit={null}
            performedOn={protocol.performedOn}
            photos={protocol.photos}
            onChange={(changed) => {
              protocol.set(field.key, changed)
            }}
          />
        ))}
        {group && blocks.length === 0 ? (
          <SiteText muted>
            {group.repeat === 'circuits'
              ? 'Die Anlage hat kein Stromkreisverzeichnis, aus dem die Blöcke kommen.'
              : 'Noch kein Block.'}
          </SiteText>
        ) : null}
        {group?.repeat === 'free' ? (
          <Button
            wide
            height={52}
            icon={Plus}
            onClick={() => {
              protocol.set(group.key, [...blocks, { circuitId: null, circuit: null, values: {} }])
              onAdded(blocks.length)
            }}
          >
            Block hinzufügen
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * One circuit of the measuring, the board "Prüfprotokoll, Messen je
 * Stromkreis": how far the measuring is, the circuit on slate with what
 * protects it, every measured value in a card of its own with its limit, and
 * the rest of the fields under them.
 */
function BlockStep({
  protocol,
  step,
  record,
  jobId,
  place,
  onRemoved,
}: {
  readonly protocol: ProtocolDraft
  readonly step: Extract<Step, { readonly kind: 'block' }>
  readonly record: RecordState
  readonly jobId: string
  readonly place: string
  readonly onRemoved: () => void
}) {
  const section = protocol.definition?.sections.find((candidate) => candidate.key === step.section)
  const group = section ? groupOf(section) : null
  const blocks = group ? blocksOf(protocol.draft[group.key]) : []
  const block = blocks[step.index]

  if (!section || !group || !block) {
    return null
  }

  const filled = filledIn(group, block)
  const outside = outsideIn(group, block, protocol.performedOn)
  const facts = [
    block.circuit ? circuitProtection(block.circuit) : null,
    `${String(filled)} von ${String(group.fields.length)} eingetragen`,
    outside === 0
      ? null
      : outside === 1
        ? '1 Wert außerhalb'
        : `${String(outside)} Werte außerhalb`,
  ].filter((part): part is string => part !== null)
  const unit = group.repeat === 'circuits' ? 'Stromkreis' : 'Block'
  const name = block.circuit?.designation ?? String(step.index + 1)
  const share = Math.round(((step.index + 1) / blocks.length) * 100)

  function change(key: string, value: FieldValue | undefined) {
    if (!group || !block) {
      return
    }

    const values: Record<string, FieldValue> = { ...block.values }

    if (value === undefined) {
      delete values[key]
    } else {
      values[key] = value
    }

    protocol.set(
      group.key,
      blocks.map((entry, at) => (at === step.index ? { ...entry, values } : entry)),
    )
  }

  return (
    <>
      <div>
        <p className="flex items-baseline gap-2 text-[16px]">
          <b className="grow font-semibold">
            {`${section.title}, ${unit} ${String(step.index + 1)} von ${String(blocks.length)}`}
          </b>
          {place ? <span className="text-ink-muted">{place}</span> : null}
        </p>
        <div
          role="progressbar"
          aria-label="Fortschritt beim Messen"
          aria-valuemin={1}
          aria-valuemax={blocks.length}
          aria-valuenow={step.index + 1}
          className="mt-[7px] h-2 overflow-hidden rounded-[4px] bg-surface-sunken"
        >
          {/* A drawing and not a width in a style attribute, which the
              policy of the instance would refuse. */}
          <svg
            viewBox="0 0 100 8"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="block h-full w-full"
          >
            <rect width={share} height="8" className="fill-copper" />
          </svg>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="shrink-0 rounded-[4px] bg-top px-2.5 py-0.5 font-condensed text-[22px] font-semibold text-top-ink">
          {name}
        </span>
        <div className="min-w-0">
          <p className="text-[20px] font-bold [overflow-wrap:anywhere]">
            {block.circuit?.consumer ?? `${unit} ${name}`}
          </p>
          <p className="text-[15px] text-ink-muted">{facts.join(', ')}</p>
        </div>
      </div>

      {/* Keyed on the block and the draft's generation, so that a figure typed
          for one circuit is never shown on the next. */}
      <div key={`${String(step.index)}-${String(protocol.generation)}`} className="contents">
        {group.fields.map((nested) =>
          nested.kind === 'measurement' ? (
            <MeasureCard
              key={nested.key}
              field={nested}
              value={block.values[nested.key]}
              circuit={block.circuit}
              performedOn={protocol.performedOn}
              onChange={(value) => {
                change(nested.key, value)
              }}
            />
          ) : (
            <FieldInput
              key={nested.key}
              field={nested}
              value={block.values[nested.key]}
              circuit={block.circuit}
              performedOn={protocol.performedOn}
              photos={protocol.photos}
              onChange={(value) => {
                change(nested.key, value)
              }}
            />
          ),
        )}
      </div>

      <DefectPhoto record={record} jobId={jobId} />

      {group.repeat === 'free' ? (
        <Button
          tone="quiet"
          wide
          height={44}
          onClick={() => {
            protocol.set(
              group.key,
              blocks.filter((_, at) => at !== step.index),
            )
            onRemoved()
          }}
        >
          Block entfernen
        </Button>
      ) : null}
    </>
  )
}

/** "≤ 2,87 Ω": the limit beside the label, as the board writes it, or nothing. */
function shortLimit(field: MeasurementField, limitMilli: number | null): string | null {
  if (!field.limit || limitMilli === null) {
    return null
  }

  const atLeast = field.limit.kind === 'at_least'
  // Rounded towards the strict side, as the sentence under the value is.
  const step = 10 ** Math.max(0, 3 - field.decimals)
  const shown = atLeast ? Math.ceil(limitMilli / step) * step : Math.floor(limitMilli / step) * step

  return `${atLeast ? '≥' : '≤'} ${formatMeasured(shown, field.unit, field.decimals)}`
}

/**
 * A measured value, `measure()` of the board: a card with an edge in the
 * colour of its verdict, the label with the limit in short, the figure large
 * with its unit inside the box, so nothing leaves the screen at 320 pixels,
 * and the verdict under it, with its source when the value is outside.
 */
function MeasureCard({
  field,
  value,
  circuit,
  performedOn,
  onChange,
}: {
  readonly field: MeasurementField
  readonly value: FieldValue | undefined
  readonly circuit: BlockCircuit | null
  readonly performedOn: string
  readonly onChange: (value: number | undefined) => void
}) {
  const id = useId()
  const [typed, setTyped] = useState(typeof value === 'number' ? amount(value) : '')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const verdict = limitVerdict(field, typeof value === 'number' ? value : null, {
    rules: protocolRules,
    on: performedOn,
    circuit,
  })
  const state = verdict.within === false ? 'bad' : verdict.within === true ? 'ok' : 'muted'
  const wrong = state === 'bad' || problem !== undefined
  const limit = shortLimit(field, verdict.limitMilli)
  const unit = measurementUnitSign[field.unit]
  const said =
    problem ??
    (field.limit
      ? `${verdict.text}${state === 'bad' && verdict.source ? ` Quelle: ${verdict.source}.` : ''}`
      : 'Für diesen Wert gibt es keinen Grenzwert.')

  return (
    <div
      className={clsx(
        'rounded-[6px] border border-l-4 border-line bg-surface px-3.5 py-3',
        state === 'bad'
          ? 'border-l-conflict'
          : state === 'ok'
            ? 'border-l-done'
            : 'border-l-control',
      )}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <label htmlFor={id} className="grow text-[16px] font-semibold">
          {field.label}
          <span className="sr-only">{` in ${unit}`}</span>
        </label>
        {limit ? (
          <span aria-hidden="true" className="text-[15px] whitespace-nowrap text-ink-faint">
            {limit}
          </span>
        ) : null}
      </div>
      <div
        className={clsx(
          'flex h-[60px] items-center overflow-hidden rounded-[6px] bg-input',
          wrong ? 'border-2 border-conflict' : 'border border-line-strong',
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-describedby={`${id}-said`}
          aria-invalid={problem ? true : undefined}
          value={typed}
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
          className={clsx(
            'h-full w-full min-w-0 grow border-0 bg-transparent px-3 text-[26px] font-bold tabular-nums',
            state === 'bad' ? 'text-conflict' : 'text-ink',
          )}
        />
        <span
          aria-hidden="true"
          className="shrink-0 px-3.5 text-[18px] font-semibold text-ink-muted"
        >
          {unit}
        </span>
      </div>
      <p
        id={`${id}-said`}
        className={clsx(
          'mt-[7px] text-[15px] leading-[1.4]',
          wrong ? 'font-semibold text-conflict' : 'text-ink-muted',
        )}
      >
        {said}
      </p>
    </div>
  )
}

/**
 * "Foto zum Mangel": a photo of what is wrong, for the files of the
 * installation, where the result offers it as its photo.
 */
function DefectPhoto({ record, jobId }: { readonly record: RecordState; readonly jobId: string }) {
  const client = useSync()
  const writes = useMay('attachment.write')
  const job = useRecord('jobs', jobId)
  const shooter = useRef<HTMLInputElement>(null)
  const [said, setSaid] = useState<string | null>(null)

  if (!writes) {
    return null
  }

  const home = {
    customerId: job ? String(job['customerId']) : null,
    siteId: job ? maybeText(job, 'siteId') : null,
    installationId: text(record, 'installationId'),
    jobId,
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        wide
        height={52}
        icon={Camera}
        onClick={() => {
          shooter.current?.click()
        }}
      >
        Foto zum Mangel
      </Button>
      <input
        ref={shooter}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Foto zum Mangel aufnehmen"
        onChange={(event) => {
          const file = event.target.files?.[0]

          event.target.value = ''

          if (file) {
            void addAttachment(client, home, file, false).then((problem) => {
              setSaid(
                problem ??
                  'Das Foto liegt bei den Dateien der Anlage. Im Ergebnis lässt es sich als Foto wählen.',
              )
            })
          }
        }}
      />
      {said ? (
        <SiteText muted size={15}>
          {said}
        </SiteText>
      ) : null}
    </div>
  )
}

/** The tester signs: the name, the signature, and the protocol is fixed. */
function SigningStep({
  record,
  onBack,
}: {
  readonly record: RecordState
  readonly onBack: () => void
}) {
  const client = useSync()
  const definition = definitionOf(record)
  const seal = definition ? sealingField(definition) : null
  const values = valuesOf(record)
  const [name, setName] = useState(typeof values['tester'] === 'string' ? values['tester'] : '')
  const [path, setPath] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const formId = useId()

  async function sign(event: FormEvent) {
    event.preventDefault()

    const nameProblem = signerNameProblem(name)

    if (nameProblem !== null) {
      setProblem(nameProblem)

      return
    }

    if (!path) {
      setTrouble('Bitte im Feld unterschreiben.')

      return
    }

    if (!seal) {
      setTrouble('Dieses Formular hat keine Unterschrift, die es festschreibt.')

      return
    }

    setProblem(undefined)
    setTrouble(null)
    setWorking(true)

    try {
      const signed = await client.update('form_records', String(record['id']), {
        status: 'signed',
        values: formValuesText({
          ...values,
          [seal.key]: { name: name.trim(), path, signedAt: new Date().toISOString() },
        }),
      })

      if (signed.outcome === 'refused') {
        setTrouble(refusalFor(signed))
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <p className="text-[17px] leading-[1.45] font-semibold">
        Mit der Unterschrift bestätigen Sie die Prüfung, wie sie im Protokoll steht. Danach ändert
        sich daran nichts mehr.
      </p>

      <form
        id={formId}
        className="contents"
        onSubmit={(event) => {
          void sign(event)
        }}
      >
        <Panel title={seal?.label ?? 'Unterschrift'}>
          <div className="flex flex-col gap-3">
            <Field
              label="Name"
              autoComplete="off"
              value={name}
              problem={problem}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
            <SignaturePad label="Unterschriftsfeld" onChange={setPath} />
          </div>
        </Panel>
      </form>

      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      <SiteActionBar stacked>
        <Button type="submit" form={formId} tone="primary" wide icon={Check} disabled={working}>
          Unterschreiben
        </Button>
        <Button wide height={48} disabled={working} onClick={onBack}>
          Zurück zum Protokoll
        </Button>
      </SiteActionBar>
    </>
  )
}
