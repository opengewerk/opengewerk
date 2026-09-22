import { type IsoDate, type RuleSet, shippedRules } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, TextArea } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'

/** The setting this screen is about, the claim of section 27 (38) number 2 UStG. */
const claimKey = 'e_invoice.transition_claimed'

/**
 * A transition the business has to claim for itself: the period of the work it
 * covers and the limit of the turnover of the year before.
 */
export interface ClaimableTransition {
  readonly from: IsoDate
  readonly until: IsoDate
  readonly limitCents: number
  readonly source: string
}

/**
 * The transitions that hang on a turnover the business states, out of the rule
 * package and not out of this file. The year, the limit and the paragraph on
 * the screen are the ones the engine judges by; should the law move the date,
 * a new record moves the screen with it.
 */
export function claimableTransitions(rules: RuleSet): readonly ClaimableTransition[] {
  return rules
    .all()
    .filter((record) => record.key === 'e_invoice.transition_turnover_limit')
    .flatMap((record) =>
      record.validUntil === null
        ? []
        : [
            {
              from: record.validFrom,
              until: record.validUntil,
              limitCents: record.value,
              source: record.source,
            },
          ],
    )
}

/** "800.000 Euro". A limit in the law is a round figure, so the cents stay out. */
function wholeEuros(cents: number): string {
  return `${new Intl.NumberFormat('de-DE').format(Math.trunc(cents / 100))} Euro`
}

/** One day on, on the ISO scale and without a time zone in sight. */
function dayAfter(on: IsoDate): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + 1)

  return at.toISOString().slice(0, 10) as IsoDate
}

/**
 * The day a new period of the claim begins.
 *
 * The first one begins with the transition, even when it is stated later: the
 * turnover of the year before is a fact for the whole year, and an invoice for
 * work of January that is still a draft in March should be judged by it. A
 * later one begins today, or with the transition if that is still ahead, and
 * never on or before the start of the last period. The server refuses that,
 * because a period slipped in behind another one would rewrite how the
 * invoices of those days were judged.
 */
export function nextStart(
  periods: readonly Pick<ParameterPeriod, 'validFrom'>[],
  transition: Pick<ClaimableTransition, 'from'>,
  now: IsoDate,
): IsoDate {
  const latest = periods.reduce<IsoDate | null>(
    (last, period) => (last === null || period.validFrom > last ? period.validFrom : last),
    null,
  )

  if (latest === null) {
    return transition.from
  }

  const wanted = now > transition.from ? now : transition.from

  return wanted > latest ? wanted : dayAfter(latest)
}

/** The period that applied on a day, if any. */
function periodOn(periods: readonly ParameterPeriod[], on: IsoDate): ParameterPeriod | null {
  return (
    periods.find(
      (period) => period.validFrom <= on && (period.validUntil === null || period.validUntil >= on),
    ) ?? null
  )
}

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * What the business states about its own taxation, because OpenGewerk cannot
 * know it from the documents.
 *
 * So far one statement: the transition of 2027 for the e-invoice, which hangs
 * on the turnover of 2026. The engine reads it on every invoice to a business
 * for work of that year, and without it the e-invoice is required, which is
 * the reading that is never wrong. Only the owner states it; the office sees
 * the same screen with nothing to press, like the letterhead.
 */
export function TaxScreen() {
  const history = useQuery({ queryKey: ['parameters'], queryFn: parameterHistory })
  const mayWrite = useMay('settings.write')

  return (
    <Page title="Steuern" meta="Was der Betrieb über seine eigene Besteuerung erklärt.">
      <p className="text-body text-ink-muted">
        Hier steht, was OpenGewerk nicht aus den Belegen wissen kann und der Betrieb deshalb selbst
        erklärt. Jede Erklärung gilt ab einem Tag. Was davor galt, bleibt für die Belege aus dieser
        Zeit stehen.
      </p>

      {history.isPending ? (
        <Nothing>Wird geladen.</Nothing>
      ) : history.isError ? (
        <Nothing>{saidWhy(history.error, 'Die Erklärungen kamen nicht an.')}</Nothing>
      ) : (
        <>
          {mayWrite ? null : (
            <p className="text-body font-semibold">Erklären kann das nur der Inhaber.</p>
          )}
          {claimableTransitions(shippedRules).map((transition) => (
            <TransitionSection
              key={transition.from}
              transition={transition}
              periods={history.data.filter((period) => period.key === claimKey)}
              mayWrite={mayWrite}
            />
          ))}
        </>
      )}
    </Page>
  )
}

function TransitionSection({
  transition,
  periods,
  mayWrite,
}: {
  readonly transition: ClaimableTransition
  readonly periods: readonly ParameterPeriod[]
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const now = today() as IsoDate
  const year = transition.from.slice(0, 4)
  const yearBefore = String(Number(year) - 1)
  const over = now > transition.until
  // What the business states from now on is the latest period, since every
  // new one begins today or later. Not the one on the first day of the
  // transition: a statement taken back before the year began still covers
  // that first day, and the screen would keep calling it stated. After the
  // transition, what counts is how it ended.
  const latest =
    [...periods].sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0] ?? null
  const standing = over ? periodOn(periods, transition.until) : latest
  const claimed = standing?.value === 1
  const start = nextStart(periods, transition, now)

  const change = useMutation({
    mutationFn: () =>
      setParameter({
        key: claimKey,
        from: start,
        value: claimed ? 0 : 1,
        note: claimed || note.trim() === '' ? null : note.trim(),
      }),
    onSuccess: () => {
      setTrouble(null)
      setNote('')
      setSaved(true)
      void queries.invalidateQueries({ queryKey: ['parameters'] })
    },
    onError: (error) => {
      setSaved(false)
      setTrouble(saidWhy(error, 'Die Erklärung ließ sich nicht speichern.'))
    },
  })

  return (
    <Section title={`E-Rechnung für Leistungen aus ${year}`}>
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink">
          Für eine Leistung aus {year} darf eine Rechnung an ein Unternehmen im Inland noch auf
          Papier oder, wenn der Kunde zustimmt, als PDF gehen. Dafür muss sie bis zum{' '}
          {date(transition.until)} übermittelt werden, und der Gesamtumsatz des Betriebs darf{' '}
          {yearBefore} nicht über {wholeEuros(transition.limitCents)} gelegen haben (
          {transition.source}). Den Umsatz kennt OpenGewerk nicht, deshalb erklärt ihn der Betrieb
          hier.
        </p>
        <p className="text-body text-ink">
          Ohne Erklärung gilt die Pflicht: eine Rechnung an ein Unternehmen, der für die E-Rechnung
          eine Angabe fehlt, wird nicht festgeschrieben. Mit Erklärung wird sie trotzdem
          festgeschrieben und geht auf Papier oder, wenn der Kunde zustimmt, als PDF hinaus. Fehlt
          nichts, bekommt der Kunde die E-Rechnung so oder so.
        </p>

        <p className="text-body font-semibold">
          {over
            ? `Der Übergang endete am ${date(transition.until)}. ${
                claimed ? 'Zuletzt war er erklärt.' : 'Zuletzt war er nicht erklärt.'
              }`
            : standing === null
              ? `Nicht erklärt: für Leistungen aus ${year} gilt die Pflicht zur E-Rechnung.`
              : claimed
                ? `Erklärt ab dem ${date(standing.validFrom)}: der Gesamtumsatz ${yearBefore} lag ` +
                  `nicht über ${wholeEuros(transition.limitCents)}.`
                : `Zurückgenommen ab dem ${date(standing.validFrom)}: für Leistungen ab diesem ` +
                  'Tag gilt die Pflicht zur E-Rechnung.'}
        </p>

        {periods.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-body font-semibold text-ink">Verlauf</p>
            <ul className="list-disc pl-6 text-body text-ink">
              {[...periods]
                .sort((left, right) => left.validFrom.localeCompare(right.validFrom))
                .map((period) => (
                  <li key={period.id}>
                    Ab {date(period.validFrom)}: {period.value === 1 ? 'erklärt' : 'nicht erklärt'}
                    {period.note ? `. Grundlage: ${period.note}` : ''}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        {mayWrite && !over ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              change.mutate()
            }}
          >
            {claimed ? null : (
              <TextArea
                label="Grundlage der Erklärung"
                hint={`Freiwillig, etwa der Gesamtumsatz ${yearBefore} laut Buchhaltung. Steht mit im Verlauf.`}
                rows={2}
                value={note}
                onChange={(event) => {
                  setSaved(false)
                  setNote(event.target.value)
                }}
              />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                tone={claimed ? 'secondary' : 'primary'}
                disabled={change.isPending}
              >
                {change.isPending
                  ? 'Einen Moment'
                  : claimed
                    ? 'Erklärung zurücknehmen'
                    : 'Übergang erklären'}
              </Button>
              <p className="text-body text-ink-muted">
                {claimed
                  ? `Für Leistungen ab dem ${date(start)} gilt dann wieder die Pflicht.`
                  : `Die Erklärung gilt für Leistungen ab dem ${date(start)}.`}
              </p>
            </div>
            {saved ? (
              <p role="status" className="text-body text-ink-muted">
                Gespeichert.
              </p>
            ) : null}
          </form>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Section>
  )
}
