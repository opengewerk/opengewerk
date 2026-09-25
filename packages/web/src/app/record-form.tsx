import type { RecordState } from '@opengewerk/domain'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { Button, Field, SelectField, useEntry } from '../components/index.js'
import { refusalText } from '../sync/client.js'
import type { EditResult } from '../sync/client.js'

/**
 * One field of a form, described rather than written out.
 *
 * ADR 0004 names a form engine on a JSON schema renderer for later. This is
 * not that, and it deliberately stops well short of it: four kinds of input
 * and a list of choices, enough that the six forms of this issue are six
 * descriptions instead of six hand built forms that drift apart in how they
 * label, space and announce themselves.
 */
export interface FormField {
  readonly name: string
  readonly label: string
  readonly kind?: 'text' | 'email' | 'tel' | 'date' | 'number'
  /** Turns the field into a list of choices. */
  readonly options?: readonly { readonly value: string; readonly label: string }[]
  readonly required?: boolean
  readonly hint?: string
  /** Amounts and measured values, for tabular figures. */
  readonly numeric?: boolean
}

/**
 * What a field starts with: whatever the record holds, as text.
 *
 * Through `String` rather than through a reader that only takes text, because
 * a record carries booleans and numbers as well, and a form that reads only
 * strings would show a customer's "Unternehmen: ja" as the first option in the
 * list, which is "nein". The edit would then quietly turn it off.
 */
function held(record: RecordState | null | undefined, field: FormField): string {
  const value = record?.[field.name]

  if (value === null || value === undefined) {
    return field.options?.[0]?.value ?? ''
  }

  return String(value)
}

/** The text a choice list hands back, as the record wants it. */
export function asBoolean(value: string | undefined): boolean {
  return value === 'true'
}

/** Empty means "not set" and has to arrive as null, not as an empty string. */
export function asTextOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''

  return trimmed.length > 0 ? trimmed : null
}

/** The two choices a boolean field offers, so no screen writes them twice. */
export const yesOrNo = [
  { value: 'false', label: 'Nein' },
  { value: 'true', label: 'Ja' },
] as const

/**
 * A form over one record, in the one shape every screen here uses.
 *
 * It hands back the values it collected and says nothing about where they go.
 * Whether that is a create or a change, and whether the outbox will take it,
 * is the caller's business and the sync client's; this only has to show what a
 * refusal said, because a refusal arrives while the form is still open and
 * that is the moment it is worth anything.
 */
export function RecordForm({
  fields,
  record,
  submitLabel,
  onSubmit,
  onCancel,
  disabled,
  disabledReason,
  check,
  extraAction,
  columns,
  divided = true,
}: {
  readonly fields: readonly FormField[]
  readonly record?: RecordState | null
  readonly submitLabel: string
  readonly onSubmit: (values: Record<string, string>) => Promise<EditResult>
  readonly onCancel?: () => void
  /** Set when the rules say this cannot be written at all right now. */
  readonly disabled?: boolean
  readonly disabledReason?: string
  /**
   * A rule from `domain` the values have to pass before anything is sent, as
   * the sentence the form shows, or null when they pass. Asked here and not
   * after the fact, because the server refuses the same thing for the whole
   * transmission, and a form is the one place that can still say which field.
   */
  readonly check?: (values: Record<string, string>) => string | null
  /** A further action at the left of the buttons, "Entfernen" in a form that changes. */
  readonly extraAction?: ReactNode
  /**
   * The columns from 1024 pixels on, where a board draws the fields of a form
   * in one row: "Neue Aufgabe" has four. Two below that, one on a phone.
   */
  readonly columns?: string
  /** A line over the buttons, as under the circuit; the new task has none. */
  readonly divided?: boolean
}) {
  const entry = useEntry()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, held(record, field)])),
  )
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [wrongFields, setWrongFields] = useState<readonly string[]>([])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)
    setWrongFields([])

    const problem = check?.(values) ?? null

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setWorking(true)

    try {
      const result = await onSubmit(values)

      if (result.outcome === 'refused') {
        setTrouble(refusalText[result.reason])
        setWrongFields(result.fields)
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      {disabled && disabledReason ? (
        <p role="status" className="text-[13px] font-medium text-ink-muted">
          {disabledReason}
        </p>
      ) : null}

      <div className={clsx('grid gap-3 sm:grid-cols-2', columns)}>
        {fields.map((field) =>
          field.options ? (
            <SelectField
              key={field.name}
              label={field.label}
              options={field.options}
              required={field.required}
              hint={field.hint}
              value={values[field.name] ?? ''}
              onChange={(value) => {
                setValues((current) => ({ ...current, [field.name]: value }))
              }}
            />
          ) : (
            <Field
              key={field.name}
              label={field.label}
              type={field.kind ?? 'text'}
              name={field.name}
              required={field.required}
              hint={field.hint}
              numeric={field.numeric}
              problem={wrongFields.includes(field.name) ? 'Dieses Feld ist der Grund.' : undefined}
              value={values[field.name] ?? ''}
              onChange={(event) => {
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }}
            />
          ),
        )}
      </div>

      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {entry === 'site' ? (
        // On site the action is a button across the screen, the way out
        // under it, as the forms of the site boards have it.
        <div className="flex flex-col gap-2">
          <Button type="submit" tone="primary" wide disabled={working || disabled}>
            {working ? 'Wird gespeichert' : submitLabel}
          </Button>
          {onCancel ? (
            <Button tone="quiet" wide onClick={onCancel} disabled={working}>
              Abbrechen
            </Button>
          ) : null}
          {extraAction}
        </div>
      ) : (
        // In the office the buttons stand at the right under a line, the
        // one that saves last, as under the circuit on the canvas.
        <div
          className={clsx(
            'flex flex-wrap items-center justify-end gap-2',
            divided && 'border-t border-line pt-3',
          )}
        >
          {extraAction ? (
            <>
              {extraAction}
              <div className="grow" />
            </>
          ) : null}
          {onCancel ? (
            <Button onClick={onCancel} disabled={working}>
              Abbrechen
            </Button>
          ) : null}
          <Button type="submit" tone="primary" icon={Check} disabled={working || disabled}>
            {working ? 'Wird gespeichert' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
