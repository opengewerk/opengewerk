import type { DocumentStatus, LineUnit, RecordState } from '@opengewerk/domain'
import {
  lineUnits,
  longestDeviceInfo,
  signedContentFingerprint,
  signerNameProblem,
  whyFixed,
} from '@opengewerk/domain'
import { useParams } from '@tanstack/react-router'
import { Camera, Check, Pencil, Plus, Signature, X } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import {
  Button,
  Confirm,
  DocumentState,
  Field,
  Panel,
  SelectField,
  TextArea,
} from '../../components/index.js'
import { addAttachment } from '../../app/attachments.js'
import { ReportFieldsForm, ReportFieldsText } from '../../app/report-fields.js'
import { amount, date, moment, parseQuantity } from '../../app/format.js'
import {
  documentKindOf,
  documentStatusOf,
  lineKindOf,
  lineUnitLabel,
  lineUnitOf,
  lineUnitShort,
} from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { asTextOrNull } from '../../app/record-form.js'
import { SignaturePicture } from '../../app/signature.js'
import type { EditResult } from '../../sync/client.js'
import { refusalFor } from '../../sync/client.js'
import { count, maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated, useSync } from '../../sync/provider.js'
import { SiteActionBar, SiteNoTabs } from '../action-bar.js'
import { SiteHeader } from '../header.js'
import { SiteScreen, SiteText, SiteTrouble } from '../kit.js'
import { SignaturePad } from '../signature-pad.js'
import { signedContentOf } from '../signing.js'

/** The lines in the order they stand. The id breaks a tie, as on the server. */
function inOrder(records: readonly RecordState[]): readonly RecordState[] {
  return [...records].sort(
    (left, right) =>
      count(left, 'position') - count(right, 'position') ||
      String(left['id']).localeCompare(String(right['id'])),
  )
}

/**
 * The units material is counted in. Hours and days are left out: time goes in
 * as time, through its own button, and a list that offers "Stunden" for a
 * cable drum is a list somebody picks the wrong line from.
 */
const materialUnits = lineUnits
  .filter((unit) => unit !== 'hour' && unit !== 'day')
  .map((unit) => ({ value: unit, label: lineUnitLabel[unit] }))

/** A quarter of an hour, in the thousandths lines count in: the step of the board. */
const quarterHour = 250

/**
 * What the device knows about the report, the signature it holds included.
 * The list of reports at a job asks the same (#223).
 */
export function shownStatus(status: DocumentStatus, signature: RecordState | null): DocumentStatus {
  // Signed on this device and not sent yet, the server still says draft. The
  // device knows better, and a badge saying "Entwurf" over a signature would
  // invite somebody to change what the customer has just signed.
  return status === 'draft' && signature ? 'signed' : status
}

/** "3 Posten": what the card counts, titles left out. */
function postsOf(lines: readonly RecordState[]): string {
  const posts = lines.filter((line) => lineKindOf(line) !== 'title').length

  return posts === 1 ? '1 Posten' : `${String(posts)} Posten`
}

/** "2 Stk.", "3,5 Std.": the quantity with its unit as the report prints it. */
function quantityOf(line: RecordState): string {
  return `${amount(count(line, 'quantityMilli'))} ${lineUnitShort[lineUnitOf(line)]}`
}

/** The line the stepper stands for: the first hours of the report. */
function hoursLineOf(lines: readonly RecordState[]): RecordState | null {
  return lines.find((line) => lineKindOf(line) !== 'title' && lineUnitOf(line) === 'hour') ?? null
}

/**
 * A time and material report, written on site and signed there by the
 * customer, section 4.10 and #73, as the boards "Regiebericht schreiben",
 * "Material eintragen", "Vom Kunden unterschreiben lassen" and "Regiebericht
 * unterschrieben" draw it.
 *
 * Everything on it goes through the outbox, the signature included, because
 * the place it is written is a cellar. The one rule that makes it a signed
 * report rather than a report with a picture on it lives on the server: the
 * signature carries a fingerprint of the page the customer saw, and it lands
 * only if the server still holds that page.
 */
export function SiteReportScreen() {
  const { documentId } = useParams({ strict: false }) as { documentId?: string }
  const report = useRecord('documents', documentId)

  if (!report || !documentId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen Bericht hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  // Keyed, so that a second report never opens with the step of the first.
  return <ReportView key={documentId} report={report} />
}

function ReportView({ report }: { readonly report: RecordState }) {
  const reportId = String(report['id'])
  const client = useSync()
  const job = useRecord('jobs', maybeText(report, 'jobId') ?? undefined)
  const customer = useRecord('customers', String(report['customerId']))
  const records = useRelated('document_lines', 'documentId', reportId)
  const lines = useMemo(() => inOrder(records), [records])
  const signatures = useRelated('document_signatures', 'documentId', reportId)
  const signature = signatures[0] ?? null
  const status = shownStatus(documentStatusOf(report), signature)
  const [signing, setSigning] = useState(false)

  return (
    <SiteScreen>
      <SiteHeader
        title="Regiebericht"
        sub={[
          job ? text(job, 'designation') : text(report, 'subject'),
          customer ? text(customer, 'name') : '',
          date(report['documentDate']),
        ]
          .filter((part) => part !== '')
          .join(', ')}
      />
      {status === 'draft' && client.isPending('documents', reportId) ? (
        <p className="text-[15px] font-semibold text-waiting">Noch nicht übertragen.</p>
      ) : null}

      {status !== 'draft' ? (
        <SignedReport report={report} lines={lines} signature={signature} status={status} />
      ) : signing ? (
        <SigningStep
          report={report}
          lines={lines}
          onBack={() => {
            setSigning(false)
          }}
        />
      ) : (
        <WritingStep
          report={report}
          lines={lines}
          onSign={() => {
            setSigning(true)
          }}
        />
      )}
    </SiteScreen>
  )
}

/**
 * The lines as the customer reads them, `readonly()` of the boards: the
 * quantity in bold in a column of its own, what it was beside it.
 */
function ReadLines({ lines }: { readonly lines: readonly RecordState[] }) {
  if (lines.length === 0) {
    return <SiteText muted>Noch keine Arbeitszeit und kein Material.</SiteText>
  }

  return (
    <ul aria-label="Arbeitszeit und Material" className="flex flex-col">
      {lines.map((line) => {
        const id = String(line['id'])
        const title = lineKindOf(line) === 'title'
        const description = maybeText(line, 'description')

        return (
          <li key={id} className="border-b border-row py-[7px] text-[17px]">
            <div className="flex gap-2.5">
              {title ? null : (
                <b className="numeric w-[78px] shrink-0 font-semibold">{quantityOf(line)}</b>
              )}
              <span className={title ? 'font-semibold' : '[overflow-wrap:anywhere]'}>
                {text(line, 'designation')}
              </span>
            </div>
            {description ? (
              <p className="mt-0.5 text-[15px] whitespace-pre-line text-ink-muted">{description}</p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A line to take off again, `material_row()` of the boards: on the page
 * colour, the name, the quantity in bold, and the cross that asks first.
 */
function MaterialRow({
  line,
  onRemove,
}: {
  readonly line: RecordState
  readonly onRemove: () => void
}) {
  const name = text(line, 'designation')

  return (
    <li className="flex min-h-14 items-center gap-2.5 rounded-[6px] border border-line bg-ground py-1.5 pr-1 pl-3">
      <span className="min-w-0 grow text-[17px] [overflow-wrap:anywhere]">{name}</span>
      <b className="numeric text-[17px] font-semibold whitespace-nowrap">{quantityOf(line)}</b>
      <button
        type="button"
        aria-label={`${name} entfernen`}
        onClick={onRemove}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted"
      >
        <X size={20} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  )
}

/** The lines that can still be taken off, each asking before it goes (#222). */
function MaterialRows({
  lines,
  onRemove,
}: {
  readonly lines: readonly RecordState[]
  readonly onRemove: (id: string) => void
}) {
  const [removing, setRemoving] = useState<RecordState | null>(null)

  if (lines.length === 0) {
    return null
  }

  return (
    <>
      <ul aria-label="Posten des Berichts" className="flex flex-col gap-2">
        {lines.map((line) => (
          <MaterialRow
            key={String(line['id'])}
            line={line}
            onRemove={() => {
              setRemoving(line)
            }}
          />
        ))}
      </ul>
      <Confirm
        open={removing !== null}
        title={`„${removing ? text(removing, 'designation') : ''}“ entfernen?`}
        confirm="Entfernen"
        onConfirm={() => {
          if (removing) {
            onRemove(String(removing['id']))
          }

          setRemoving(null)
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        Der Posten steht danach nicht mehr im Bericht.
      </Confirm>
    </>
  )
}

/** What the report says was done, above its lines, as on paper. */
function WorkDone({ report }: { readonly report: RecordState }) {
  const introText = maybeText(report, 'introText')

  return introText ? (
    <p className="text-[17px] leading-[1.45] whitespace-pre-line [overflow-wrap:anywhere]">
      {introText}
    </p>
  ) : (
    <SiteText muted>Noch nichts eingetragen.</SiteText>
  )
}

/**
 * The working time as the board draws it: the hours in large figures between
 * a minus and a plus, a quarter of an hour a tap. Every tap is saved at once,
 * through the outbox, so nothing is lost when the device goes in a pocket.
 * Down to nothing, the line goes.
 */
function HoursStepper({
  line,
  working,
  onChange,
}: {
  readonly line: RecordState | null
  readonly working: boolean
  readonly onChange: (quantityMilli: number) => void
}) {
  const hours = line ? count(line, 'quantityMilli') : 0
  const step =
    'flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-control border border-control bg-ground text-[28px] font-medium text-ink disabled:cursor-not-allowed disabled:text-disabled'

  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        aria-label="Eine Viertelstunde weniger"
        disabled={working || hours === 0}
        onClick={() => {
          onChange(Math.max(0, hours - quarterHour))
        }}
        className={step}
      >
        −
      </button>
      <div className="min-w-0 grow text-center">
        <p className="numeric text-[34px] leading-[1.1] font-bold">
          {`${amount(hours)} ${lineUnitShort.hour}`}
        </p>
        <p className="text-[15px] text-ink-muted">
          {line ? text(line, 'designation') : 'Arbeitszeit'}
        </p>
      </div>
      <button
        type="button"
        aria-label="Eine Viertelstunde mehr"
        disabled={working}
        onClick={() => {
          onChange(hours + quarterHour)
        }}
        className={step}
      >
        +
      </button>
    </div>
  )
}

type Editor = 'text' | 'hours' | 'material'

/**
 * Writing the report, the board "Regiebericht schreiben, ohne Netz": the text,
 * the fields of the business, the hours and the material. Every entry is safe
 * on the device the moment it is saved, and none of them needs a network.
 */
function WritingStep({
  report,
  lines,
  onSign,
}: {
  readonly report: RecordState
  readonly lines: readonly RecordState[]
  readonly onSign: () => void
}) {
  const client = useSync()
  const reportId = String(report['id'])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const hasContent = maybeText(report, 'introText') !== null || lines.length > 0
  const nextPosition =
    lines.reduce((highest, line) => Math.max(highest, count(line, 'position')), 0) + 1
  const hoursLine = hoursLineOf(lines)
  const others = lines.filter((line) => line !== hoursLine && lineKindOf(line) !== 'title')

  async function addLine(values: {
    readonly designation: string
    readonly quantityMilli: number
    readonly unit: LineUnit
  }): Promise<EditResult> {
    const made = await client.create('document_lines', {
      documentId: reportId,
      kind: 'item',
      position: nextPosition,
      designation: values.designation,
      description: null,
      quantityMilli: values.quantityMilli,
      unit: values.unit,
      // A report carries no prices; the invoice made from it does. The column
      // wants a figure, and zero is the one that says "not priced here".
      unitPriceCents: 0,
    })

    if (made.outcome === 'queued') {
      setEditor(null)
    }

    return made
  }

  async function remove(id: string) {
    setTrouble(null)

    const result = await client.remove('document_lines', id)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))
    }
  }

  async function setHours(quantityMilli: number) {
    setTrouble(null)
    setWorking(true)

    try {
      const result = hoursLine
        ? quantityMilli === 0
          ? await client.remove('document_lines', String(hoursLine['id']))
          : await client.update('document_lines', String(hoursLine['id']), { quantityMilli })
        : await addLine({ designation: 'Arbeitszeit', quantityMilli, unit: 'hour' })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
      }
    } finally {
      setWorking(false)
    }
  }

  // Entering hours or material is a screen of its own on the board: the form
  // over the list, nothing else, and no bar at the foot.
  if (editor === 'hours' || editor === 'material') {
    return (
      <>
        <LineForm
          key={editor}
          editor={editor}
          onSave={addLine}
          onCancel={() => {
            setEditor(null)
          }}
        />
        <Panel
          title="Arbeitszeit und Material"
          action={<span className="text-[14px] text-ink-faint">{postsOf(lines)}</span>}
        >
          {lines.length === 0 ? (
            <SiteText muted>Noch keine Arbeitszeit und kein Material.</SiteText>
          ) : (
            <MaterialRows
              lines={lines.filter((line) => lineKindOf(line) !== 'title')}
              onRemove={(id) => {
                void remove(id)
              }}
            />
          )}
        </Panel>
        <SiteNoTabs />
      </>
    )
  }

  return (
    <>
      <Panel title="Was gemacht wurde">
        {editor === 'text' ? (
          <WorkDoneForm
            report={report}
            onDone={() => {
              setEditor(null)
            }}
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            <WorkDone report={report} />
            <Button
              wide
              height={48}
              icon={Pencil}
              onClick={() => {
                setEditor('text')
              }}
            >
              {maybeText(report, 'introText') ? 'Text ändern' : 'Text schreiben'}
            </Button>
          </div>
        )}
      </Panel>

      <ReportFieldsForm report={report} />

      <Panel
        title="Arbeitszeit und Material"
        action={<span className="text-[14px] text-ink-faint">{postsOf(lines)}</span>}
      >
        <div className="flex flex-col gap-3">
          <HoursStepper
            line={hoursLine}
            working={working}
            onChange={(value) => void setHours(value)}
          />
          <MaterialRows
            lines={others}
            onRemove={(id) => {
              void remove(id)
            }}
          />
          <div className="flex gap-2">
            <Button
              wide
              height={52}
              icon={Plus}
              disabled={editor !== null}
              onClick={() => {
                setEditor('material')
              }}
            >
              Material eintragen
            </Button>
            <ReportPhoto report={report} />
          </div>
          <Button
            tone="quiet"
            wide
            height={44}
            icon={Plus}
            disabled={editor !== null}
            onClick={() => {
              setEditor('hours')
            }}
          >
            {hoursLine ? 'Weitere Arbeitszeit eintragen' : 'Arbeitszeit eintragen'}
          </Button>
        </div>
      </Panel>

      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      <SiteActionBar
        note={
          !hasContent
            ? 'Unterschrieben wird ein Bericht mit Text oder mit Arbeitszeit und Material.'
            : editor !== null
              ? 'Erst die offene Eingabe sichern oder abbrechen. Unterschrieben wird, was gesichert ist.'
              : 'Wird ohne Netz gespeichert und später abgeglichen. Die Rechnung schreibt das Büro.'
        }
      >
        <Button
          tone="primary"
          wide
          icon={Signature}
          className="text-[19px]"
          disabled={editor !== null || !hasContent}
          onClick={onSign}
        >
          Vom Kunden unterschreiben lassen
        </Button>
      </SiteActionBar>
    </>
  )
}

/**
 * A photo from the report, the camera beside "Material eintragen" on the
 * board: it goes to the files of the job, where the office finds it with the
 * others, and waits on the device like every photo taken here.
 */
function ReportPhoto({ report }: { readonly report: RecordState }) {
  const client = useSync()
  const writes = useMay('attachment.write')
  const job = useRecord('jobs', maybeText(report, 'jobId') ?? undefined)
  const shooter = useRef<HTMLInputElement>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!writes || !job) {
    return null
  }

  const home = {
    customerId: String(job['customerId']),
    siteId: maybeText(job, 'siteId'),
    installationId: maybeText(job, 'installationId'),
    jobId: String(job['id']),
  }

  return (
    <>
      <button
        type="button"
        aria-label="Foto aufnehmen"
        title={trouble ?? 'Foto aufnehmen'}
        onClick={() => {
          shooter.current?.click()
        }}
        className="flex size-13 shrink-0 cursor-pointer items-center justify-center rounded-control border border-control bg-ground text-ink"
      >
        <Camera size={22} strokeWidth={2.1} aria-hidden="true" />
      </button>
      <input
        ref={shooter}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Foto zum Bericht aufnehmen"
        onChange={(event) => {
          const file = event.target.files?.[0]

          event.target.value = ''

          if (file) {
            void addAttachment(client, home, file, false).then(setTrouble)
          }
        }}
      />
    </>
  )
}

function WorkDoneForm({
  report,
  onDone,
}: {
  readonly report: RecordState
  readonly onDone: () => void
}) {
  const client = useSync()
  const [value, setValue] = useState(text(report, 'introText'))
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      const saved = await client.update('documents', String(report['id']), {
        introText: asTextOrNull(value),
      })

      if (saved.outcome === 'queued') {
        onDone()
      } else {
        setTrouble(refusalFor(saved))
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <TextArea
        label="Was gemacht wurde"
        rows={5}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
        }}
      />
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      <Button type="submit" tone="primary" wide height={52} icon={Check} disabled={working}>
        Text sichern
      </Button>
      <Button wide height={48} disabled={working} onClick={onDone}>
        Abbrechen
      </Button>
    </form>
  )
}

/**
 * One entry of time or material, the board "Material eintragen": a card of
 * its own over the list. Two variants of one form rather than one form with a
 * kind field: on site "Arbeitszeit eintragen" is a different action from
 * "Material eintragen", and hours have a unit nobody should have to pick.
 */
function LineForm({
  editor,
  onSave,
  onCancel,
}: {
  readonly editor: 'hours' | 'material'
  readonly onSave: (values: {
    readonly designation: string
    readonly quantityMilli: number
    readonly unit: LineUnit
  }) => Promise<EditResult>
  readonly onCancel: () => void
}) {
  const hours = editor === 'hours'
  const [designation, setDesignation] = useState(hours ? 'Arbeitszeit' : '')
  const [quantity, setQuantity] = useState(hours ? '' : '1')
  const [unit, setUnit] = useState<string>('piece')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()

    const found: Record<string, string> = {}
    const quantityMilli = parseQuantity(quantity)

    if (designation.trim() === '') {
      found['designation'] = hours
        ? 'Eine Bezeichnung braucht es, zum Beispiel Arbeitszeit.'
        : 'Was verbaut wurde, zum Beispiel Leitungsschutzschalter B16.'
    }

    if (quantityMilli === null || quantityMilli <= 0) {
      found['quantity'] =
        'Eine Zahl größer null mit höchstens drei Nachkommastellen, zum Beispiel 2,5.'
    }

    setProblems(found)

    if (Object.keys(found).length > 0 || quantityMilli === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const saved = await onSave({
        designation: designation.trim(),
        quantityMilli,
        unit: hours ? 'hour' : (lineUnits.find((known) => known === unit) ?? 'piece'),
      })

      if (saved.outcome === 'refused') {
        setTrouble(refusalFor(saved))
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={hours ? 'Arbeitszeit eintragen' : 'Material eintragen'}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <Field
          label={hours ? 'Bezeichnung' : 'Material'}
          value={designation}
          problem={problems['designation']}
          hint={
            hours
              ? 'Wie es im Bericht steht, zum Beispiel Arbeitszeit Geselle.'
              : 'Was verbaut wurde, zum Beispiel Leitungsschutzschalter B16.'
          }
          onChange={(event) => {
            setDesignation(event.target.value)
          }}
        />
        <div className="flex items-start gap-2.5">
          <div className={hours ? 'min-w-0 grow' : 'w-[120px] shrink-0'}>
            <Field
              label={hours ? 'Stunden' : 'Menge'}
              inputMode="decimal"
              numeric
              value={quantity}
              problem={problems['quantity']}
              onChange={(event) => {
                setQuantity(event.target.value)
              }}
            />
          </div>
          {hours ? null : (
            <div className="min-w-0 grow">
              <SelectField
                label="Einheit"
                value={unit}
                options={materialUnits}
                onChange={setUnit}
              />
            </div>
          )}
        </div>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
        <Button type="submit" tone="primary" wide height={52} icon={Check} disabled={working}>
          {hours ? 'Arbeitszeit sichern' : 'Material sichern'}
        </Button>
        <Button wide height={48} disabled={working} onClick={onCancel}>
          Abbrechen
        </Button>
      </form>
    </Panel>
  )
}

/**
 * The page the customer reads and signs, the board "Vom Kunden unterschreiben
 * lassen", and nothing on it can be changed.
 *
 * It is the saved report and not a form: what is shown here is what the
 * fingerprint is worked out from, in the same render, so the customer signs
 * exactly the page in front of them. Should the office add a line while they
 * are reading, it appears here before they sign, or the server refuses the
 * signature because it arrived for a page that no longer exists.
 */
function SigningStep({
  report,
  lines,
  onBack,
}: {
  readonly report: RecordState
  readonly lines: readonly RecordState[]
  readonly onBack: () => void
}) {
  const client = useSync()
  const [signerName, setSignerName] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const formId = useId()
  const fingerprint = signedContentFingerprint(signedContentOf(report, lines))

  async function sign(event: FormEvent) {
    event.preventDefault()

    // Empty, or longer than the table keeps. The server would refuse the
    // second as well, and with the signature everything queued behind it
    // (#118); said here, it never leaves the device.
    const nameProblem = signerNameProblem(signerName)

    if (nameProblem !== null) {
      setProblem(nameProblem)

      return
    }

    if (!path) {
      setTrouble('Bitte im Feld unterschreiben.')

      return
    }

    setProblem(undefined)
    setTrouble(null)
    setWorking(true)

    try {
      const made = await client.create('document_signatures', {
        documentId: String(report['id']),
        signerName: signerName.trim(),
        signedAt: new Date().toISOString(),
        // The "device information" of section 4.10, as much as the table
        // keeps: no browser that says more says anything more useful.
        deviceInfo: globalThis.navigator.userAgent.slice(0, longestDeviceInfo),
        path,
        contentFingerprint: fingerprint,
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <p className="text-[18px] leading-[1.45] font-semibold">
        Bitte lesen Sie den Bericht und unterschreiben Sie darunter.
      </p>

      <ReadOnlyReport report={report} lines={lines} />

      <form
        id={formId}
        className="contents"
        onSubmit={(event) => {
          void sign(event)
        }}
      >
        <Panel title="Unterschrift">
          <div className="flex flex-col gap-3">
            <Field
              label="Name"
              autoComplete="off"
              value={signerName}
              problem={problem}
              onChange={(event) => {
                setSignerName(event.target.value)
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
          Zurück zum Bericht
        </Button>
      </SiteActionBar>
    </>
  )
}

/** The report as it is signed: what was done, the fields, and the lines. */
function ReadOnlyReport({
  report,
  lines,
}: {
  readonly report: RecordState
  readonly lines: readonly RecordState[]
}) {
  return (
    <>
      <Panel title="Was gemacht wurde">
        <WorkDone report={report} />
      </Panel>

      <ReportFieldsText report={report} />

      <Panel title="Arbeitszeit und Material">
        <ReadLines lines={lines} />
      </Panel>
    </>
  )
}

/**
 * A report nothing changes on any more, the board "Regiebericht
 * unterschrieben": the state, why it stays as it is, the report, and the
 * signature it carries.
 */
function SignedReport({
  report,
  lines,
  signature,
  status,
}: {
  readonly report: RecordState
  readonly lines: readonly RecordState[]
  readonly signature: RecordState | null
  readonly status: DocumentStatus
}) {
  const client = useSync()
  const fixed = whyFixed({ kind: documentKindOf(report), status })

  return (
    <>
      <div>
        <DocumentState status={status} number={maybeText(report, 'number')} />
      </div>

      {fixed ? (
        <p
          role="status"
          className="rounded-[6px] border border-line bg-surface-sunken px-3.5 py-3 text-[16px] leading-[1.45]"
        >
          {fixed}
        </p>
      ) : null}

      <ReadOnlyReport report={report} lines={lines} />

      {signature ? (
        <Panel title="Unterschrift">
          <div className="flex flex-col gap-2">
            <SignaturePicture
              path={text(signature, 'path')}
              label={`Unterschrift von ${text(signature, 'signerName')}`}
              className="h-[120px]"
            />
            <p className="text-[16px] font-semibold">
              {`${text(signature, 'signerName')}, ${moment(maybeText(signature, 'signedAt'))} Uhr`}
            </p>
            {client.isPending('document_signatures', String(signature['id'])) ? (
              <SiteText muted size={15}>
                Noch nicht übertragen. Die Unterschrift geht mit dem nächsten Abgleich ins Büro.
              </SiteText>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  )
}
