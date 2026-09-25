import {
  defaultPaymentTermDays,
  type IsoDate,
  paymentTermLabel,
  paymentTermProblem,
} from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { Button, Field, Panel } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { RequestRefused } from '../../sync/transport.js'
import {
  Saved,
  SettingsHistory,
  SettingsPage,
  SettingsState,
  SettingsText,
} from '../settings-frame.js'
import { latestPeriod, proposedFrom } from './taxes.js'

/** The setting this screen changes: the payment term of every document without its own. */
export const paymentTermSetting = 'invoice.payment_term_days'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The payment term the business had set on a day, or the default before it
 * set any. The same reading the server does for a document of that date.
 */
export function paymentTermOn(periods: readonly ParameterPeriod[], on: string): number {
  const period = periods.find(
    (candidate) =>
      candidate.key === paymentTermSetting &&
      candidate.validFrom <= on &&
      (candidate.validUntil === null || candidate.validUntil >= on),
  )

  return period?.value ?? defaultPaymentTermDays
}

/**
 * What a days field holds, as a number, or the sentence why it is none. Empty
 * is a problem here; on a document it means the setting applies, and the head
 * of the document asks before it comes this far.
 */
export function daysFrom(input: string): { readonly days: number } | { readonly problem: string } {
  const typed = input.trim()
  const days = typed === '' ? Number.NaN : Number(typed)
  const problem = paymentTermProblem(days)

  return problem === null ? { days } : { problem }
}

/**
 * How many days a customer has to pay, for every document of this business
 * that does not state a term of its own.
 *
 * Set from a day onwards like the other settings, and never for a day in the
 * past: a document reads the term of its own date, so what was written before
 * the change keeps the term it was written under. A quote, an estimate and an
 * order confirmation print the days, an invoice the day payment is due.
 *
 * Only the owner changes it; the office sees it with nothing to press, like
 * the letterhead.
 */
export function PaymentTermScreen() {
  const history = useQuery({ queryKey: ['parameters'], queryFn: parameterHistory })
  const mayWrite = useMay('settings.write')

  return (
    <SettingsPage
      active="zahlungsziel"
      title="Zahlungsziel"
      sub="Wie viel Zeit Kunden zum Bezahlen haben."
    >
      {history.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : history.isError ? (
        <SettingsText muted>
          {saidWhy(history.error, 'Die Einstellungen kamen nicht an.')}
        </SettingsText>
      ) : (
        <PaymentTermSection
          periods={history.data.filter((period) => period.key === paymentTermSetting)}
          mayWrite={mayWrite}
        />
      )}
    </SettingsPage>
  )
}

function PaymentTermSection({
  periods,
  mayWrite,
}: {
  readonly periods: readonly ParameterPeriod[]
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const standing = latestPeriod(periods)
  const current = standing?.value ?? defaultPaymentTermDays
  const [typed, setTyped] = useState(String(current))
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const from = proposedFrom(periods, today() as IsoDate)
  const read = daysFrom(typed)
  const problem = 'problem' in read ? read.problem : null
  const unchanged = 'days' in read && read.days === current

  const save = useMutation({
    mutationFn: (days: number) =>
      setParameter({ key: paymentTermSetting, from, value: days, note: null }),
    onSuccess: () => {
      setTrouble(null)
      setSaved(true)
      void queries.invalidateQueries({ queryKey: ['parameters'] })
    },
    onError: (error) => {
      setSaved(false)
      setTrouble(saidWhy(error, 'Das Zahlungsziel ließ sich nicht speichern.'))
    },
  })

  return (
    <Panel title="Vorgabe für jeden Beleg" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText>
          So viele Tage nach dem Rechnungsdatum hat ein Kunde Zeit zu zahlen. Eine Rechnung nennt
          daraus den Tag, bis zu dem sie bezahlt sein soll; Angebot, Kostenvoranschlag und
          Auftragsbestätigung nennen die Tage. Ein einzelner Beleg kann in seinem Kopf ein eigenes
          Zahlungsziel haben, das dann auch für die Belege gilt, die aus ihm entstehen.
        </SettingsText>

        <SettingsState>
          {standing === null
            ? `${paymentTermLabel(current)}, die Vorgabe von OpenGewerk.`
            : `${paymentTermLabel(current)} seit dem ${date(standing.validFrom)}.`}
        </SettingsState>

        <SettingsHistory
          items={[...periods]
            .sort((left, right) => left.validFrom.localeCompare(right.validFrom))
            .map((period) => `Ab ${date(period.validFrom)}: ${paymentTermLabel(period.value)}`)}
        />

        {mayWrite ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setSaved(false)

              if ('days' in read) {
                save.mutate(read.days)
              }
            }}
          >
            <div>
              <Field
                label="Tage"
                className="sm:max-w-[160px]"
                name="paymentTermDays"
                inputMode="numeric"
                numeric
                required
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value)
                }}
                {...(problem === null ? {} : { problem })}
                hint={
                  `Gilt ab dem ${date(from)} für jeden Beleg dieses Datums oder später, der kein ` +
                  'eigenes Zahlungsziel hat. 0 heißt sofort zahlbar.'
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                tone="primary"
                icon={Check}
                disabled={save.isPending || problem !== null || unchanged}
              >
                {save.isPending ? 'Einen Moment' : 'Speichern'}
              </Button>
              {saved ? (
                <Saved>
                  Gespeichert. Belege, die vorher datiert sind, behalten ihr Zahlungsziel.
                </Saved>
              ) : null}
            </div>
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
