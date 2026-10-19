import {
  checkedInstanceMeasures,
  type InstanceMeasures,
  type InstanceMeasuresView,
  instanceMeasureSections,
  type MeasureField,
  measureLimits,
  type Subprocessor,
} from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useInstanceSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Field, TextArea } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { date } from '../format.js'
import { Saved, SettingsText } from '../office/settings.js'
import { instanceMeasures, saveInstanceMeasures } from '../session/instance.js'
import { RequestRefused } from '../sync/transport.js'
import { InstancePage } from './frame.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** A row of annex 2 as the screen holds it, with a key of its own for React. */
interface Row extends Subprocessor {
  readonly key: number
}

let rowKeys = 0

function rowsOf(subprocessors: readonly Subprocessor[]): Row[] {
  return subprocessors.map((entry) => ({ ...entry, key: (rowKeys += 1) }))
}

function kept(measures: InstanceMeasures, rows: readonly Row[]) {
  return {
    measures,
    subprocessors: rows.map(({ name, service, place }) => ({ name, service, place })),
  }
}

/** Whether what the screen would keep is what is kept, whatever order the keys of part B came in. */
function same(
  one: { readonly measures: InstanceMeasures; readonly subprocessors: readonly Subprocessor[] },
  other: { readonly measures: InstanceMeasures; readonly subprocessors: readonly Subprocessor[] },
): boolean {
  const keys = Object.keys(one.measures)

  return (
    keys.length === Object.keys(other.measures).length &&
    keys.every((key) => one.measures[key] === other.measures[key]) &&
    JSON.stringify(one.subprocessors) === JSON.stringify(other.subprocessors)
  )
}

/**
 * Part B of the technical and organisational measures and the subprocessors
 * of the instance (opengewerk-haustechnik#358), the board "Maßnahmen der
 * Instanz" of the page "Bereich der Instanz": what whoever runs the instance
 * ensures while running it, section by section as the template of the
 * contract on processing on behalf numbers them, and who works for them doing
 * so. Every tenant on the instance gets both into its measures and changes
 * nothing of them; the application says so in its own words.
 *
 * One form and one "Speichern" for all of it, so that what is kept is what the
 * screen shows. A subprocessor needs all three of its fields; the sentence
 * that says what is missing comes when saving, not while a new row is still
 * being typed.
 */
export function InstanceMeasuresScreen() {
  const sentences = useInstanceSentences().measures
  const view = useQuery({ queryKey: ['instance-measures'], queryFn: instanceMeasures })

  return (
    <InstancePage title="Maßnahmen" sub={sentences.sub}>
      {view.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : view.isError ? (
        <SettingsText muted>{saidWhy(view.error, 'Die Maßnahmen kamen nicht an.')}</SettingsText>
      ) : (
        <MeasuresForm view={view.data} />
      )}
    </InstancePage>
  )
}

/** When and by whom part B and annex 2 were last changed, as far as the log of the instance knows. */
function changedLine(view: InstanceMeasuresView): string {
  if (view.changedAt === null) {
    return 'Noch nicht ausgefüllt.'
  }

  return view.changedBy === null
    ? `Zuletzt geändert am ${date(view.changedAt)}.`
    : `Zuletzt geändert am ${date(view.changedAt)} von ${view.changedBy}.`
}

function MeasuresForm({ view }: { readonly view: InstanceMeasuresView }) {
  const sentences = useInstanceSentences().measures
  const queries = useQueryClient()
  const [measures, setMeasures] = useState<InstanceMeasures>(view.measures)
  const [rows, setRows] = useState<Row[]>(() => rowsOf(view.subprocessors))
  const [saved, setSaved] = useState(false)
  const [tried, setTried] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const checked = checkedInstanceMeasures(kept(measures, rows))
  const problem = 'problem' in checked ? checked.problem : null
  // Ticking a box and taking the tick back again is no change.
  const changed = 'problem' in checked || !same(checked, view)
  const save = useMutation({
    mutationFn: saveInstanceMeasures,
    onSuccess: (answer) => {
      queries.setQueryData(['instance-measures'], answer)
    },
  })

  function set(key: string, value: string | boolean) {
    setSaved(false)
    setMeasures((before) => ({ ...before, [key]: value }))
  }

  function setRow(key: number, part: keyof Subprocessor, value: string) {
    setSaved(false)
    setRows((before) => before.map((row) => (row.key === key ? { ...row, [part]: value } : row)))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    setSaved(false)
    setTrouble(null)

    if ('problem' in checked) {
      return
    }

    save.mutate(checked, {
      onSuccess: (answer) => {
        // What was kept, without the spaces around a text and the boxes left empty.
        setMeasures(answer.measures)
        setRows(rowsOf(answer.subprocessors))
        setSaved(true)
        setTried(false)
      },
      onError: (error) => {
        setTrouble(saidWhy(error, 'Die Maßnahmen ließen sich nicht speichern.'))
      },
    })
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <SettingsText muted>{sentences.what}</SettingsText>
      <div className="grid gap-3 lg:grid-cols-2">
        {instanceMeasureSections.map((section) => (
          <Panel
            key={section.number}
            title={`${section.number} ${section.title}`}
            roomy
            className={section.fields.some((field) => field.kind === 'area') ? 'lg:col-span-2' : ''}
          >
            <div className="flex flex-col gap-2.5">
              {section.fields.map((field) => (
                <MeasureInput
                  key={field.key}
                  field={field}
                  value={measures[field.key]}
                  onChange={(value) => {
                    set(field.key, value)
                  }}
                />
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <Panel
        title="Unterauftragsverarbeiter"
        roomy
        action={
          <Button
            size="small"
            icon={Plus}
            disabled={rows.length >= measureLimits.subprocessors}
            onClick={() => {
              setSaved(false)
              setRows((before) => [
                ...before,
                { name: '', service: '', place: '', key: (rowKeys += 1) },
              ])
            }}
          >
            Hinzufügen
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {rows.length === 0 ? <SettingsText muted>Noch keine eingetragen.</SettingsText> : null}
          {rows.map((row, index) => (
            <fieldset
              key={row.key}
              className="grid gap-2.5 border-0 p-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
            >
              <legend className="sr-only">{`${index + 1}. Unterauftragsverarbeiter`}</legend>
              <Field
                label="Name und Anschrift"
                value={row.name}
                onChange={(event) => {
                  setRow(row.key, 'name', event.target.value)
                }}
              />
              <Field
                label="Leistung"
                value={row.service}
                onChange={(event) => {
                  setRow(row.key, 'service', event.target.value)
                }}
              />
              <Field
                label="Ort der Verarbeitung"
                value={row.place}
                onChange={(event) => {
                  setRow(row.key, 'place', event.target.value)
                }}
              />
              <Button
                size="small"
                tone="danger"
                aria-label={`${index + 1}. Unterauftragsverarbeiter entfernen`}
                onClick={() => {
                  setSaved(false)
                  setRows((before) => before.filter((other) => other.key !== row.key))
                }}
              >
                Entfernen
              </Button>
            </fieldset>
          ))}
          <SettingsText small muted>
            {`Typisch sind der Anbieter des Servers, der Ort der Sicherungen und der Anbieter des Mailservers der Instanz. ${sentences.ownMail}`}
          </SettingsText>
        </div>
      </Panel>
      {tried && problem !== null ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {problem}
        </p>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {saved ? (
          <Saved />
        ) : (
          <SettingsText small muted>
            {changedLine(view)}
          </SettingsText>
        )}
        <div className="ml-auto flex gap-2">
          <Button tone="primary" type="submit" icon={Check} disabled={!changed || save.isPending}>
            Speichern
          </Button>
        </div>
      </div>
    </form>
  )
}

function MeasureInput({
  field,
  value,
  onChange,
}: {
  readonly field: MeasureField
  readonly value: string | boolean | undefined
  readonly onChange: (value: string | boolean) => void
}) {
  if (field.kind === 'check') {
    return (
      <label className="inline-flex min-h-6 items-start gap-[7px] text-[14px] leading-snug max-lg:min-h-tap">
        <input
          type="checkbox"
          className="mt-[3px] size-[15px] shrink-0 accent-copper-solid max-lg:size-5"
          checked={value === true}
          onChange={(event) => {
            onChange(event.target.checked)
          }}
        />
        {field.label}
      </label>
    )
  }

  const text = typeof value === 'string' ? value : ''

  if (field.kind === 'area') {
    return (
      <TextArea
        label={field.label}
        rows={3}
        value={text}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    )
  }

  return (
    <Field
      label={field.label}
      value={text}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    />
  )
}
