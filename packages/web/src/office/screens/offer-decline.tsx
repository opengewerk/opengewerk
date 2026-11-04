import { type IsoDate, offerDeclineProblems } from '@opengewerk/domain'
import { Button, Dialog, DialogActions, Field, Panel, TextArea } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { RequestRefused, useSync, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { useMay } from '../../app/queries.js'
import { maintenanceContracts } from '../../session/maintenance-contracts.js'
import {
  declineOffer,
  type OfferDeclineEntry,
  offerDeclines,
  offerDeclinesKey,
  withdrawDecline,
} from '../../session/offer-declines.js'

/** The declines of the business (#841), for whoever reads documents and while there is a connection. */
export function useOfferDeclines() {
  const { online } = useSyncStatus()
  const reads = useMay('document.read')

  return useQuery({
    queryKey: offerDeclinesKey,
    queryFn: () => offerDeclines(),
    enabled: online && reads,
  })
}

/** The decline of one offer, or undefined where there is none or it is not known yet. */
export function useOfferDecline(documentId: string): OfferDeclineEntry | undefined {
  return useOfferDeclines().data?.find((entry) => entry.documentId === documentId)
}

/**
 * The card "Ablehnung" beside an issued quote or cost estimate (#841): the
 * office marks that the customer turned it down, and takes the mark back.
 * Offered while nothing follows the offer, no document and no contract; the
 * documents say it was taken once something follows.
 */
export function OfferDeclineCard({
  documentId,
  number,
  offeredOn,
  followed,
}: {
  readonly documentId: string
  readonly number: string
  readonly offeredOn: IsoDate
  readonly followed: boolean
}) {
  const issues = useMay('document.issue')
  const reads = useMay('document.read')
  const { online } = useSyncStatus()
  const queries = useQueryClient()
  const declines = useOfferDeclines()
  const decline = declines.data?.find((entry) => entry.documentId === documentId)
  const contracts = useQuery({
    queryKey: ['maintenance-contracts', { quoteId: documentId }],
    queryFn: () => maintenanceContracts({ quoteId: documentId }),
    // Read with the documents; who may mark the offer is the one question below.
    enabled: online && reads,
  })
  const [asking, setAsking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!declines.data) {
    return null
  }

  async function withdraw() {
    setTrouble(null)

    try {
      await withdrawDecline(documentId)
      await queries.invalidateQueries({ queryKey: offerDeclinesKey })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : 'Keine Verbindung.')
    }
  }

  if (decline) {
    return (
      <Panel title="Ablehnung">
        <div className="flex flex-col items-start gap-2">
          <span className="text-[14px] font-semibold">{`Abgelehnt am ${date(decline.declinedOn)}`}</span>
          {decline.reason ? (
            <p className="whitespace-pre-line text-[14px] leading-[1.45]">{decline.reason}</p>
          ) : null}
          <p className="text-[13px] leading-[1.45] text-ink-muted">
            Das Angebot steht nicht mehr im Vertrieb, und seine Wiedervorlage ist entfallen. Will
            der Kunde doch, die Ablehnung zurücknehmen.
          </p>
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          {issues ? <Button onClick={() => void withdraw()}>Ablehnung zurücknehmen</Button> : null}
        </div>
      </Panel>
    )
  }

  if (!issues || followed || !contracts.data || contracts.data.length > 0) {
    return null
  }

  return (
    <Panel title="Ablehnung">
      <div className="flex flex-col items-start gap-2.5">
        <p className="text-[13px] leading-[1.45] text-ink-muted">
          Hat der Kunde abgelehnt, kommt das Angebot aus dem Vertrieb, und die Wiedervorlage
          entfällt.
        </p>
        <Button
          icon={X}
          onClick={() => {
            setAsking(true)
          }}
        >
          Als abgelehnt markieren
        </Button>
      </div>
      {asking ? (
        <DeclineDialog
          documentId={documentId}
          number={number}
          offeredOn={offeredOn}
          onClose={() => {
            setAsking(false)
          }}
        />
      ) : null}
    </Panel>
  )
}

/** The dialog "Angebot als abgelehnt markieren": the day, today unless the office says otherwise, and a reason. */
function DeclineDialog({
  documentId,
  number,
  offeredOn,
  onClose,
}: {
  readonly documentId: string
  readonly number: string
  readonly offeredOn: IsoDate
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [declinedOn, setDeclinedOn] = useState(today())
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const found = offerDeclineProblems(
      { declinedOn, reason },
      { today: today() as IsoDate, offeredOn },
    )

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      await declineOffer(documentId, declinedOn, reason.trim() === '' ? null : reason.trim())
      await queries.invalidateQueries({ queryKey: offerDeclinesKey })
      // The follow-up of the quote lapses on the server; the list of deadlines asks again.
      await client.synchronise().catch(() => undefined)
      onClose()
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Ein Angebot wird mit Verbindung als abgelehnt markiert.',
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title="Angebot als abgelehnt markieren" width={520} onClose={onClose}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <p className="text-[14px] leading-[1.55]">
          {`${number} kommt aus dem Vertrieb, und die Wiedervorlage entfällt. Der Beleg selbst bleibt, wie er festgeschrieben wurde.`}
        </p>
        <Field
          label="Abgelehnt am"
          type="date"
          required
          starred
          value={declinedOn}
          hint="Der Tag, an dem der Kunde abgesagt hat."
          problem={problems['declinedOn']}
          onChange={(event) => {
            setDeclinedOn(event.target.value)
          }}
        />
        <TextArea
          label="Grund"
          value={reason}
          hint="Wenn der Kunde einen nennt, etwa der Preis, der Zeitpunkt oder ein anderer Betrieb. Darf leer bleiben."
          problem={problems['reason']}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
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
            {working ? 'Wird gespeichert' : 'Als abgelehnt markieren'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
