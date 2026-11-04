import {
  customerHoldSentence,
  type ErasureRequestChannel,
  erasureRequestChannelLabel,
  erasureRequestChannels,
  erasureRequestProblem,
  erasureRequestTitle,
  type ErasureRequestView,
  type IsoDate,
} from '@opengewerk/domain'
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  Status,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { RequestRefused, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Shield } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { useMay } from '../../app/queries.js'
import {
  erasureRequestKey,
  privacyKey,
  recordErasureRequest,
  runningErasureRequest,
} from '../../session/privacy.js'

/** What holds the customer today, or that nothing does, in the office's words. */
export function holdsSentence(view: Pick<ErasureRequestView, 'holds'>): string {
  return view.holds.length === 0
    ? 'Mit dem Kunden läuft nichts mehr.'
    : view.holds.map(customerHoldSentence).join(' ')
}

/**
 * "Datenschutz" in the file of a customer (#845), as the boards "Kundenakte
 * mit Löschanfrage" draw it: the request for deletion that runs, with what
 * holds the customer, or a way to record one. Answered is it under
 * "Einstellungen, Datenschutz". Asked with a connection, since nothing of it
 * goes to a device.
 */
export function CustomerPrivacyPanel({
  customerId,
  customerName,
}: {
  readonly customerId: string
  readonly customerName: string
}) {
  const writes = useMay('customer.write')
  const { online } = useSyncStatus()
  const [recording, setRecording] = useState(false)
  const running = useQuery({
    queryKey: erasureRequestKey(customerId),
    queryFn: () => runningErasureRequest(customerId),
    enabled: online,
  })
  const view = running.data ?? null
  const action =
    view !== null ? (
      <Status tone={view.request.status === 'restricted' ? 'locked' : 'waiting'}>
        {view.request.status === 'restricted' ? 'Gesperrt' : 'Offen'}
      </Status>
    ) : writes && running.isSuccess ? (
      <Button
        size="small"
        icon={Shield}
        onClick={() => {
          setRecording(true)
        }}
      >
        Löschanfrage erfassen
      </Button>
    ) : null

  return (
    <Panel title="Datenschutz" action={action}>
      {!online && running.data === undefined ? (
        <p className="text-[14px] text-ink-muted">Löschanfragen stehen mit Verbindung hier.</p>
      ) : running.isPending ? (
        <p className="text-[14px] text-ink-muted">Wird geladen.</p>
      ) : running.isError ? (
        <p className="text-[14px] text-ink-muted">Die Löschanfrage kam nicht an.</p>
      ) : view === null ? (
        <p className="text-[14px] text-ink-muted">Keine Löschanfrage.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-[14px]">
            {`${erasureRequestTitle(view.request)}, Antwort bis ${date(view.request.answerDueOn)}.`}
          </p>
          <p className="text-[14px] text-ink-muted">{holdsSentence(view)}</p>
          <p className="text-[13px] text-ink-faint">
            Beantwortet wird unter{' '}
            <Link
              to="/einstellungen/datenschutz"
              className="text-copper-text underline underline-offset-2"
            >
              Einstellungen, Datenschutz
            </Link>
            .
          </p>
        </div>
      )}
      {recording ? (
        <RecordDialog
          customerId={customerId}
          customerName={customerName}
          onClose={() => {
            setRecording(false)
          }}
        />
      ) : null}
    </Panel>
  )
}

/** The dialog "Löschanfrage erfassen": the day it came in and how. */
function RecordDialog({
  customerId,
  customerName,
  onClose,
}: {
  readonly customerId: string
  readonly customerName: string
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [receivedOn, setReceivedOn] = useState<string>(today())
  const [channel, setChannel] = useState<ErasureRequestChannel>('email')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const values = { customerId, receivedOn: receivedOn as IsoDate, channel }
    const problem = erasureRequestProblem(values, today())

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setWorking(true)

    try {
      await recordErasureRequest(values)
      await queries.invalidateQueries({ queryKey: privacyKey })
      onClose()
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Eine Löschanfrage wird mit Verbindung erfasst.',
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title="Löschanfrage erfassen" width={520} onClose={onClose}>
      <form
        className="flex flex-col gap-[13px]"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <p className="text-[14px] leading-normal">{`${customerName} bittet um das Löschen der Daten.`}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Eingegangen am"
            type="date"
            starred
            value={receivedOn}
            onChange={(event) => {
              setReceivedOn(event.target.value)
            }}
          />
          <SelectField
            label="Weg"
            value={channel}
            options={erasureRequestChannels.map((option) => ({
              value: option,
              label: erasureRequestChannelLabel[option],
            }))}
            hint="Brief, E-Mail, Telefon, persönlich oder anders."
            onChange={(value) => {
              setChannel(value as ErasureRequestChannel)
            }}
          />
        </div>
        <p className="text-[13px] text-ink-faint">
          Die Antwort ist einen Monat nach Eingang fällig (Art. 12 Abs. 3 DSGVO); eine Frist
          erinnert daran. Beantwortet wird unter Einstellungen, Datenschutz, von dem, der den
          Betrieb führt.
        </p>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button onClick={onClose} disabled={working}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Wird erfasst' : 'Erfassen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
