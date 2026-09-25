import {
  type BlockField,
  type FieldValue,
  formValuesText,
  type FormDefinition,
  type FormValues,
  readFormDefinition,
  readFormValues,
  type RecordState,
  reportDefinitionKey,
  type ReportFieldContent,
  reportFieldLines,
  reportFieldsOf,
  valuesProblem,
} from '@opengewerk/domain'
import { useMemo, useState } from 'react'

import { Panel } from '../components/index.js'
import { refusalFor } from '../sync/client.js'
import { useRecords, useSync } from '../sync/provider.js'
import { FieldInput } from './protocols.js'

/**
 * The fields a business gives its reports (#78) on both entries: filled in
 * on site, read by the customer before signing, shown in the office.
 *
 * The versions come through the sync, since a report is written without a
 * network. A report is filled in and shown in the version it was started
 * with; one that has none yet gets the newest when its fields are first
 * saved, and keeps it from then on.
 */

/** Every version of the business's report fields this device holds, by version. */
export function useReportDefinitions(): ReadonlyMap<number, FormDefinition> {
  const records = useRecords('form_definitions')

  return useMemo(
    () =>
      new Map(
        records.flatMap((record) => {
          const version = record['definitionVersion']
          const definition = readFormDefinition(record['definition'])

          return record['key'] === reportDefinitionKey && typeof version === 'number' && definition
            ? [[version, definition] as const]
            : []
        }),
      ),
    [records],
  )
}

/** The version a report shows its fields in: its own, or the newest while it has none. */
export function reportDefinitionFor(
  report: RecordState,
  definitions: ReadonlyMap<number, FormDefinition>,
): FormDefinition | null {
  const version = report['fieldsVersion']

  if (typeof version === 'number') {
    return definitions.get(version) ?? null
  }

  return definitions.get(Math.max(0, ...definitions.keys())) ?? null
}

/** The values a report carries, as the form holds them. */
function valuesOfReport(report: RecordState): FormValues {
  return readFormValues(report['fieldValues']) ?? {}
}

/**
 * The fields of a report as the customer reads them before signing and the
 * office sees them: label and text, in the version the report was filled in,
 * the empty ones left out.
 */
export function useReportFieldLines(report: RecordState): readonly ReportFieldContent[] {
  const definitions = useReportDefinitions()
  const version = report['fieldsVersion']

  return reportFieldLines(
    typeof version === 'number' ? (definitions.get(version) ?? null) : null,
    valuesOfReport(report),
  )
}

/**
 * The fields as a list of label and text, `kv()` of the site boards: the
 * label in small capitals over its text.
 */
export function ReportFieldList({ lines }: { readonly lines: readonly ReportFieldContent[] }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {lines.map((line) => (
        <div key={line.label}>
          <dt className="font-condensed text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
            {line.label}
          </dt>
          <dd className="mt-0.5 text-[17px] leading-[1.4] whitespace-pre-line [overflow-wrap:anywhere]">
            {line.text}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The fields of a report in their card on site, or nothing for a report without them. */
export function ReportFieldsText({ report }: { readonly report: RecordState }) {
  const lines = useReportFieldLines(report)

  return lines.length === 0 ? null : (
    <Panel title="Angaben">
      <ReportFieldList lines={lines} />
    </Panel>
  )
}

/** Whether a field is a choice, saved the moment it is made rather than when the focus moves on. */
function savedAtOnce(field: BlockField): boolean {
  return field.kind === 'choice' || field.kind === 'yes_no'
}

/**
 * The fields of a report being written on site, in their card, or nothing
 * while the business has none. A choice is saved the moment it is made, text
 * and figures when the focus leaves the fields: somebody who moves on to the
 * hours or hands the device to the customer has nothing to remember, and a
 * report has only a handful of them.
 */
export function ReportFieldsForm({ report }: { readonly report: RecordState }) {
  const client = useSync()
  const definitions = useReportDefinitions()
  const definition = reportDefinitionFor(report, definitions)
  const saved = formValuesText(valuesOfReport(report))
  const [draft, setDraft] = useState<FormValues>(() => valuesOfReport(report))
  const [trouble, setTrouble] = useState<string | null>(null)

  const fields = reportFieldsOf(definition)

  if (!definition || fields.length === 0) {
    return null
  }

  const shown = definition

  async function save(values: FormValues) {
    if (formValuesText(values) === saved) {
      return
    }

    const problem = valuesProblem(shown, values)

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setTrouble(null)

    const result = await client.update('documents', String(report['id']), {
      fieldsVersion: shown.version,
      fieldValues: formValuesText(values),
    })

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))
    }
  }

  return (
    <Panel title="Angaben">
      <div
        className="flex flex-col gap-3"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            void save(draft)
          }
        }}
      >
        {fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={draft[field.key] as FieldValue | undefined}
            circuit={null}
            performedOn=""
            photos={[]}
            onChange={(value) => {
              const next: Record<string, FieldValue> = { ...(draft as Record<string, FieldValue>) }

              if (value === undefined) {
                delete next[field.key]
              } else {
                next[field.key] = value
              }

              setDraft(next)

              if (savedAtOnce(field)) {
                void save(next)
              }
            }}
          />
        ))}
        {trouble ? (
          <p role="alert" className="text-[16px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
