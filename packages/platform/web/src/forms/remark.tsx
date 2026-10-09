import type { CheckPointResult } from '@opengewerk/platform-domain'

import { TextArea } from '../components/field.js'

/** What the box under an answer asks for, and whether it has to be filled before signing. */
export interface RemarkAsked {
  readonly label: string
  readonly required: boolean
  readonly placeholder?: string
  /** Said while the box is empty and has to be filled. */
  readonly missing?: string
}

/**
 * What an answer to a check point asks of its remark: "in order" nothing,
 * "not in order" the finding, "not applicable" and "not possible" the reason
 * (the engine asks the same before the form is signed).
 */
export function remarkForCheckPoint(result: CheckPointResult | undefined): RemarkAsked {
  switch (result) {
    case 'not_ok':
      return {
        label: 'Bemerkung',
        required: true,
        placeholder: 'Was nicht in Ordnung ist',
        missing: '„Nicht in Ordnung“ verlangt eine Bemerkung.',
      }
    case 'not_applicable':
      return {
        label: 'Grund',
        required: true,
        placeholder: 'Warum der Punkt entfällt',
        missing: '„Entfällt“ verlangt einen Grund.',
      }
    case 'not_possible':
      return {
        label: 'Grund',
        required: true,
        placeholder: 'Warum es nicht möglich war',
        missing: '„Nicht möglich“ verlangt einen Grund.',
      }
    case 'ok':
    case undefined:
      return {
        label: 'Bemerkung',
        required: false,
        placeholder: 'freiwillig, bei „nicht in Ordnung“ verlangt',
      }
  }
}

/** What a measured value asks of its remark: a reason once it lies outside its limit. */
export function remarkForMeasurement(within: boolean | null): RemarkAsked {
  return within === false
    ? {
        label: 'Bemerkung',
        required: true,
        placeholder: 'Was dazu zu sagen ist',
        missing: 'Ein Wert außerhalb des Grenzwerts verlangt eine Bemerkung.',
      }
    : {
        label: 'Bemerkung',
        required: false,
        placeholder: 'freiwillig, außerhalb des Grenzwerts verlangt',
      }
}

export interface RemarkFieldProps {
  readonly asked: RemarkAsked
  readonly value: string
  readonly onChange: (value: string) => void
  readonly maxLength?: number
  readonly disabled?: boolean
}

/**
 * The remark or the reason under an answer. Where it is asked for, the label
 * says so ("Bemerkung, verlangt"), and while it is empty the box says what is
 * missing; the answer is kept all the same, so that it can be saved before
 * the remark is written.
 */
export function RemarkField({ asked, value, onChange, maxLength, disabled }: RemarkFieldProps) {
  return (
    <TextArea
      label={asked.required ? `${asked.label}, verlangt` : asked.label}
      rows={3}
      value={value}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={asked.placeholder}
      problem={asked.required && value.trim() === '' ? asked.missing : undefined}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    />
  )
}
