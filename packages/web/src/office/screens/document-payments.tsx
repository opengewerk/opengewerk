import type { DeductionContent, DocumentKind, IsoDate } from '@opengewerk/domain'
import { paymentProblem } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field, Panel } from '../../components/index.js'
import { centsAsInput, date, euros, parseEuros, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import { paymentsOf, recordPayment, removePayment } from '../../session/documents.js'
import { useRelated } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'
import { Fact, Facts } from '../layout.js'
import { StepText } from './document-frame.js'

/** What went wrong with a call about payments, in a sentence somebody can act on. */
function reasonOf(error: unknown): string {
  return error instanceof RequestRefused
    ? error.message
    : 'Keine Verbindung. Zahlungseingänge werden mit Verbindung erfasst, sie stehen auf dem Server.'
}

/**
 * What came in on an issued invoice (#189), recorded by hand in the office
 * until the bank is matched in phase 3.
 *
 * What it is for today is the final invoice: it takes off what came in on each
 * progress invoice before it, section 14 (5) UStG, and not what they billed.
 * A payment is never changed. A wrong one is removed and recorded again, and
 * the audit log keeps both steps.
 *
 * Without a connection the card says so instead of showing nothing received:
 * the payments are on the server, and "nothing" would be a guess.
 */
export function PaymentsCard({
  documentId,
  kind,
}: {
  readonly documentId: string
  readonly kind: DocumentKind
}) {
  const mayRead = useMay('payment.read')
  const mayWrite = useMay('payment.write')
  const queries = useQueryClient()
  const answer = useQuery({
    queryKey: ['payments', documentId],
    queryFn: () => paymentsOf(documentId),
    enabled: mayRead,
  })
  const [amount, setAmount] = useState('')
  const [receivedOn, setReceivedOn] = useState<string>(today())
  const [problem, setProblem] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  function changed() {
    void queries.invalidateQueries({ queryKey: ['payments', documentId] })
    // A final invoice further down the chain shows what it will take off.
    void queries.invalidateQueries({ queryKey: ['deductions'] })
  }

  const record = useMutation({
    mutationFn: (payment: { readonly amountCents: number; readonly receivedOn: IsoDate }) =>
      recordPayment(documentId, payment),
    onSuccess: () => {
      setAmount('')
      setTrouble(null)
      changed()
    },
    onError: (error) => {
      setTrouble(reasonOf(error))
    },
  })
  const remove = useMutation({
    mutationFn: (paymentId: string) => removePayment(documentId, paymentId),
    onSuccess: () => {
      setTrouble(null)
      changed()
    },
    onError: (error) => {
      setTrouble(reasonOf(error))
    },
  })

  if (!mayRead || answer.isPending) {
    return null
  }

  // An answer this screen does not understand is no answer either.
  if (!answer.data || !Array.isArray(answer.data.payments)) {
    return (
      <Panel title="Zahlungseingänge">
        <p className="text-[13px] leading-[1.45] text-ink-muted">
          Die Zahlungseingänge stehen auf dem Server und lassen sich ohne Verbindung nicht anzeigen.
        </p>
      </Panel>
    )
  }

  const { payments, billedCents, receivedCents } = answer.data
  const open = Math.max(billedCents - receivedCents, 0)

  function submit(event: FormEvent) {
    event.preventDefault()

    const amountCents = parseEuros(amount)
    const found =
      paymentProblem({ amountCents, receivedOn }, today() as IsoDate) ??
      (amountCents !== null && amountCents > open
        ? `So viel fordert die Rechnung nicht. Offen ist noch ${euros(open)}.`
        : null)

    setProblem(found)

    if (found === null && amountCents !== null) {
      record.mutate({ amountCents, receivedOn: receivedOn as IsoDate })
    }
  }

  return (
    <Panel title="Zahlungseingänge">
      <div className="flex flex-col gap-2.5">
        {kind === 'progress_invoice' ? (
          <p className="text-[13px] leading-[1.45] text-ink">
            Die Schlussrechnung zieht ab, was hier bis zu ihrem Festschreiben eingegangen ist, und
            nicht, was diese Abschlagsrechnung gestellt hat.
          </p>
        ) : null}
        <Facts>
          <Fact label="Gefordert">{euros(billedCents)}</Fact>
          <Fact label="Eingegangen">{euros(receivedCents)}</Fact>
          <Fact label="Offen">
            {open > 0 ? <span className="font-bold text-waiting">{euros(open)}</span> : euros(open)}
          </Fact>
        </Facts>
        {payments.length > 0 ? (
          <ul className="text-[13px] text-ink">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center gap-2.5 border-b border-row py-1.5 first:border-t"
              >
                <span className="numeric grow">
                  {`${date(payment.receivedOn)}: ${euros(payment.amountCents)}`}
                </span>
                {mayWrite ? (
                  <Button
                    size="small"
                    disabled={remove.isPending}
                    aria-label={`Eingang vom ${date(payment.receivedOn)} über ${euros(payment.amountCents)} entfernen`}
                    onClick={() => {
                      remove.mutate(payment.id)
                    }}
                  >
                    Entfernen
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] leading-[1.45] text-ink-muted">
            Auf diese Rechnung ist nichts eingegangen.
          </p>
        )}
        {mayWrite && open > 0 ? (
          <form className="flex flex-col gap-2.5" onSubmit={submit} noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Betrag in Euro"
                numeric
                inputMode="decimal"
                placeholder={centsAsInput(open)}
                value={amount}
                {...(problem === null ? {} : { problem })}
                onChange={(event) => {
                  setAmount(event.target.value)
                  setProblem(null)
                }}
              />
              <Field
                label="Eingegangen am"
                type="date"
                max={today()}
                value={receivedOn}
                onChange={(event) => {
                  setReceivedOn(event.target.value)
                  setProblem(null)
                }}
              />
            </div>
            <Button type="submit" tone="primary" icon={Plus} wide disabled={record.isPending}>
              {record.isPending ? 'Einen Moment' : 'Eingang erfassen'}
            </Button>
          </form>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * What a progress invoice is confirmed with before the final invoice goes
 * out: its number and what came in on it, as one key. A payment recorded
 * after the box was ticked changes the key, and the box is empty again.
 */
export function confirmationKey(deduction: DeductionContent): string {
  return `${deduction.number}:${String(deduction.received?.grossCents ?? 0)}`
}

/** What came in on a progress invoice, in the words of the PDF. */
function cameIn(deduction: DeductionContent): string {
  const billed = `gestellt ${euros(deduction.billed.grossCents)}`
  const received = deduction.received?.grossCents ?? 0
  const until = deduction.receivedOn === null ? '' : ` bis ${date(deduction.receivedOn)}`

  if (received === 0) {
    return `${billed}, nichts eingegangen`
  }

  return received === deduction.billed.grossCents
    ? `${billed}, voll eingegangen${until}`
    : `${billed}, eingegangen ${euros(received)}${until}`
}

/**
 * The part of issuing a final invoice that is only there for one (#189): for
 * each progress invoice it takes off, what came in on it, and a box to say
 * that this is right. The final invoice takes off exactly that, so a payment
 * nobody recorded would be asked for again; ticking the boxes is where
 * somebody looks.
 */
export function PaymentConfirmation({
  deductions,
  confirmed,
  onChange,
}: {
  readonly deductions: readonly DeductionContent[]
  readonly confirmed: ReadonlySet<string>
  readonly onChange: (key: string, checked: boolean) => void
}) {
  return (
    <>
      <StepText muted>
        Die Schlussrechnung zieht je Abschlagsrechnung ab, was darauf eingegangen ist, und nicht,
        was sie gestellt hat (§ 14 Abs. 5 UStG). Bitte je Abschlagsrechnung bestätigen, dass der
        erfasste Eingang stimmt. Fehlt einer, zuerst an der Abschlagsrechnung erfassen.
      </StepText>
      <ul className="flex flex-col gap-1.5">
        {deductions.map((deduction) => (
          <ConfirmedDeduction
            key={deduction.number}
            deduction={deduction}
            checked={confirmed.has(confirmationKey(deduction))}
            onChange={(checked) => {
              onChange(confirmationKey(deduction), checked)
            }}
          />
        ))}
      </ul>
    </>
  )
}

function ConfirmedDeduction({
  deduction,
  checked,
  onChange,
}: {
  readonly deduction: DeductionContent
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  // The progress invoice is on this device like every document; the link
  // leads to where its payments are recorded.
  const [invoice] = useRelated('documents', 'number', deduction.number)

  return (
    <li className="flex flex-col gap-1.5">
      <label className="flex items-start gap-[9px] text-[14px] leading-[1.4]">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-copper-solid max-lg:size-5"
          checked={checked}
          onChange={(event) => {
            onChange(event.target.checked)
          }}
        />
        <span>
          {`Abschlagsrechnung ${deduction.number} vom ${date(deduction.documentDate)}: ${cameIn(deduction)}`}
        </span>
      </label>
      {invoice ? (
        <p className="ml-[25px] text-[13px] max-lg:ml-[29px]">
          <Link
            to={`/belege/${String(invoice['id'])}`}
            className="text-copper-text underline underline-offset-2"
          >
            {`Eingänge an der Abschlagsrechnung ${deduction.number}`}
          </Link>
        </p>
      ) : null}
    </li>
  )
}
