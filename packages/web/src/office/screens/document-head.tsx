import type { IsoDate, RecordState } from '@opengewerk/domain'
import {
  addDays,
  carriesDueDate,
  isInvoice,
  longPaymentTermNotice,
  paymentTermLabel,
  servicePeriodProblem,
  shippedRules,
  statesPaymentTerm,
  taxTreatments,
} from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field, Panel, SelectField, TextArea } from '../../components/index.js'
import { date } from '../../app/format.js'
import { documentKindOf, taxTreatmentLabel, taxTreatmentOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { asTextOrNull } from '../../app/record-form.js'
import { parameterHistory } from '../../session/parameters.js'
import { refusalFor } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useSync } from '../../sync/provider.js'
import type { Fact } from '../kit.js'
import { FactList, NoteBox } from '../kit.js'
import { daysFrom, paymentTermOn } from './payment-term.js'
import { SnippetPicker, withSnippet } from './snippet-picker.js'

/** The payment term the document states for itself, or null when the setting applies. */
function ownTerm(document: RecordState): number | null {
  const value = document['paymentTermDays']

  return typeof value === 'number' ? value : null
}

/**
 * The payment term a document shows, and where it comes from: its own, or
 * the business's setting on its date. The setting is only known to whoever
 * may read the settings; everybody else learns that it applies, not what it
 * says.
 */
function termFact(own: number | null, setting: number | null): string {
  if (own !== null) {
    return `${paymentTermLabel(own)}, nur für diesen Beleg`
  }

  return setting === null
    ? 'aus den Einstellungen'
    : `${paymentTermLabel(setting)}, aus den Einstellungen`
}

/**
 * The notice of section 271a BGB for a term of this many days on this
 * document (#149), or null. Asked of the customer the document is for: the
 * paragraph covers a business and not a consumer.
 */
function termNotice(
  document: RecordState,
  customer: RecordState | null,
  days: number | null,
): string | null {
  if (days === null) {
    return null
  }

  return longPaymentTermNotice(shippedRules, {
    days,
    on: text(document, 'documentDate') as IsoDate,
    recipientIsBusiness: customer?.['isBusiness'] === true,
  })
}

/**
 * When the work was done, the way an invoice prints it: one day, or a period
 * from the first day to the last. Empty while nobody has entered it.
 */
function servicePeriod(document: RecordState): string {
  const from = maybeText(document, 'serviceFrom')
  const until = maybeText(document, 'serviceUntil')

  if (from === null) {
    return ''
  }

  return until === null || until === from ? date(from) : `${date(from)} bis ${date(until)}`
}

/** The business's payment term on the document's date, when this person may read it. */
function useSetting(document: RecordState): number | null {
  const statesTerm = statesPaymentTerm(documentKindOf(document))
  const readsSettings = useMay('settings.read')
  const history = useQuery({
    queryKey: ['parameters'],
    queryFn: parameterHistory,
    enabled: statesTerm && readsSettings,
  })

  return history.data ? paymentTermOn(history.data, text(document, 'documentDate')) : null
}

/**
 * "Kopf und Texte": what a document is about, when it was written, how it is
 * taxed, the payment term and the texts around its lines. An invoice adds
 * when the work was done, section 14 (4) number 6 UStG; a final invoice is not
 * issued without it.
 *
 * On a draft it is the form of the board "Angebot, Entwurf", open from the
 * start, with "Abbrechen" and "Speichern" in the head of the card. On a fixed
 * document it is the facts of "Schlussrechnung, festgeschrieben", with the
 * day payment is due where the document states one.
 */
export function HeaderCard({
  document,
  editable,
  billedCents,
}: {
  readonly document: RecordState
  readonly editable: boolean
  /** What the document asks for after its deductions, for the day it is due; null if unknown. */
  readonly billedCents: number | null
}) {
  const setting = useSetting(document)
  const customer = useRecord('customers', String(document['customerId']))

  return editable ? (
    <HeaderForm document={document} customer={customer} setting={setting} />
  ) : (
    <HeaderFacts
      document={document}
      customer={customer}
      setting={setting}
      billedCents={billedCents}
    />
  )
}

function HeaderFacts({
  document,
  customer,
  setting,
  billedCents,
}: {
  readonly document: RecordState
  readonly customer: RecordState | null
  readonly setting: number | null
  readonly billedCents: number | null
}) {
  const kind = documentKindOf(document)
  const statesTerm = statesPaymentTerm(kind)
  const own = ownTerm(document)
  const days = own ?? setting
  const notice = statesTerm ? termNotice(document, customer, days) : null
  // An invoice that asks for nothing states no day, as `paymentTermOf` has it.
  const dueOn =
    carriesDueDate(kind) && days !== null && billedCents !== null && billedCents > 0
      ? addDays(text(document, 'documentDate') as IsoDate, days)
      : null
  const intro = maybeText(document, 'introText')
  const closing = maybeText(document, 'closingText')

  const facts: Fact[] = [
    { label: 'Betreff', value: text(document, 'subject') },
    { label: 'Belegdatum', value: date(document['documentDate']) },
    ...(isInvoice(kind) ? [{ label: 'Leistungszeitraum', value: servicePeriod(document) }] : []),
    { label: 'Umsatzsteuer', value: taxTreatmentLabel[taxTreatmentOf(document)] },
    ...(statesTerm
      ? [
          {
            label: 'Zahlungsziel',
            value: (
              <>
                {termFact(own, setting)}
                {notice ? (
                  <span role="note" className="block font-semibold">
                    {notice}
                  </span>
                ) : null}
              </>
            ),
          },
        ]
      : []),
    ...(dueOn ? [{ label: 'Fällig', value: date(dueOn) }] : []),
    // The texts only where there are any: the board lists none, and a row
    // saying "nicht angegeben" twice under every quote says nothing.
    ...(intro
      ? [
          {
            label: 'Text über den Positionen',
            value: <span className="whitespace-pre-line">{intro}</span>,
          },
        ]
      : []),
    ...(closing
      ? [
          {
            label: 'Text unter den Positionen',
            value: <span className="whitespace-pre-line">{closing}</span>,
          },
        ]
      : []),
  ]

  return (
    <Panel title="Kopf und Texte">
      <FactList facts={facts} keyWidth={130} />
    </Panel>
  )
}

const treatmentOptions = taxTreatments.map((treatment) => ({
  value: treatment,
  label: taxTreatmentLabel[treatment],
}))

/** The fields of the head as typed, strings all of them, the way the form holds them. */
interface HeadValues {
  readonly subject: string
  readonly documentDate: string
  readonly serviceFrom: string
  readonly serviceUntil: string
  readonly taxTreatment: string
  readonly term: string
  readonly introText: string
  readonly closingText: string
}

function storedValues(document: RecordState): HeadValues {
  const own = ownTerm(document)

  return {
    subject: text(document, 'subject'),
    documentDate: text(document, 'documentDate'),
    serviceFrom: text(document, 'serviceFrom'),
    serviceUntil: text(document, 'serviceUntil'),
    taxTreatment: taxTreatmentOf(document),
    term: own === null ? '' : String(own),
    introText: text(document, 'introText'),
    closingText: text(document, 'closingText'),
  }
}

/**
 * The head of a draft, open as a form from the start.
 *
 * It holds only what somebody changed. Every other field shows what is
 * stored, so a change that comes in from another device while nobody types
 * shows here at once, and saving never writes back a value that was only
 * displayed. "Abbrechen" drops the changes, and both buttons wait while
 * there are none.
 */
function HeaderForm({
  document,
  customer,
  setting,
}: {
  readonly document: RecordState
  /** The customer the document is for, whose kind decides the notice of #149. */
  readonly customer: RecordState | null
  /** The business's payment term on the document's date, when it can be read. */
  readonly setting: number | null
}) {
  const client = useSync()
  const formId = useId()
  const [edits, setEdits] = useState<Partial<HeadValues>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const stored = storedValues(document)
  const values: HeadValues = { ...stored, ...edits }
  const changed = (Object.keys(edits) as (keyof HeadValues)[]).some(
    (field) => edits[field] !== stored[field],
  )
  const kind = documentKindOf(document)
  const invoice = isInvoice(kind)
  const statesTerm = statesPaymentTerm(kind)

  function set(field: keyof HeadValues) {
    return (value: string) => {
      setEdits((before) => ({ ...before, [field]: value }))
    }
  }

  // Empty is not a mistake here, it hands the document back to the setting.
  const termRead = values.term.trim() === '' ? null : daysFrom(values.term)
  const termProblem = termRead !== null && 'problem' in termRead ? termRead.problem : null
  const termAsTyped = termRead === null ? setting : 'days' in termRead ? termRead.days : null
  const notice = statesTerm
    ? termNotice({ ...document, documentDate: values.documentDate }, customer, termAsTyped)
    : null
  // The period as it is sent: a last day without a first is dropped below,
  // so it is no mistake here either.
  const periodProblem = invoice
    ? servicePeriodProblem(
        values.serviceFrom,
        values.serviceFrom.trim() === '' ? null : values.serviceUntil,
      )
    : null

  async function save(event: FormEvent) {
    event.preventDefault()

    // The server would refuse either with the same sentence; said here, it
    // never reaches the outbox, where a refusal would hold up everything
    // behind it. A service period that ended before it began did, until #118.
    const problem = periodProblem ?? termProblem

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const saved = await client.update('documents', String(document['id']), {
        subject: asTextOrNull(values.subject),
        documentDate: values.documentDate,
        // Only on an invoice, and there as entered: the first day alone is a
        // single day of work, and a last day without a first is not a period.
        ...(invoice
          ? {
              serviceFrom: asTextOrNull(values.serviceFrom),
              serviceUntil:
                asTextOrNull(values.serviceFrom) === null
                  ? null
                  : asTextOrNull(values.serviceUntil),
            }
          : {}),
        taxTreatment: values.taxTreatment,
        ...(statesTerm
          ? { paymentTermDays: termRead !== null && 'days' in termRead ? termRead.days : null }
          : {}),
        introText: asTextOrNull(values.introText),
        closingText: asTextOrNull(values.closingText),
      })

      if (saved.outcome === 'queued') {
        setEdits({})
      } else {
        setTrouble(refusalFor(saved))
      }
    } finally {
      setWorking(false)
    }
  }

  const shownSetting = setting === null ? '' : `, ${paymentTermLabel(setting)}`

  return (
    <Panel
      title="Kopf und Texte"
      action={
        <span className="flex gap-1.5">
          <Button
            size="small"
            disabled={working || !changed}
            onClick={() => {
              setEdits({})
              setTrouble(null)
            }}
          >
            Abbrechen
          </Button>
          <Button
            size="small"
            icon={Check}
            type="submit"
            form={formId}
            disabled={working || !changed}
          >
            {working ? 'Wird gespeichert' : 'Speichern'}
          </Button>
        </span>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)]">
          <Field
            label="Betreff"
            value={values.subject}
            onChange={(event) => {
              set('subject')(event.target.value)
            }}
          />
          <Field
            label="Belegdatum"
            type="date"
            required
            value={values.documentDate}
            onChange={(event) => {
              set('documentDate')(event.target.value)
            }}
          />
          <SelectField
            label="Umsatzsteuer"
            value={values.taxTreatment}
            options={treatmentOptions}
            hint="Beim Anlegen aus dem Kunden und den Angaben des Betriebs vorgeschlagen."
            onChange={set('taxTreatment')}
          />
          {statesTerm ? (
            <Field
              label="Zahlungsziel in Tagen"
              name="paymentTermDays"
              inputMode="numeric"
              numeric
              placeholder={setting === null ? undefined : String(setting)}
              value={values.term}
              onChange={(event) => {
                set('term')(event.target.value)
              }}
              {...(termProblem === null ? {} : { problem: termProblem })}
              hint={`Leer lassen für das Zahlungsziel aus den Einstellungen${shownSetting}. 0 heißt sofort zahlbar.`}
            />
          ) : null}
          {invoice ? (
            <>
              <Field
                label="Leistung von"
                type="date"
                hint="Der Tag der Arbeit, bei mehreren Tagen der erste."
                value={values.serviceFrom}
                onChange={(event) => {
                  set('serviceFrom')(event.target.value)
                }}
              />
              <Field
                label="Leistung bis"
                type="date"
                hint="Leer lassen, wenn es ein einziger Tag war."
                value={values.serviceUntil}
                onChange={(event) => {
                  set('serviceUntil')(event.target.value)
                }}
                {...(periodProblem === null ? {} : { problem: periodProblem })}
              />
            </>
          ) : null}
        </div>

        {notice ? (
          <div role="note">
            <NoteBox tone="waiting">{notice}</NoteBox>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <TextArea
              label="Text über den Positionen"
              value={values.introText}
              onChange={(event) => {
                set('introText')(event.target.value)
              }}
            />
            <SnippetPicker
              purpose="intro"
              label="Textbaustein für oben"
              onPick={(snippet) => {
                set('introText')(withSnippet(values.introText, snippet))
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <TextArea
              label="Text unter den Positionen"
              value={values.closingText}
              onChange={(event) => {
                set('closingText')(event.target.value)
              }}
            />
            <SnippetPicker
              purpose="closing"
              label="Textbaustein für unten"
              onPick={(snippet) => {
                set('closingText')(withSnippet(values.closingText, snippet))
              }}
            />
          </div>
        </div>

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </form>
    </Panel>
  )
}
