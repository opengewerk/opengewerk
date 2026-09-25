import type { DeductionContent, DocumentKind, MissingDetail } from '@opengewerk/domain'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Ban, Lock, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/index.js'
import { documentKindLabel } from '../../app/labels.js'
import {
  cancelDocument,
  issueDocument,
  makeSuccessor,
  missingFrom,
  unconfirmedFrom,
} from '../../session/documents.js'
import { useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'
import { NoteBox } from '../kit.js'
import { StepPanel, StepText } from './document-frame.js'
import { confirmationKey, PaymentConfirmation } from './document-payments.js'

/** What went wrong with a call to the server, in a sentence somebody can act on. */
export function reasonOf(error: unknown, offline: string): string {
  return error instanceof RequestRefused ? error.message : offline
}

/**
 * The second step of issuing, the board "Festschreiben einer Schlussrechnung".
 * Two steps because the first cannot be undone: the number is handed out, and
 * the document is what it is from then on.
 *
 * A final invoice that takes off progress invoices asks one more thing on the
 * way (#189): for each of them, whether what came in is right. The server
 * issues it only with that answer, and names the progress invoices whose
 * payments changed in the meantime; their boxes are empty again then, and the
 * list shows what the payments add up to now.
 *
 * A signed report is issued here on the way to its invoice too, when the head
 * asked for "Rechnung erstellen": a successor is made out of an issued
 * document only, so the report gets its number first and the invoice after.
 */
export function IssuePanel({
  documentId,
  deductions,
  then,
  onDone,
}: {
  readonly documentId: string
  /** The progress invoices a final invoice takes off, and nothing for any other document. */
  readonly deductions: readonly DeductionContent[]
  /** What to make out of the document once it is issued, and open. */
  readonly then?: DocumentKind
  /** Closes the panel; with a sentence when the document was issued and what follows failed. */
  readonly onDone: (trouble?: string) => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [missing, setMissing] = useState<readonly MissingDetail[]>([])
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set())

  const unconfirmed = deductions.filter((deduction) => !confirmed.has(confirmationKey(deduction)))

  async function issue() {
    let issued = false

    setWorking(true)
    setTrouble(null)
    setMissing([])

    try {
      // What this device changed has to be on the server first. The number is
      // given to what the server holds, and a line still waiting in the outbox
      // would be missing from the document that goes out.
      await client.synchronise()

      if (client.status().pending > 0) {
        setTrouble(
          'Auf diesem Gerät warten noch Änderungen, die der Server nicht hat. Festgeschrieben ' +
            'wird, sobald sie angekommen sind.',
        )

        return
      }

      await issueDocument(
        documentId,
        deductions.length === 0
          ? undefined
          : Object.fromEntries(
              deductions.map((deduction) => [
                deduction.number,
                deduction.received?.grossCents ?? 0,
              ]),
            ),
      )
      issued = true

      if (then) {
        const created = await makeSuccessor(documentId, then)

        await client.synchronise()
        await navigate({ to: `/belege/${String(created['id'])}` })

        return
      }

      await client.synchronise()
      onDone()
    } catch (error) {
      if (issued && then) {
        // The number is given, the invoice is not made. The panel goes, the
        // document shows itself issued, and its head offers the invoice again.
        await client.synchronise().catch(() => undefined)
        onDone(
          `Festgeschrieben. ${reasonOf(
            error,
            `Keine Verbindung: die ${documentKindLabel[then]} entsteht mit Verbindung.`,
          )}`,
        )

        return
      }

      const lacking = missingFrom(error)
      const changed = unconfirmedFrom(error)

      if (changed.length > 0) {
        setConfirmed(
          (before) =>
            new Set([...before].filter((key) => !changed.some((one) => key.startsWith(`${one}:`)))),
        )
        void queries.invalidateQueries({ queryKey: ['deductions', documentId] })
      }

      setMissing(lacking)
      setTrouble(
        lacking.length > 0
          ? null
          : reasonOf(
              error,
              'Keine Verbindung. Festgeschrieben wird mit Verbindung, weil der Server dabei die ' +
                'Nummer vergibt.',
            ),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <StepPanel
      title="Festschreiben"
      icon={Lock}
      tone="copper"
      actions={
        <>
          <Button
            tone="primary"
            icon={Lock}
            disabled={working || unconfirmed.length > 0}
            onClick={() => void issue()}
          >
            {working
              ? 'Wird festgeschrieben'
              : then
                ? `Festschreiben und ${documentKindLabel[then]} erstellen`
                : 'Jetzt festschreiben'}
          </Button>
          <Button
            disabled={working}
            onClick={() => {
              onDone()
            }}
          >
            Abbrechen
          </Button>
        </>
      }
      after={
        <>
          {missing.length > 0 ? (
            <div role="alert">
              <NoteBox tone="conflict" icon={TriangleAlert}>
                <span className="font-semibold">Es fehlen noch Pflichtangaben:</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {missing.map((entry, index) => (
                    // The detail alone is not unique: every instruction that
                    // lacks something reports as `instruction`, with no line.
                    <li key={`${entry.detail}-${String(entry.position ?? '')}-${String(index)}`}>
                      {entry.message}
                    </li>
                  ))}
                </ul>
              </NoteBox>
            </div>
          ) : null}
          {trouble ? (
            <p role="alert" className="text-body font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
        </>
      }
    >
      <StepText>
        Festschreiben vergibt die nächste Nummer. Danach lässt sich der Beleg nicht mehr ändern;
        soll sich etwas ändern, entsteht dafür ein neuer Beleg.
      </StepText>
      {then ? (
        <StepText muted>
          {`Eine ${documentKindLabel[then]} entsteht aus einem festgeschriebenen Beleg. Nach dem ` +
            `Festschreiben wird sie angelegt und geöffnet.`}
        </StepText>
      ) : null}
      {deductions.length > 0 ? (
        <PaymentConfirmation
          deductions={deductions}
          confirmed={confirmed}
          onChange={(key, checked) => {
            setConfirmed((before) => {
              const next = new Set(before)

              if (checked) {
                next.add(key)
              } else {
                next.delete(key)
              }

              return next
            })
          }}
        />
      ) : null}
    </StepPanel>
  )
}

/**
 * The second step of cancelling, for the reason issuing has one: neither step
 * can be undone. The cancellation gets the next number of the invoices and
 * goes into the books beside the invoice, and the screen moves on to it.
 *
 * Nothing on this device has to reach the server first. The invoice is issued
 * and has nothing left in the outbox, and the cancellation is written out of
 * what the invoice froze, not out of anything held here.
 */
export function CancelPanel({
  documentId,
  onDone,
}: {
  readonly documentId: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function cancel() {
    setWorking(true)
    setTrouble(null)

    try {
      const created = await cancelDocument(documentId)

      await client.synchronise()
      await navigate({ to: `/belege/${String(created['id'])}` })
    } catch (error) {
      setTrouble(
        reasonOf(
          error,
          'Keine Verbindung. Storniert wird mit Verbindung, weil der Server dabei die nächste ' +
            'Rechnungsnummer vergibt.',
        ),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <StepPanel
      title="Stornieren"
      icon={Ban}
      tone="danger"
      actions={
        <>
          <Button tone="danger" disabled={working} onClick={() => void cancel()}>
            {working ? 'Wird storniert' : 'Jetzt stornieren'}
          </Button>
          <Button disabled={working} onClick={onDone}>
            Abbrechen
          </Button>
        </>
      }
      after={
        trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null
      }
    >
      <StepText>
        Stornieren schreibt eine Stornorechnung mit der nächsten Rechnungsnummer. Sie nennt diese
        Rechnung und wiederholt jeden ihrer Beträge mit umgekehrtem Vorzeichen. Die Rechnung bleibt
        in den Büchern und gilt danach als storniert. Zurücknehmen lässt sich das nicht; soll die
        Leistung wieder berechnet werden, entsteht dafür eine neue Rechnung.
      </StepText>
    </StepPanel>
  )
}
