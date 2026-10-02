import {
  labelAddress,
  type LabelFormat,
  labelPrintProblem,
  printedLabelCode,
  type RecordState,
} from '@opengewerk/domain'
import { Button, ButtonLink, Confirm, Field, Panel, SelectField } from '@opengewerk/platform-web'
import { Ban, Plus, Printer } from 'lucide-react'
import { useState } from 'react'

import { date } from '../../app/format.js'
import {
  blockLabel,
  createLabel,
  labelPdfAddress,
  useInstallationLabels,
} from '../../app/installation-labels.js'
import { useMay } from '../../app/queries.js'
import { QrCode } from '../../app/setup.js'
import { maybeText, text } from '../../sync/fields.js'
import { useSync, useSyncStatus } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'

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
 * "QR-Etikett", the card of the label in the side column of an installation
 * (#308), as the boards "Anlagenakte mit QR-Etikett" and "Die Karte
 * QR-Etikett" draw it: the valid label with its QR and its code, printing it
 * as a PDF for a label printer or a sheet, and blocking it; without one, the
 * way to make one. Making, printing and blocking go to the server and need a
 * connection; the card says so rather than failing.
 */
export function LabelPanel({ installationId }: { readonly installationId: string }) {
  const client = useSync()
  const { online } = useSyncStatus()
  const mayWrite = useMay('installation.write')
  const { valid, lastBlocked } = useInstallationLabels(installationId)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [blocking, setBlocking] = useState(false)

  async function make() {
    setBusy(true)
    setTrouble(null)

    try {
      await createLabel(installationId)
      await client.synchronise()
    } catch (error) {
      setTrouble(saidWhy(error, 'Keine Verbindung. Ein Etikett legt der Server an.'))
    } finally {
      setBusy(false)
    }
  }

  async function block(label: RecordState) {
    setBusy(true)
    setTrouble(null)

    try {
      await blockLabel(installationId, String(label['id']))
      await client.synchronise()
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
      <Panel title="QR-Etikett">
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] leading-[1.45] text-ink-muted">
            {lastBlocked
              ? 'Kein gültiges Etikett. Das letzte ist gesperrt und öffnet nichts mehr.'
              : 'Noch kein Etikett. Ein Etikett im Zählerschrank oder am Wechselrichter öffnet diese Anlage, wenn es jemand mit der App oder der Kamera des Telefons scannt.'}
          </p>
          {mayWrite ? (
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
              Gesperrt am {date(lastBlocked['blockedAt'])}:
              <br />
              <span className="font-condensed tracking-[1px]">
                {printedLabelCode(text(lastBlocked, 'code'))}
              </span>
            </p>
          ) : null}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="QR-Etikett">
      <ValidLabel
        installationId={installationId}
        label={valid}
        online={online}
        mayWrite={mayWrite}
        busy={busy}
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
        Das Etikett {printedLabelCode(text(valid, 'code'))} öffnet danach nichts mehr, auch kein
        Exemplar, das schon klebt: weder in der App noch im Browser. Sperren lässt sich nicht
        zurücknehmen; ein neues Etikett legst du danach an.
      </Confirm>
    </Panel>
  )
}

function ValidLabel({
  installationId,
  label,
  online,
  mayWrite,
  busy,
  onBlock,
}: {
  readonly installationId: string
  readonly label: RecordState
  readonly online: boolean
  readonly mayWrite: boolean
  readonly busy: boolean
  readonly onBlock: () => void
}) {
  const [format, setFormat] = useState<LabelFormat>('roll')
  const [count, setCount] = useState('1')
  const [start, setStart] = useState('1')
  const code = text(label, 'code')
  const problem = labelPrintProblem(format, whole(count), format === 'sheet' ? whole(start) : 1)
  const created = maybeText(label, 'createdAt')

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <QrCode
          text={labelAddress(window.location.origin, code)}
          label={`QR-Code des Etiketts ${printedLabelCode(code)}`}
          ecc="Q"
          className="h-[104px] w-[104px] shrink-0 rounded-[4px] border border-line"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-condensed text-[14px] font-semibold tracking-[1.2px] [overflow-wrap:anywhere]">
            {printedLabelCode(code)}
          </p>
          {created ? (
            <p className="text-[13px] leading-[1.4] text-ink-muted">Angelegt am {date(created)}</p>
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
            Für einen angefangenen Bogen: 1 ist oben links, gezählt wird Zeile für Zeile. Im
            Zählerschrank hält Folie länger als Papier.
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
            href={labelPdfAddress(
              installationId,
              String(label['id']),
              format,
              whole(count),
              format === 'sheet' ? whole(start) : 1,
            )}
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
        {mayWrite ? (
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
