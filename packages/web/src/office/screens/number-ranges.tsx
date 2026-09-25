import { formatDocumentNumber, type NumberRangeKey, patternProblem } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useId, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

import { Button, Cell, Column, Panel, TablePanel, useBand } from '../../components/index.js'
import { useMay } from '../../app/queries.js'
import {
  changeNumberRange,
  numberRanges,
  type NumberRangeView,
} from '../../session/number-ranges.js'
import { RequestRefused } from '../../sync/transport.js'
import { SettingsPage, SettingsText } from '../settings-frame.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** What each sequence numbers, in the words of the office, and what it numbers one of. */
const about: Readonly<
  Record<NumberRangeKey, { readonly title: string; readonly covers: string; readonly next: string }>
> = {
  job: {
    title: 'Aufträge',
    covers:
      'Jeder neue Auftrag bekommt beim Anlegen die nächste Nummer, einer ohne Netz, sobald er ' +
      'übertragen ist.',
    next: 'Auftrag',
  },
  quote: {
    title: 'Angebote',
    covers: 'Angebote und Kostenvoranschläge zählen gemeinsam.',
    next: 'Beleg',
  },
  order_confirmation: {
    title: 'Auftragsbestätigungen',
    covers: '',
    next: 'Beleg',
  },
  delivery_note: { title: 'Lieferscheine', covers: '', next: 'Beleg' },
  report: { title: 'Regieberichte', covers: '', next: 'Beleg' },
  invoice: {
    title: 'Rechnungen',
    covers:
      'Alle Rechnungen, Gutschriften und Stornos zählen gemeinsam und lückenlos, wie § 14 ' +
      'UStG es verlangt.',
    next: 'Beleg',
  },
}

/** A sentence about one sequence, after something was done to it. */
interface Said {
  readonly key: NumberRangeKey
  readonly tone: 'status' | 'alert'
  readonly text: string
}

/**
 * How the documents of this business are numbered, the board "Nummernkreise":
 * one table, a row per sequence with its pattern, the next number and what the
 * next one will be called, worked out while typing with the same function the
 * server numbers with. Only the owner changes them, like the letterhead; the
 * office sees the same table with nothing to press.
 *
 * A changed pattern applies from the next document, and the numbers already
 * handed out stay what they are. The next number only goes up: that is how a
 * business continues the count of the program it comes from, and going down
 * would hand out a number some document already carries.
 *
 * Each row saves on its own, with a small button that wakes up once the row
 * is changed: six copper buttons were one of the findings of #223.
 */
export function NumberRangesScreen() {
  const loaded = useQuery({ queryKey: ['number-ranges'], queryFn: numberRanges })
  const mayWrite = useMay('settings.write')
  const [said, setSaid] = useState<Said | null>(null)

  return (
    <SettingsPage
      active="nummernkreise"
      title="Nummernkreise"
      sub="Wie Aufträge und Belege dieses Betriebs nummeriert werden."
    >
      <SettingsText>
        Im Muster steht {'{year}'} für das Jahr, in dem der Beleg ausgestellt oder der Auftrag
        angelegt wird, und {'{number}'} für die laufende Nummer; {'{number:4}'} füllt sie mit Nullen
        auf vier Stellen auf. Ein neues Muster gilt ab der nächsten Nummer, vergebene bleiben, wie
        sie sind.
      </SettingsText>

      {loaded.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : loaded.isError ? (
        <SettingsText muted>
          {saidWhy(loaded.error, 'Die Nummernkreise kamen nicht an.')}
        </SettingsText>
      ) : (
        <NumberRangeTable ranges={loaded.data} mayWrite={mayWrite} said={said} onSaid={setSaid} />
      )}
    </SettingsPage>
  )
}

function NumberRangeTable({
  ranges,
  mayWrite,
  said,
  onSaid,
}: {
  readonly ranges: readonly NumberRangeView[]
  readonly mayWrite: boolean
  readonly said: Said | null
  readonly onSaid: (said: Said | null) => void
}) {
  const band = useBand()
  // A row is remounted with what the server keeps after every save.
  const keyOf = (range: NumberRangeView) =>
    `${range.key}:${range.pattern}:${String(range.nextValue)}`

  const note = (
    <div className="flex flex-col gap-1.5">
      <span>
        Die nächste Nummer geht nur nach oben, etwa um die Zählung eines bisherigen Programms
        fortzusetzen.
      </span>
      {said ? (
        <p
          role={said.tone}
          className={said.tone === 'alert' ? 'font-semibold text-conflict' : 'text-done'}
        >
          {said.text}
        </p>
      ) : null}
    </div>
  )

  if (band === 'S') {
    // On a phone a box per sequence, the form in it, as tables are there (#218).
    return (
      <Panel>
        <ul aria-label="Nummernkreise" className="flex flex-col gap-2.5">
          {ranges.map((range) => (
            <li
              key={keyOf(range)}
              aria-label={about[range.key].title}
              className="rounded-[4px] border border-line bg-ground p-2.5"
            >
              <NumberRangeRow range={range} mayWrite={mayWrite} onSaid={onSaid} stacked />
            </li>
          ))}
        </ul>
        <div className="mt-2.5 text-[13px] text-ink-muted">{note}</div>
      </Panel>
    )
  }

  return (
    <TablePanel caption="Nummernkreise" note={note}>
      <thead>
        <tr>
          <Column>Kreis</Column>
          <Column className="w-[186px]">Muster</Column>
          <Column className="w-[104px]">Nächste Nummer</Column>
          <Column className="w-[128px]">Der nächste heißt</Column>
          {mayWrite ? (
            <Column numeric className="w-[96px]">
              <span className="sr-only">Speichern</span>
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {ranges.map((range) => (
          <NumberRangeRow key={keyOf(range)} range={range} mayWrite={mayWrite} onSaid={onSaid} />
        ))}
      </tbody>
    </TablePanel>
  )
}

/** An input of a row, `inp()` of the board: 30 pixels, 13 pixel figures. */
function RowInput({
  label,
  problem,
  className,
  ...rest
}: {
  readonly label: string
  readonly problem: string | null
} & InputHTMLAttributes<HTMLInputElement>) {
  const problemId = useId()

  return (
    <>
      <input
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        className={clsx(
          'numeric h-[30px] w-full min-w-0 rounded-control border bg-input px-2 text-[13px] text-ink max-lg:h-tap max-lg:text-[15px]',
          problem ? 'border-conflict' : 'border-line-strong',
          className,
        )}
        {...rest}
      />
      {problem ? (
        <span id={problemId} className="mt-1 block text-[12px] leading-[1.4] text-conflict">
          {problem}
        </span>
      ) : null}
    </>
  )
}

function NumberRangeRow({
  range,
  mayWrite,
  onSaid,
  stacked = false,
}: {
  readonly range: NumberRangeView
  readonly mayWrite: boolean
  readonly onSaid: (said: Said | null) => void
  /** In a box of its own on a phone instead of a row of the table. */
  readonly stacked?: boolean
}) {
  const queries = useQueryClient()
  const [pattern, setPattern] = useState(range.pattern)
  const [next, setNext] = useState(String(range.nextValue))
  const formId = useId()

  const problem = patternProblem(pattern.trim())
  const counter = Number(next)
  const counterMoved = next.trim() !== String(range.nextValue)
  const counterProblem =
    !Number.isInteger(counter) || counter < 1
      ? 'Die nächste Nummer ist eine ganze Zahl ab 1.'
      : counter < range.nextValue
        ? `Die nächste Nummer kann nur steigen, von ${String(range.nextValue)} an.`
        : null
  const preview =
    problem === null && counterProblem === null
      ? formatDocumentNumber(pattern.trim(), { counter, year: new Date().getFullYear() })
      : null
  const changed = pattern.trim() !== range.pattern || counterMoved

  const save = useMutation({
    mutationFn: () =>
      changeNumberRange(range.key, {
        pattern: pattern.trim(),
        ...(counterMoved ? { nextValue: counter } : {}),
      }),
    onSuccess: (saved) => {
      onSaid({
        key: range.key,
        tone: 'status',
        text: `Gespeichert. Der nächste ${about[range.key].next} heißt ${saved.next}.`,
      })
      void queries.invalidateQueries({ queryKey: ['number-ranges'] })
    },
    onError: (error) => {
      onSaid({
        key: range.key,
        tone: 'alert',
        text: saidWhy(error, 'Der Nummernkreis ließ sich nicht speichern.'),
      })
    },
  })

  const { title, covers } = about[range.key]
  const name = (
    <>
      <span className="block font-semibold">{title}</span>
      {covers ? (
        <span className="mt-0.5 block text-[12px] leading-[1.4] text-ink-faint">{covers}</span>
      ) : null}
    </>
  )
  const patternField = mayWrite ? (
    <RowInput
      label={`Muster der ${title}`}
      problem={problem}
      name="pattern"
      autoComplete="off"
      required
      form={formId}
      value={pattern}
      onChange={(event) => {
        setPattern(event.target.value)
      }}
    />
  ) : (
    <span className="numeric">{range.pattern}</span>
  )
  const nextField = mayWrite ? (
    <RowInput
      label={`Nächste Nummer der ${title}`}
      problem={counterProblem}
      name="nextValue"
      inputMode="numeric"
      required
      form={formId}
      value={next}
      onChange={(event) => {
        setNext(event.target.value)
      }}
    />
  ) : (
    <span className="numeric">{range.nextValue}</span>
  )
  const shown = <strong className="numeric font-semibold">{preview ?? range.next}</strong>
  const button = mayWrite ? (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault()
        onSaid(null)
        save.mutate()
      }}
    >
      <Button
        type="submit"
        size="small"
        aria-label={`${title} speichern`}
        disabled={save.isPending || !changed || problem !== null || counterProblem !== null}
      >
        {save.isPending ? 'Einen Moment' : 'Speichern'}
      </Button>
    </form>
  ) : null

  if (stacked) {
    return (
      <div className="flex flex-col gap-2 text-[15px]">
        <div>{name}</div>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">Muster</span>
          {patternField}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">Nächste Nummer</span>
          {nextField}
        </label>
        <p className="text-[13px] text-ink-muted">Der nächste heißt {shown}.</p>
        {button}
      </div>
    )
  }

  return (
    <tr aria-label={title}>
      <Cell>{name}</Cell>
      <Cell>{patternField}</Cell>
      <Cell>{nextField}</Cell>
      <Cell>{shown}</Cell>
      {mayWrite ? <Cell numeric>{button}</Cell> : null}
    </tr>
  )
}
