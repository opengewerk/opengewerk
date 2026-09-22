import {
  type IsoDate,
  type RuleSet,
  shippedRules,
  type TenantParameterKey,
} from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { Button, Field, TextArea } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'

/** The claim of section 27 (38) number 2 UStG, the transition of 2027. */
const transitionKey = 'e_invoice.transition_claimed'

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

/** A limit of the law as it stands on a day, with the paragraph it comes from. */
export interface Limit {
  readonly cents: number
  readonly source: string
}

/** A limit out of the rule packages on a day, or nothing if none was in force. */
export function limitOn(rules: RuleSet, key: string, on: IsoDate): Limit | null {
  const record = rules.at(key, on)

  return record ? { cents: record.value, source: record.source } : null
}

/**
 * The first day an invoice has to say that the business calculates its tax on
 * the amounts received, out of the rule package `invoice`. The screen names
 * the day the engine goes by, not one written into this file.
 */
export function cashAccountingStatementFrom(rules: RuleSet): IsoDate | null {
  const starts = rules
    .all()
    .filter((record) => record.key === 'invoice.cash_accounting_statement' && record.value === 1)
    .map((record) => record.validFrom)
    .sort()

  return starts[0] ?? null
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

/** The first day of the year a day falls in. */
function yearStart(on: IsoDate): IsoDate {
  return `${on.slice(0, 4)}-01-01` as IsoDate
}

/** The day the newest period of a setting began, or nothing if it was never set. */
function latestStart(periods: readonly Pick<ParameterPeriod, 'validFrom'>[]): IsoDate | null {
  return periods.reduce<IsoDate | null>(
    (last, period) => (last === null || period.validFrom > last ? period.validFrom : last),
    null,
  )
}

/**
 * The newest period, which says what the business states from now on: every
 * new period begins after it. Not the one covering today, which a statement
 * made for a day still ahead would leave saying the opposite.
 */
function latestPeriod(periods: readonly ParameterPeriod[]): ParameterPeriod | null {
  return (
    [...periods].sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0] ?? null
  )
}

/**
 * The earliest day a new period may begin: the day after the newest one did.
 * The server refuses anything earlier, because a period slipped in behind
 * another one would rewrite how the documents of those days were judged.
 */
export function earliestFrom(
  periods: readonly Pick<ParameterPeriod, 'validFrom'>[],
): IsoDate | null {
  const latest = latestStart(periods)

  return latest === null ? null : dayAfter(latest)
}

/**
 * The day a form proposes for a new period: the one wanted, or the first the
 * server takes if the wanted one lies too early.
 */
export function proposedFrom(
  periods: readonly Pick<ParameterPeriod, 'validFrom'>[],
  wanted: IsoDate,
): IsoDate {
  const earliest = earliestFrom(periods)

  return earliest === null || wanted >= earliest ? wanted : earliest
}

/**
 * The day a new period of the transition statement begins.
 *
 * The first one begins with the transition, even when it is stated later: the
 * turnover of the year before is a fact for the whole year, and an invoice for
 * work of January that is still a draft in March should be judged by it. A
 * later one begins today, or with the transition if that is still ahead, and
 * never on or before the start of the last period.
 */
export function nextStart(
  periods: readonly Pick<ParameterPeriod, 'validFrom'>[],
  transition: Pick<ClaimableTransition, 'from'>,
  now: IsoDate,
): IsoDate {
  if (latestStart(periods) === null) {
    return transition.from
  }

  return proposedFrom(periods, now > transition.from ? now : transition.from)
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

const isoDay = /^\d{4}-\d{2}-\d{2}$/

/**
 * What the business states about its own taxation, because OpenGewerk cannot
 * know it from the documents.
 *
 * Three statements. Whether it uses the small business rule, which decides
 * whether a document is proposed with VAT at all. Whether the tax office
 * permitted it to calculate its VAT on what it receives, which an invoice has
 * to name from 2028 and the bookkeeping of phase 3 needs for the day the tax
 * arises. And the transition of 2027 for the e-invoice, which hangs on the
 * turnover of 2026.
 *
 * Only the owner states them; the office sees the same screen with nothing to
 * press, like the letterhead. Each one is a setting with periods, so a
 * statement begins on a day and what applied before it stays with the
 * documents of that time.
 */
export function TaxScreen() {
  const history = useQuery({ queryKey: ['parameters'], queryFn: parameterHistory })
  const mayWrite = useMay('settings.write')

  const of = (key: TenantParameterKey): readonly ParameterPeriod[] =>
    history.data?.filter((period) => period.key === key) ?? []

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
          <SmallBusinessSection periods={of('small_business.claimed')} mayWrite={mayWrite} />
          <CashAccountingSection periods={of('cash_accounting.permitted')} mayWrite={mayWrite} />
          {claimableTransitions(shippedRules).map((transition) => (
            <TransitionSection
              key={transition.from}
              transition={transition}
              periods={of(transitionKey)}
              mayWrite={mayWrite}
            />
          ))}
        </>
      )}
    </Page>
  )
}

/** Every period of one statement, oldest first, with what it rested on. */
function History({
  periods,
  stated,
  notStated,
}: {
  readonly periods: readonly ParameterPeriod[]
  /** What a period with the value one is called in the list. */
  readonly stated: string
  readonly notStated: string
}) {
  if (periods.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-semibold text-ink">Verlauf</p>
      <ul className="list-disc pl-6 text-body text-ink">
        {[...periods]
          .sort((left, right) => left.validFrom.localeCompare(right.validFrom))
          .map((period) => (
            <li key={period.id}>
              Ab {date(period.validFrom)}: {period.value === 1 ? stated : notStated}
              {period.note ? `. Grundlage: ${period.note}` : ''}
            </li>
          ))}
      </ul>
    </div>
  )
}

/**
 * Stating something from a day the business picks, or taking it back.
 *
 * The day is the business's to pick, unlike for the transition: a permission
 * of the tax office begins on the day its letter names, and the small business
 * rule ends on the day the turnover passes its limit. The form proposes a day
 * and holds the one the server would refuse before sending it.
 */
function PeriodForm({
  setting,
  periods,
  stated,
  proposed,
  dateLabel,
  dateHint,
  noteLabel,
  noteHint,
  button,
}: {
  readonly setting: TenantParameterKey
  readonly periods: readonly ParameterPeriod[]
  /** Whether the newest period states it, so that sending takes it back. */
  readonly stated: boolean
  readonly proposed: IsoDate
  readonly dateLabel: string
  readonly dateHint: ReactNode
  /** Asked only when something is stated. Taking it back rests on nothing. */
  readonly noteLabel: string
  readonly noteHint: string
  readonly button: string
}) {
  const queries = useQueryClient()
  // Empty until somebody picks a day, so that the proposal follows the
  // periods: after a statement is saved, the next proposal is a different day.
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const from = picked ?? proposed
  const earliest = earliestFrom(periods)
  const problem = !isoDay.test(from)
    ? 'Bitte einen Tag wählen.'
    : earliest !== null && from < earliest
      ? `Frühestens ab dem ${date(earliest)}, davor gilt, was zuletzt erklärt wurde.`
      : null

  const change = useMutation({
    mutationFn: () =>
      setParameter({
        key: setting,
        from: from as IsoDate,
        value: stated ? 0 : 1,
        note: stated || note.trim() === '' ? null : note.trim(),
      }),
    onSuccess: () => {
      setTrouble(null)
      setNote('')
      setPicked(null)
      setSaved(true)
      void queries.invalidateQueries({ queryKey: ['parameters'] })
    },
    onError: (error) => {
      setSaved(false)
      setTrouble(saidWhy(error, 'Die Erklärung ließ sich nicht speichern.'))
    },
  })

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()

        if (problem === null) {
          change.mutate()
        }
      }}
    >
      <Field
        label={dateLabel}
        type="date"
        value={from}
        min={earliest ?? undefined}
        hint={dateHint}
        problem={problem ?? undefined}
        onChange={(event) => {
          setSaved(false)
          setPicked(event.target.value)
        }}
      />
      {stated ? null : (
        <TextArea
          label={noteLabel}
          hint={noteHint}
          rows={2}
          value={note}
          onChange={(event) => {
            setSaved(false)
            setNote(event.target.value)
          }}
        />
      )}
      <div>
        <Button
          type="submit"
          tone={stated ? 'secondary' : 'primary'}
          disabled={change.isPending || problem !== null}
        >
          {change.isPending ? 'Einen Moment' : button}
        </Button>
      </div>
      {saved ? (
        <p role="status" className="text-body text-ink-muted">
          Gespeichert.
        </p>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </form>
  )
}

/**
 * The small business rule of section 19 UStG.
 *
 * What it changes is the proposal: a document the business creates on a day
 * the rule is stated comes with the small business treatment, no VAT and the
 * note on the exemption, and an invoice of that kind need not be an
 * e-invoice. The proposal can still be changed on the draft, and nothing
 * already issued changes with it.
 */
function SmallBusinessSection({
  periods,
  mayWrite,
}: {
  readonly periods: readonly ParameterPeriod[]
  readonly mayWrite: boolean
}) {
  const now = today() as IsoDate
  const previous = limitOn(shippedRules, 'small_business.previous_year_limit', now)
  const current = limitOn(shippedRules, 'small_business.current_year_limit', now)
  const yearBefore = String(Number(now.slice(0, 4)) - 1)
  const standing = latestPeriod(periods)
  const stated = standing?.value === 1

  return (
    <Section title="Kleinunternehmerregelung">
      <div className="flex flex-col gap-3">
        {previous && current ? (
          <p className="text-body text-ink">
            Die Umsätze eines Kleinunternehmers sind steuerfrei, wenn sein Gesamtumsatz im
            vergangenen Jahr nicht über {wholeEuros(previous.cents)} lag und im laufenden Jahr{' '}
            {wholeEuros(current.cents)} nicht überschreitet ({previous.source}). Den Umsatz kennt
            OpenGewerk nicht, deshalb erklärt der Betrieb hier, ob er die Regelung nutzt.
          </p>
        ) : null}
        <p className="text-body text-ink">
          Mit der Erklärung schlägt OpenGewerk neue Belege ohne Umsatzsteuer vor, mit dem Hinweis
          auf die Steuerbefreiung, und eine Rechnung muss keine E-Rechnung sein. Am Entwurf lässt
          sich das ändern, und was schon festgeschrieben ist, bleibt, wie es ist.
        </p>

        <p className="text-body font-semibold">
          {standing === null
            ? 'Nicht erklärt: neue Belege werden mit Umsatzsteuer vorgeschlagen.'
            : stated
              ? `Erklärt ab dem ${date(standing.validFrom)}: neue Belege werden ohne ` +
                'Umsatzsteuer vorgeschlagen.'
              : `Beendet ab dem ${date(standing.validFrom)}: Belege von diesem Tag an werden ` +
                'mit Umsatzsteuer vorgeschlagen.'}
        </p>

        <History periods={periods} stated="Kleinunternehmerregelung" notStated="Regelbesteuerung" />

        {mayWrite ? (
          <PeriodForm
            setting="small_business.claimed"
            periods={periods}
            stated={stated}
            proposed={proposedFrom(periods, stated ? now : yearStart(now))}
            dateLabel={stated ? 'Regelbesteuerung ab' : 'Kleinunternehmerregelung ab'}
            dateHint={
              stated
                ? `Überschreitet der Gesamtumsatz im laufenden Jahr ${
                    current ? wholeEuros(current.cents) : 'die Grenze'
                  }, gilt die Regelung schon in diesem Jahr nicht mehr. Ein Verzicht, den der ` +
                  'Betrieb dem Finanzamt erklärt, gilt ab Beginn des Kalenderjahres und bindet ' +
                  'mindestens fünf Jahre (§ 19 Abs. 3 UStG).'
                : 'Die Regelung hängt am Umsatz eines Kalenderjahres und beginnt deshalb in der ' +
                  'Regel am 1. Januar.'
            }
            noteLabel="Grundlage zur Kleinunternehmerregelung"
            noteHint={`Freiwillig, etwa der Gesamtumsatz ${yearBefore} laut Buchhaltung. Steht mit im Verlauf.`}
            button={
              stated ? 'Kleinunternehmerregelung beenden' : 'Kleinunternehmerregelung erklären'
            }
          />
        ) : null}
      </div>
    </Section>
  )
}

/**
 * Cash accounting, section 20 UStG: the tax office permitted the business to
 * calculate its VAT on what it receives instead of on what it agreed.
 *
 * What it changes today is one statement on the invoice, from the day the rule
 * package names. The difference that matters more, the period in which the
 * tax is owed, belongs to the advance return of the bookkeeping, which reads
 * the same setting once it exists.
 */
function CashAccountingSection({
  periods,
  mayWrite,
}: {
  readonly periods: readonly ParameterPeriod[]
  readonly mayWrite: boolean
}) {
  const now = today() as IsoDate
  const limit = limitOn(shippedRules, 'cash_accounting.previous_year_limit', now)
  const statementFrom = cashAccountingStatementFrom(shippedRules)
  const standing = latestPeriod(periods)
  const stated = standing?.value === 1

  return (
    <Section title="Ist-Versteuerung">
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink">
          Üblich ist die Soll-Versteuerung: die Umsatzsteuer gehört in die Voranmeldung für den
          Zeitraum, in dem die Leistung ausgeführt wurde, auch wenn der Kunde noch nicht gezahlt
          hat. Bei der Ist-Versteuerung zählt der Zeitraum, in dem das Geld eingeht.
          {limit
            ? ` Das Finanzamt gestattet sie auf Antrag, bei einem Handwerksbetrieb meist, weil der ` +
              `Gesamtumsatz im vergangenen Jahr nicht über ${wholeEuros(limit.cents)} lag ` +
              `(${limit.source}).`
            : ' Das Finanzamt gestattet sie auf Antrag (§ 20 UStG).'}{' '}
          Ob es das getan hat, weiß OpenGewerk nicht, deshalb erklärt der Betrieb es hier.
        </p>
        {statementFrom ? (
          <p className="text-body text-ink">
            Mit der Erklärung trägt jede Rechnung mit ausgewiesener Umsatzsteuer ab dem{' '}
            {date(statementFrom)} die Angabe „Versteuerung nach vereinnahmten Entgelten“, die das
            Gesetz von da an verlangt (§ 14 Abs. 4 Satz 1 Nr. 6a UStG). Die Voranmeldung selbst, für
            die der Unterschied eigentlich zählt, kommt mit der Buchhaltung und liest dieselbe
            Erklärung.
          </p>
        ) : null}

        <p className="text-body font-semibold">
          {standing === null
            ? 'Nicht erklärt: der Betrieb versteuert nach vereinbarten Entgelten ' +
              '(Soll-Versteuerung).'
            : stated
              ? `Erklärt ab dem ${date(standing.validFrom)}: das Finanzamt hat die ` +
                'Ist-Versteuerung gestattet.'
              : `Soll-Versteuerung ab dem ${date(standing.validFrom)}.`}
        </p>

        <History periods={periods} stated="Ist-Versteuerung" notStated="Soll-Versteuerung" />

        {mayWrite ? (
          <PeriodForm
            setting="cash_accounting.permitted"
            periods={periods}
            stated={stated}
            proposed={proposedFrom(periods, stated ? now : yearStart(now))}
            dateLabel={stated ? 'Soll-Versteuerung ab' : 'Ist-Versteuerung ab'}
            dateHint={
              stated
                ? `${
                    limit
                      ? `Lag der Gesamtumsatz im vergangenen Jahr über ${wholeEuros(limit.cents)}, ` +
                        'ist die Voraussetzung nach § 20 Satz 1 Nr. 1 UStG in diesem Jahr nicht ' +
                        'mehr erfüllt. '
                      : ''
                  }Beim Wechsel dürfen Umsätze weder doppelt erfasst werden noch unversteuert ` +
                  'bleiben (§ 20 Satz 3 UStG).'
                : 'Der Tag, ab dem das Finanzamt sie gestattet hat.'
            }
            noteLabel="Grundlage zur Ist-Versteuerung"
            noteHint="Freiwillig, etwa das Schreiben des Finanzamts mit seinem Datum. Steht mit im Verlauf."
            button={stated ? 'Zur Soll-Versteuerung wechseln' : 'Ist-Versteuerung erklären'}
          />
        ) : null}
      </div>
    </Section>
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
  // What the business states from now on is the latest period. Not the one on
  // the first day of the transition: a statement taken back before the year
  // began still covers that first day, and the screen would keep calling it
  // stated. After the transition, what counts is how it ended.
  const standing = over ? periodOn(periods, transition.until) : latestPeriod(periods)
  const claimed = standing?.value === 1
  const start = nextStart(periods, transition, now)

  const change = useMutation({
    mutationFn: () =>
      setParameter({
        key: transitionKey,
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

        <History periods={periods} stated="erklärt" notStated="nicht erklärt" />

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
