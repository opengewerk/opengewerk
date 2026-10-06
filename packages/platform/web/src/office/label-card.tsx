import {
  labelAddress,
  type LabelFormat,
  labelPrintProblem,
  printedLabelCode,
} from '@opengewerk/platform-domain'
import { Ban, Plus, Printer } from 'lucide-react'
import { useState } from 'react'

import { Button, ButtonLink } from '../components/button.js'
import { Confirm } from '../components/confirm.js'
import { Field, SelectField } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { QrCode } from '../components/qr-code.js'
import { date } from '../format.js'
import { RequestRefused } from '../sync/transport.js'

/** What an application says on the card of a label, each a whole sentence of its own. */
export interface LabelCardWords {
  /** The title of the card. */
  readonly title: string
  /** What stands there while the record has no label yet: what one is for. */
  readonly none: string
  /** What blocking means, asked before it is done; it names the code as it is printed. */
  readonly blocking: (printedCode: string) => string
  /** A sentence of the application's own after the one about a sheet that was begun. */
  readonly sheetNote?: string
}

/** A label as the card shows it. */
export interface CardLabel {
  readonly id: string
  readonly code: string
  /** When it was made, as the record says it, or null. */
  readonly createdAt: string | null
}

export interface LabelCardProps {
  readonly words: LabelCardWords
  /** The label that opens the record, or null. */
  readonly valid: CardLabel | null
  /** The label blocked last, which the card names as long as there is no valid one. */
  readonly lastBlocked: { readonly code: string; readonly blockedAt: string } | null
  readonly online: boolean
  /** Whether the person may make a label, and whether they may block one. */
  readonly mayMake: boolean
  readonly mayBlock: boolean
  /** Makes a label and brings it onto this device; what it throws, the card says. */
  readonly onMake: () => Promise<void>
  readonly onBlock: (label: CardLabel) => Promise<void>
  /** The address of the PDF, for a link that opens it. */
  readonly pdfAddress: (
    label: CardLabel,
    format: LabelFormat,
    count: number,
    start: number,
  ) => string
}

const formats: readonly { readonly value: LabelFormat; readonly label: string }[] = [
  { value: 'roll', label: 'Etikettendrucker, 62 × 29 mm' },
  { value: 'sheet', label: 'Bogen A4, 70 × 37 mm, 24 je Bogen' },
]

function whole(value: string): number {
  return /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The card of the label of a record, in the side column of its page: the
 * valid label with its QR and its code, printing it as a PDF for a label
 * printer or a sheet, and blocking it; without one, the way to make one.
 * Making, printing and blocking go to the server and need a connection; the
 * card says so rather than failing.
 *
 * What a label hangs on, who may make and block one, and at which routes, the
 * application says; so does every sentence that speaks to the reader.
 */
export function LabelCard({
  words,
  valid,
  lastBlocked,
  online,
  mayMake,
  mayBlock,
  onMake,
  onBlock,
  pdfAddress,
}: LabelCardProps) {
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [blocking, setBlocking] = useState(false)

  async function make() {
    setBusy(true)
    setTrouble(null)

    try {
      await onMake()
    } catch (error) {
      setTrouble(saidWhy(error, 'Keine Verbindung. Ein Etikett legt der Server an.'))
    } finally {
      setBusy(false)
    }
  }

  async function block(label: CardLabel) {
    setBusy(true)
    setTrouble(null)

    try {
      await onBlock(label)
      setBlocking(false)
    } catch (error) {
      setTrouble(saidWhy(error, 'Keine Verbindung. Gesperrt wird über den Server.'))
    } finally {
      setBusy(false)
    }
  }

  const troubleLine = trouble ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {trouble}
    </p>
  ) : null

  if (!valid) {
    return (
      <Panel title={words.title}>
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] leading-[1.45] text-ink-muted">
            {lastBlocked
              ? 'Kein gültiges Etikett. Das letzte ist gesperrt und öffnet nichts mehr.'
              : words.none}
          </p>
          {mayMake ? (
            <div>
              <Button
                tone="primary"
                icon={Plus}
                disabled={busy || !online}
                title={
                  online
                    ? undefined
                    : 'Ein Etikett legt der Server an, dafür braucht es Verbindung.'
                }
                onClick={() => {
                  void make()
                }}
              >
                {lastBlocked ? 'Neues Etikett anlegen' : 'Etikett anlegen'}
              </Button>
            </div>
          ) : null}
          {troubleLine}
          {lastBlocked ? (
            <p className="border-t border-row pt-2.5 text-[13px] leading-[1.45] text-ink-faint">
              Gesperrt am {date(lastBlocked.blockedAt)}:
              <br />
              <span className="font-condensed tracking-[1px]">
                {printedLabelCode(lastBlocked.code)}
              </span>
            </p>
          ) : null}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title={words.title}>
      <ValidLabel
        label={valid}
        online={online}
        mayBlock={mayBlock}
        busy={busy}
        sheetNote={words.sheetNote}
        pdfAddress={pdfAddress}
        onBlock={() => {
          setBlocking(true)
        }}
      />
      {troubleLine}
      <Confirm
        open={blocking}
        title="Etikett sperren?"
        confirm="Sperren"
        busy={busy}
        onConfirm={() => {
          void block(valid)
        }}
        onCancel={() => {
          setBlocking(false)
        }}
      >
        {words.blocking(printedLabelCode(valid.code))}
      </Confirm>
    </Panel>
  )
}

function ValidLabel({
  label,
  online,
  mayBlock,
  busy,
  sheetNote,
  pdfAddress,
  onBlock,
}: {
  readonly label: CardLabel
  readonly online: boolean
  readonly mayBlock: boolean
  readonly busy: boolean
  readonly sheetNote: string | undefined
  readonly pdfAddress: LabelCardProps['pdfAddress']
  readonly onBlock: () => void
}) {
  const [format, setFormat] = useState<LabelFormat>('roll')
  const [count, setCount] = useState('1')
  const [start, setStart] = useState('1')
  const problem = labelPrintProblem(format, whole(count), format === 'sheet' ? whole(start) : 1)

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <QrCode
          text={labelAddress(window.location.origin, label.code)}
          label={`QR-Code des Etiketts ${printedLabelCode(label.code)}`}
          ecc="Q"
          className="h-[104px] w-[104px] shrink-0 rounded-[4px] border border-line"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-condensed text-[14px] font-semibold tracking-[1.2px] [overflow-wrap:anywhere]">
            {printedLabelCode(label.code)}
          </p>
          {label.createdAt ? (
            <p className="text-[13px] leading-[1.4] text-ink-muted">
              Angelegt am {date(label.createdAt)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="h-px bg-row" />
      <SelectField
        label="Format"
        options={formats}
        value={format}
        onChange={(value) => {
          setFormat(value === 'sheet' ? 'sheet' : 'roll')
        }}
      />
      {format === 'sheet' ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Anzahl"
              inputMode="numeric"
              numeric
              value={count}
              onChange={(event) => {
                setCount(event.target.value)
              }}
            />
            <Field
              label="Beginnen bei"
              inputMode="numeric"
              numeric
              value={start}
              onChange={(event) => {
                setStart(event.target.value)
              }}
            />
          </div>
          <p className="text-[12px] leading-[1.45] text-ink-muted">
            {`Für einen angefangenen Bogen: 1 ist oben links, gezählt wird Zeile für Zeile.${
              sheetNote ? ` ${sheetNote}` : ''
            }`}
          </p>
        </>
      ) : (
        <div className="w-[90px]">
          <Field
            label="Anzahl"
            inputMode="numeric"
            numeric
            value={count}
            onChange={(event) => {
              setCount(event.target.value)
            }}
          />
        </div>
      )}
      {problem ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {online && !problem ? (
          <ButtonLink
            tone="primary"
            icon={Printer}
            href={pdfAddress(label, format, whole(count), format === 'sheet' ? whole(start) : 1)}
            target="_blank"
            rel="noopener noreferrer"
          >
            PDF öffnen
          </ButtonLink>
        ) : (
          <Button
            tone="primary"
            icon={Printer}
            disabled
            title={
              online ? undefined : 'Das Etikett druckt der Server, dafür braucht es Verbindung.'
            }
          >
            PDF öffnen
          </Button>
        )}
        {mayBlock ? (
          <Button icon={Ban} disabled={busy || !online} onClick={onBlock}>
            Sperren
          </Button>
        ) : null}
      </div>
      {online ? null : (
        <p className="text-[12px] leading-[1.45] text-ink-muted">
          Drucken und Sperren gehen über den Server, dafür braucht es Verbindung.
        </p>
      )}
    </div>
  )
}
