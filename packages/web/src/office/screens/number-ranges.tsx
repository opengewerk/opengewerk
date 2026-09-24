import { formatDocumentNumber, type NumberRangeKey, patternProblem } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Field } from '../../components/index.js'
import { useMay } from '../../app/queries.js'
import {
  changeNumberRange,
  numberRanges,
  type NumberRangeView,
} from '../../session/number-ranges.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'

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
 * How the documents of this business are numbered.
 *
 * One section per sequence: its pattern, the next number, and what the next
 * document will be called, worked out while typing with the same function the
 * server numbers with. Only the owner changes them, like the letterhead; the
 * office sees the same screen with nothing to press.
 *
 * A changed pattern applies from the next document, and the numbers already
 * handed out stay what they are. The next number only goes up: that is how a
 * business continues the count of the program it comes from, and going down
 * would hand out a number some document already carries.
 */
export function NumberRangesScreen() {
  const loaded = useQuery({ queryKey: ['number-ranges'], queryFn: numberRanges })
  const mayWrite = useMay('settings.write')
  const [said, setSaid] = useState<Said | null>(null)

  return (
    <Page title="Nummernkreise" meta="Wie Aufträge und Belege dieses Betriebs nummeriert werden.">
      <p className="text-body text-ink">
        Im Muster steht {'{year}'} für das Jahr, in dem der Beleg ausgestellt oder der Auftrag
        angelegt wird, und {'{number}'} für die laufende Nummer; {'{number:4}'} füllt sie mit Nullen
        auf vier Stellen auf. Ein neues Muster gilt ab der nächsten Nummer, vergebene bleiben, wie
        sie sind.
      </p>

      {loaded.isPending ? (
        <Nothing>Wird geladen.</Nothing>
      ) : loaded.isError ? (
        <Nothing>{saidWhy(loaded.error, 'Die Nummernkreise kamen nicht an.')}</Nothing>
      ) : (
        loaded.data.map((range) => (
          <NumberRangeSection
            // Remounted with what the server keeps after every save.
            key={`${range.key}:${range.pattern}:${String(range.nextValue)}`}
            range={range}
            mayWrite={mayWrite}
            said={said?.key === range.key ? said : null}
            onSaid={setSaid}
          />
        ))
      )}
    </Page>
  )
}

function NumberRangeSection({
  range,
  mayWrite,
  said,
  onSaid,
}: {
  readonly range: NumberRangeView
  readonly mayWrite: boolean
  readonly said: Said | null
  readonly onSaid: (said: Said | null) => void
}) {
  const queries = useQueryClient()
  const [pattern, setPattern] = useState(range.pattern)
  const [next, setNext] = useState(String(range.nextValue))

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

  return (
    <Section title={title}>
      <div className="flex flex-col gap-3">
        {covers ? <p className="text-body text-ink-muted">{covers}</p> : null}

        {mayWrite ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              onSaid(null)
              save.mutate()
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Muster"
                name="pattern"
                autoComplete="off"
                required
                value={pattern}
                onChange={(event) => {
                  setPattern(event.target.value)
                }}
                {...(problem === null ? {} : { problem })}
              />
              <Field
                label="Nächste Nummer"
                name="nextValue"
                inputMode="numeric"
                numeric
                required
                value={next}
                onChange={(event) => {
                  setNext(event.target.value)
                }}
                {...(counterProblem === null ? {} : { problem: counterProblem })}
                hint="Nur nach oben, etwa um die Zählung eines bisherigen Programms fortzusetzen."
              />
            </div>
            <p className="text-body text-ink">
              Der nächste {about[range.key].next} heißt <strong>{preview ?? range.next}</strong>.
            </p>
            <div>
              <Button
                type="submit"
                tone="primary"
                disabled={save.isPending || problem !== null || counterProblem !== null}
              >
                {save.isPending ? 'Einen Moment' : 'Speichern'}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-body text-ink">
            Muster <strong>{range.pattern}</strong>, der nächste {about[range.key].next} heißt{' '}
            <strong>{range.next}</strong>.
          </p>
        )}

        {said ? (
          <p
            role={said.tone}
            className={
              said.tone === 'alert'
                ? 'text-body font-semibold text-conflict'
                : 'text-body text-ink-muted'
            }
          >
            {said.text}
          </p>
        ) : null}
      </div>
    </Section>
  )
}
