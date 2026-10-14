import { numberFromPattern, patternProblem } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react'

import { useBand } from '../components/band.js'
import { Button } from '../components/button.js'
import { Panel, TablePanel } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { useRight } from '../session/queries.js'
import { request, RequestRefused } from '../sync/transport.js'
import { SettingsPage, SettingsText } from './settings.js'

/** One sequence of a tenant as the route of the settings shows it. */
export interface NumberRangeView<Key extends string = string> {
  readonly key: Key
  readonly pattern: string
  /** The counter the next number gets. */
  readonly nextValue: number
  /** What the next number would be, drawn now. */
  readonly next: string
}

const path = '/settings/number-ranges'

/** The sequences of the tenant, read straight at the route like every setting. */
export function numberRanges<Key extends string>(): Promise<readonly NumberRangeView<Key>[]> {
  return request<readonly NumberRangeView<Key>[]>(path)
}

/** A new pattern for a sequence, and a higher counter if one is given. */
export function changeNumberRange<Key extends string>(
  key: Key,
  wanted: { readonly pattern: string; readonly nextValue?: number },
): Promise<NumberRangeView<Key>> {
  return request<NumberRangeView<Key>>(`${path}/${key}`, {
    method: 'PUT',
    body: JSON.stringify(wanted),
  })
}

/** What the screen of the number ranges says, in the words of the application. */
export interface NumberRangeWords<Key extends string> {
  /** The sentence under the title: what the sequences number. */
  readonly sub: string
  /** The paragraph over the table: how a pattern is written. */
  readonly explanation: ReactNode
  /** Each sequence by its name, with a sentence on what it counts where it needs one. */
  readonly ranges: Readonly<Record<Key, { readonly title: string; readonly covers: string }>>
  /** The heading over the next number, in the gender of what is numbered: "Die nächste heißt". */
  readonly nextHeading: string
  /** The sentence once a sequence is saved, with the next number it hands out. */
  readonly saved: (key: Key, next: string) => string
  /** The remark under the table: why the counter only goes up. */
  readonly note: string
}

/** What the application hands the screen of the number ranges. */
export interface NumberRangesProps<Key extends string> {
  /** The right of the application that changes a sequence; without it they are only read. */
  readonly rights: { readonly write: string }
  readonly words: NumberRangeWords<Key>
}

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** A sentence about one sequence, after something was done to it. */
interface Said {
  readonly tone: 'status' | 'alert'
  readonly text: string
}

/**
 * How what a tenant hands out is numbered, the board "Nummernkreise"
 * (opengewerk-haustechnik#127): one table, a row per sequence with its pattern, the next number and
 * what the next one will be called, worked out while typing with the same
 * function the server numbers with. Whoever has the right changes them; the
 * others see the same table with nothing to press.
 *
 * A changed pattern applies from the next number, and the numbers already
 * handed out stay what they are. The next number only goes up: that is how a
 * tenant continues the count of the program it comes from, and going down
 * would hand out a number something already carries.
 *
 * Each row saves on its own, with a small button that wakes up once the row
 * is changed: a copper button in every row was one of the findings of #223.
 */
export function NumberRangesScreen<Key extends string>({ rights, words }: NumberRangesProps<Key>) {
  const loaded = useQuery({ queryKey: ['number-ranges'], queryFn: () => numberRanges<Key>() })
  const mayWrite = useRight(rights.write)
  const [said, setSaid] = useState<Said | null>(null)

  return (
    <SettingsPage active="nummernkreise" title="Nummernkreise" sub={words.sub}>
      <SettingsText>{words.explanation}</SettingsText>

      {loaded.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : loaded.isError ? (
        <SettingsText muted>
          {saidWhy(loaded.error, 'Die Nummernkreise kamen nicht an.')}
        </SettingsText>
      ) : (
        <NumberRangeTable
          ranges={loaded.data}
          words={words}
          mayWrite={mayWrite}
          said={said}
          onSaid={setSaid}
        />
      )}
    </SettingsPage>
  )
}

function NumberRangeTable<Key extends string>({
  ranges,
  words,
  mayWrite,
  said,
  onSaid,
}: {
  readonly ranges: readonly NumberRangeView<Key>[]
  readonly words: NumberRangeWords<Key>
  readonly mayWrite: boolean
  readonly said: Said | null
  readonly onSaid: (said: Said | null) => void
}) {
  const band = useBand()
  // A row is remounted with what the server keeps after every save.
  const keyOf = (range: NumberRangeView<Key>) =>
    `${range.key}:${range.pattern}:${String(range.nextValue)}`

  const note = (
    <div className="flex flex-col gap-1.5">
      <span>{words.note}</span>
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
              aria-label={words.ranges[range.key].title}
              className="rounded-[4px] border border-line bg-ground p-2.5"
            >
              <NumberRangeRow
                range={range}
                words={words}
                mayWrite={mayWrite}
                onSaid={onSaid}
                stacked
              />
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
          <Column className="w-[128px]">{words.nextHeading}</Column>
          {mayWrite ? (
            <Column numeric className="w-[96px]">
              <span className="sr-only">Speichern</span>
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {ranges.map((range) => (
          <NumberRangeRow
            key={keyOf(range)}
            range={range}
            words={words}
            mayWrite={mayWrite}
            onSaid={onSaid}
          />
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

function NumberRangeRow<Key extends string>({
  range,
  words,
  mayWrite,
  onSaid,
  stacked = false,
}: {
  readonly range: NumberRangeView<Key>
  readonly words: NumberRangeWords<Key>
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
      ? numberFromPattern(pattern.trim(), { counter, year: new Date().getFullYear() })
      : null
  const changed = pattern.trim() !== range.pattern || counterMoved

  const save = useMutation({
    mutationFn: () =>
      changeNumberRange(range.key, {
        pattern: pattern.trim(),
        ...(counterMoved ? { nextValue: counter } : {}),
      }),
    onSuccess: (saved) => {
      onSaid({ tone: 'status', text: words.saved(range.key, saved.next) })
      void queries.invalidateQueries({ queryKey: ['number-ranges'] })
    },
    onError: (error) => {
      onSaid({ tone: 'alert', text: saidWhy(error, 'Der Nummernkreis ließ sich nicht speichern.') })
    },
  })

  const { title, covers } = words.ranges[range.key]
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
        <p className="text-[13px] text-ink-muted">
          {words.nextHeading} {shown}.
        </p>
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
