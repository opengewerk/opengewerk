import {
  type FormDefinition,
  measurementUnitSign,
  type MeasurementUnit,
  mostReportFields,
  nextReportFieldKey,
  type ReportField,
  type ReportFieldKind,
  reportFieldKinds,
  reportFieldsOf,
  reportFieldsProblems,
} from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Check, Plus } from 'lucide-react'
import { useState } from 'react'

import { Button, Confirm, Field, Panel, SelectField, TextArea } from '../../components/index.js'
import { useMay } from '../../app/queries.js'
import { currentReportFields, saveReportFields } from '../../session/report-fields.js'
import { RequestRefused } from '../../sync/transport.js'
import { Saved, SettingsPage, SettingsText } from '../settings-frame.js'

const kindLabel: Readonly<Record<ReportFieldKind, string>> = {
  text: 'Text',
  number: 'Zahl mit Einheit',
  choice: 'Auswahl',
  yes_no: 'Ja/Nein',
}

/** The units a field of a report is counted in; the others belong to a protocol. */
const reportUnits: readonly MeasurementUnit[] = [
  'kilometre',
  'metre',
  'hour',
  'minute',
  'degree_celsius',
  'piece',
  'percent',
]

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** A field turned into another kind, keeping its key and its label. */
function asKind(field: ReportField, kind: ReportFieldKind): ReportField {
  const base = { key: field.key, label: field.label }

  switch (kind) {
    case 'text':
      return { kind, ...base }
    case 'number':
      return { kind, ...base, unit: 'kilometre', decimals: 0 }
    case 'choice':
      return { kind, ...base, options: field.kind === 'choice' ? field.options : [] }
    case 'yes_no':
      return { kind, ...base }
  }
}

/** The options of a choice from what was typed, one per line; the label is the value too. */
function optionsFrom(typed: string): { value: string; label: string }[] {
  return typed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ value: line, label: line }))
}

/**
 * The columns of a field on the board "Felder des Regieberichts": a choice
 * has its options beside the kind, a number its unit and places, a text
 * leaves the third column empty.
 */
const columnsOf: Readonly<Record<ReportFieldKind, string>> = {
  text: 'lg:grid-cols-3',
  yes_no: 'lg:grid-cols-3',
  number: 'lg:grid-cols-4',
  choice: 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]',
}

/** What a field is, in a line: "Zahl mit Einheit, km". */
function describe(field: ReportField): string {
  switch (field.kind) {
    case 'number':
      return `${kindLabel.number}, ${measurementUnitSign[field.unit]}`
    case 'choice':
      return `${kindLabel.choice}: ${field.options.map((option) => option.label).join(', ')}`
    default:
      return kindLabel[field.kind]
  }
}

/**
 * The fields a business gives its reports (#78): the weather, the distance
 * driven, whatever it wants to have on every report besides the hours and
 * the material. Filled in on site and signed by the customer with the rest.
 *
 * Saving writes the next version. A report started before keeps the fields
 * it was started with, so nothing a customer signed changes afterwards. Only
 * the owner changes them; the office sees them with nothing to press.
 */
export function ReportFieldsScreen() {
  const current = useQuery({ queryKey: ['report-fields'], queryFn: currentReportFields })
  const mayWrite = useMay('settings.write')

  return (
    <SettingsPage
      active="regiebericht"
      title="Felder des Regieberichts"
      sub="Was ein Bericht neben Arbeitszeit und Material festhält."
    >
      {current.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : current.isError ? (
        <SettingsText muted>{saidWhy(current.error, 'Die Felder kamen nicht an.')}</SettingsText>
      ) : (
        <FieldsSection definition={current.data} mayWrite={mayWrite} />
      )}
    </SettingsPage>
  )
}

function FieldsSection({
  definition,
  mayWrite,
}: {
  readonly definition: FormDefinition | null
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const [fields, setFields] = useState<readonly ReportField[]>(reportFieldsOf(definition))
  const [options, setOptions] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      reportFieldsOf(definition).flatMap((field) =>
        field.kind === 'choice'
          ? [[field.key, field.options.map((option) => option.label).join('\n')]]
          : [],
      ),
    ),
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  // A field is taken off after a question (#222): once saved, new reports no
  // longer have it.
  const [removing, setRemoving] = useState<ReportField | null>(null)

  // The keys of the saved version and of the form, so that a field removed
  // here and one added in the same breath never share a key.
  const used = [
    ...reportFieldsOf(definition).map((field) => field.key),
    ...fields.map((field) => field.key),
  ]

  const wanted: readonly ReportField[] = fields.map((field) =>
    field.kind === 'choice' ? { ...field, options: optionsFrom(options[field.key] ?? '') } : field,
  )
  const [problem] = reportFieldsProblems(wanted)

  const save = useMutation({
    mutationFn: () => saveReportFields(wanted),
    onSuccess: (written) => {
      setTrouble(null)
      setSaved(written.version)
      void queries.invalidateQueries({ queryKey: ['report-fields'] })
    },
    onError: (error) => {
      setSaved(null)
      setTrouble(saidWhy(error, 'Die Felder ließen sich nicht speichern.'))
    },
  })

  function change(key: string, next: ReportField) {
    setSaved(null)
    setFields((all) => all.map((field) => (field.key === key ? next : field)))
  }

  function move(index: number, step: -1 | 1) {
    setSaved(null)
    setFields((all) => {
      const order = [...all]
      const [moved] = order.splice(index, 1)

      if (moved) {
        order.splice(index + step, 0, moved)
      }

      return order
    })
  }

  return (
    <Panel title={definition ? `Fassung ${String(definition.version)}` : 'Noch keine Felder'} roomy>
      <div className="flex flex-col gap-3">
        <SettingsText>
          Jeder Regiebericht bekommt diese Felder. Ausgefüllt werden sie auf der Baustelle, auch
          ohne Netz, und der Kunde unterschreibt sie mit dem Bericht. Eine Änderung gilt für
          Berichte, die danach angelegt werden; ein älterer behält die Felder, mit denen er angelegt
          wurde.
        </SettingsText>

        {!mayWrite ? (
          fields.length === 0 ? (
            <SettingsText muted>
              Der Betrieb hat seinen Berichten keine eigenen Felder gegeben.
            </SettingsText>
          ) : (
            <ul className="flex flex-col gap-2">
              {fields.map((field) => (
                <li key={field.key} className="flex flex-col">
                  <span className="text-[14px] font-semibold">{field.label}</span>
                  <span className="text-[13px] text-ink-muted">{describe(field)}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()

              if (problem === undefined) {
                save.mutate()
              }
            }}
          >
            {fields.map((field, index) => (
              <fieldset
                key={field.key}
                className="m-0 min-w-0 rounded-[5px] border border-line bg-ground px-3.5 pt-2 pb-3"
              >
                <legend className="px-1.5 font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
                  {`Feld ${String(index + 1)}`}
                </legend>
                <div className={clsx('grid gap-3 sm:grid-cols-2', columnsOf[field.kind])}>
                  <Field
                    label="Beschriftung"
                    value={field.label}
                    onChange={(event) => {
                      change(field.key, { ...field, label: event.target.value })
                    }}
                  />
                  <SelectField
                    label="Art"
                    value={field.kind}
                    options={reportFieldKinds.map((kind) => ({
                      value: kind,
                      label: kindLabel[kind],
                    }))}
                    onChange={(kind) => {
                      change(field.key, asKind(field, kind as ReportFieldKind))
                    }}
                  />
                  {field.kind === 'number' ? (
                    <>
                      <SelectField
                        label="Einheit"
                        value={field.unit}
                        options={reportUnits.map((unit) => ({
                          value: unit,
                          label: measurementUnitSign[unit],
                        }))}
                        onChange={(unit) => {
                          change(field.key, { ...field, unit: unit as MeasurementUnit })
                        }}
                      />
                      <SelectField
                        label="Nachkommastellen"
                        value={String(field.decimals)}
                        options={['0', '1', '2', '3'].map((places) => ({
                          value: places,
                          label: places,
                        }))}
                        onChange={(places) => {
                          change(field.key, { ...field, decimals: Number(places) })
                        }}
                      />
                    </>
                  ) : null}
                  {field.kind === 'choice' ? (
                    <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                      <TextArea
                        label="Möglichkeiten"
                        hint="Eine je Zeile, mindestens zwei."
                        rows={3}
                        value={options[field.key] ?? ''}
                        onChange={(event) => {
                          setSaved(null)
                          setOptions((all) => ({ ...all, [field.key]: event.target.value }))
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Button
                    size="small"
                    icon={ArrowUp}
                    disabled={index === 0}
                    onClick={() => {
                      move(index, -1)
                    }}
                  >
                    Nach oben
                  </Button>
                  <Button
                    size="small"
                    icon={ArrowDown}
                    disabled={index === fields.length - 1}
                    onClick={() => {
                      move(index, 1)
                    }}
                  >
                    Nach unten
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setRemoving(field)
                    }}
                  >
                    Entfernen
                  </Button>
                </div>
              </fieldset>
            ))}

            <Confirm
              open={removing !== null}
              title={`„${removing?.label.trim() || 'Feld'}“ entfernen?`}
              confirm="Entfernen"
              onConfirm={() => {
                if (removing) {
                  setSaved(null)
                  setFields((all) => all.filter((entry) => entry.key !== removing.key))
                }

                setRemoving(null)
              }}
              onCancel={() => {
                setRemoving(null)
              }}
            >
              Neue Regieberichte haben das Feld nicht mehr, sobald die Felder gespeichert sind.
              Berichte, die es schon haben, behalten es.
            </Confirm>

            {problem !== undefined && fields.length > 0 ? (
              <p className="text-[13px] font-semibold text-conflict">{problem}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                icon={Plus}
                disabled={fields.length >= mostReportFields}
                onClick={() => {
                  setSaved(null)
                  setFields((all) => [
                    ...all,
                    { kind: 'text', key: nextReportFieldKey(used), label: '' },
                  ])
                }}
              >
                Feld hinzufügen
              </Button>
              <Button
                type="submit"
                tone="primary"
                icon={Check}
                disabled={save.isPending || problem !== undefined}
              >
                {save.isPending ? 'Einen Moment' : 'Speichern'}
              </Button>
              {saved !== null ? (
                <Saved>
                  {`Gespeichert als Fassung ${String(saved)}. Berichte, die schon angelegt sind, behalten ihre Felder.`}
                </Saved>
              ) : null}
            </div>
          </form>
        )}

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
