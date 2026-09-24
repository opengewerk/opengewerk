import type { DocumentStatus, LineUnit, RecordState } from '@opengewerk/domain'
import {
  lineUnits,
  longestDeviceInfo,
  signedContentFingerprint,
  signerNameProblem,
  whyFixed,
} from '@opengewerk/domain'
import { useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  Button,
  Card,
  DocumentState,
  Field,
  FieldLabel,
  SelectField,
  TextArea,
} from '../../components/index.js'
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
import { asTextOrNull } from '../../app/record-form.js'
import { SignaturePicture } from '../../app/signature.js'
import type { EditResult } from '../../sync/client.js'
import { refusalText } from '../../sync/client.js'
import { count, maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated, useSync } from '../../sync/provider.js'
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

/** What the device knows about the report, the signature it holds included. */
function shownStatus(status: DocumentStatus, signature: RecordState | null): DocumentStatus {
  // Signed on this device and not sent yet, the server still says draft. The
  // device knows better, and a badge saying "Entwurf" over a signature would
  // invite somebody to change what the customer has just signed.
  return status === 'draft' && signature ? 'signed' : status
}

/**
 * A time and material report, written on site and signed there by the
 * customer, section 4.10 and #73.
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
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-title font-semibold">Nicht gefunden</h1>
        <p className="text-body">
          Diesen Bericht hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </p>
      </div>
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
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <FieldLabel>Regiebericht</FieldLabel>
        <h1 className="text-title font-semibold">
          {job ? text(job, 'designation') : text(report, 'subject') || 'Regiebericht'}
        </h1>
        <p className="text-body text-ink-muted">
          {[customer ? text(customer, 'name') : '', date(report['documentDate'])]
            .filter((part) => part !== '')
            .join(', ')}
        </p>
        <div>
          <DocumentState status={status} number={maybeText(report, 'number')} />
        </div>
        {client.isPending('documents', reportId) ? (
          <p className="text-body text-ink-muted">Noch nicht übertragen.</p>
        ) : null}
      </div>

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
    </div>
  )
}

/** The lines as the customer reads them: quantity, unit, what it was. */
function LineList({
  lines,
  onRemove,
}: {
  readonly lines: readonly RecordState[]
  /** Given while the report can still change, and only then. */
  readonly onRemove?: (id: string) => void
}) {
  const [removing, setRemoving] = useState<string | null>(null)

  if (lines.length === 0) {
    return <p className="text-body text-ink-muted">Noch keine Arbeitszeit und kein Material.</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {lines.map((line) => {
        const id = String(line['id'])
        const title = lineKindOf(line) === 'title'
        const description = maybeText(line, 'description')

        return (
          <li key={id} className="flex flex-col gap-2 py-3">
            <div className="flex items-baseline gap-3">
              {title ? null : (
                <span className="numeric shrink-0 text-body font-semibold">
                  {`${amount(count(line, 'quantityMilli'))} ${lineUnitShort[lineUnitOf(line)]}`}
                </span>
              )}
              <span className={title ? 'text-body font-semibold' : 'text-body'}>
                {text(line, 'designation')}
              </span>
            </div>
            {description ? (
              <p className="text-body text-ink-muted whitespace-pre-line">{description}</p>
            ) : null}
            {onRemove ? (
              removing === id ? (
                <div className="flex flex-wrap gap-3">
                  <Button
                    tone="danger"
                    onClick={() => {
                      setRemoving(null)
                      onRemove(id)
                    }}
                  >
                    Entfernen
                  </Button>
                  <Button
                    tone="quiet"
                    onClick={() => {
                      setRemoving(null)
                    }}
                  >
                    Behalten
                  </Button>
                </div>
              ) : (
                <div>
                  <Button
                    tone="quiet"
                    onClick={() => {
                      setRemoving(id)
                    }}
                  >
                    {`${text(line, 'designation')} entfernen`}
                  </Button>
                </div>
              )
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/** What the report says was done, above its lines, as on paper. */
function WorkDone({ report }: { readonly report: RecordState }) {
  const introText = maybeText(report, 'introText')

  return introText ? (
    <p className="text-body whitespace-pre-line">{introText}</p>
  ) : (
    <p className="text-body text-ink-muted">Noch nichts eingetragen.</p>
  )
}

type Editor = 'text' | 'hours' | 'material'

/**
 * Writing the report: the text, the hours, the material. Every entry is safe
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
  const hasContent = maybeText(report, 'introText') !== null || lines.length > 0
  const nextPosition =
    lines.reduce((highest, line) => Math.max(highest, count(line, 'position')), 0) + 1

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
      setTrouble(refusalText[result.reason])
    }
  }

  return (
    <>
      <Card label="Was gemacht wurde">
        {editor === 'text' ? (
          <WorkDoneForm
            report={report}
            onDone={() => {
              setEditor(null)
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <WorkDone report={report} />
            <div>
              <Button
                tone="secondary"
                disabled={editor !== null}
                onClick={() => {
                  setEditor('text')
                }}
              >
                {maybeText(report, 'introText') ? 'Text ändern' : 'Text schreiben'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ReportFieldsForm report={report} />

      <Card label="Arbeitszeit und Material">
        <div className="flex flex-col gap-3">
          <LineList
            lines={lines}
            onRemove={
              editor === null
                ? (id) => {
                    void remove(id)
                  }
                : undefined
            }
          />

          {editor === 'hours' || editor === 'material' ? (
            <LineForm
              key={editor}
              editor={editor}
              onSave={addLine}
              onCancel={() => {
                setEditor(null)
              }}
            />
          ) : null}

          {editor === null ? (
            <div className="flex flex-col gap-3">
              <Button
                tone="secondary"
                wide
                onClick={() => {
                  setEditor('hours')
                }}
              >
                Arbeitszeit eintragen
              </Button>
              <Button
                tone="secondary"
                wide
                onClick={() => {
                  setEditor('material')
                }}
              >
                Material eintragen
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button tone="primary" wide disabled={editor !== null || !hasContent} onClick={onSign}>
          Vom Kunden unterschreiben lassen
        </Button>
        {!hasContent ? (
          <p className="text-body text-ink-muted">
            Unterschrieben wird ein Bericht mit Text oder mit Arbeitszeit und Material.
          </p>
        ) : editor !== null ? (
          <p className="text-body text-ink-muted">
            Erst die offene Eingabe sichern oder abbrechen. Unterschrieben wird, was gesichert ist.
          </p>
        ) : null}
      </div>
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
        setTrouble(refusalText[saved.reason])
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
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary" disabled={working}>
          Text sichern
        </Button>
        <Button tone="quiet" disabled={working} onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/**
 * One entry of time or material. Two variants of one form rather than one
 * form with a kind field: on site "Arbeitszeit eintragen" is a different
 * action from "Material eintragen", and hours have a unit nobody should have
 * to pick.
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
        setTrouble(refusalText[saved.reason])
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
      <Field
        label={hours ? 'Bezeichnung' : 'Material'}
        value={designation}
        problem={problems['designation']}
        onChange={(event) => {
          setDesignation(event.target.value)
        }}
      />
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
      {hours ? null : (
        <SelectField label="Einheit" value={unit} options={materialUnits} onChange={setUnit} />
      )}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary" disabled={working}>
          {hours ? 'Arbeitszeit sichern' : 'Material sichern'}
        </Button>
        <Button tone="quiet" disabled={working} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/**
 * The page the customer reads and signs, and nothing on it can be changed.
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
        setTrouble(refusalText[made.reason])
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void sign(event)
      }}
    >
      <p className="text-body font-semibold">
        Bitte lesen Sie den Bericht und unterschreiben Sie darunter.
      </p>

      <Card label="Was gemacht wurde">
        <WorkDone report={report} />
      </Card>

      <ReportFieldsText report={report} />

      <Card label="Arbeitszeit und Material">
        <LineList lines={lines} />
      </Card>

      <Card label="Unterschrift">
        <div className="flex flex-col gap-4">
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
      </Card>

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="submit" tone="primary" wide disabled={working}>
          Unterschreiben
        </Button>
        <Button tone="quiet" wide disabled={working} onClick={onBack}>
          Zurück zum Bericht
        </Button>
      </div>
    </form>
  )
}

/** A report nothing changes on any more, with the signature it carries. */
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
      {fixed ? (
        <Card label="Nicht mehr änderbar" tone="sunken">
          <p role="status" className="text-body">
            {fixed}
          </p>
        </Card>
      ) : null}

      <Card label="Was gemacht wurde">
        <WorkDone report={report} />
      </Card>

      <ReportFieldsText report={report} />

      <Card label="Arbeitszeit und Material">
        <LineList lines={lines} />
      </Card>

      {signature ? (
        <Card label="Unterschrift">
          <div className="flex flex-col gap-2">
            <SignaturePicture
              path={text(signature, 'path')}
              label={`Unterschrift von ${text(signature, 'signerName')}`}
            />
            <p className="text-body">
              {`${text(signature, 'signerName')}, ${moment(maybeText(signature, 'signedAt'))} Uhr`}
            </p>
            {client.isPending('document_signatures', String(signature['id'])) ? (
              <p className="text-body text-ink-muted">
                Noch nicht übertragen. Die Unterschrift geht mit dem nächsten Abgleich ins Büro.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}
    </>
  )
}
