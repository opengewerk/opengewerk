import type { RecordState } from '@opengewerk/domain'
import {
  isInvoice,
  paymentTermLabel,
  servicePeriodProblem,
  statesPaymentTerm,
  taxTreatments,
} from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field, SelectField, TextArea } from '../../components/index.js'
import { date } from '../../app/format.js'
import { documentKindOf, taxTreatmentLabel, taxTreatmentOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { asTextOrNull } from '../../app/record-form.js'
import { parameterHistory } from '../../session/parameters.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useSync } from '../../sync/provider.js'
import { Fact, Facts, Section } from '../layout.js'
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

/**
 * The head of a document and the texts around its lines: what it is about,
 * when it was written, how it is taxed, and what it says before and after the
 * positions. An invoice adds when the work was done, section 14 (4) number 6
 * UStG; a final invoice is not issued without it.
 *
 * Every kind that states a payment term shows it here, and here it is
 * overridden for this one document. Left empty, the business's setting of
 * the document's date applies, and that is what the head says.
 */
export function HeaderSection({
  document,
  editable,
}: {
  readonly document: RecordState
  readonly editable: boolean
}) {
  const [editing, setEditing] = useState(false)
  const statesTerm = statesPaymentTerm(documentKindOf(document))
  const readsSettings = useMay('settings.read')
  const history = useQuery({
    queryKey: ['parameters'],
    queryFn: parameterHistory,
    enabled: statesTerm && readsSettings,
  })
  const setting = history.data ? paymentTermOn(history.data, text(document, 'documentDate')) : null

  return (
    <Section
      title="Kopf und Texte"
      actions={
        editable ? (
          <Button
            onClick={() => {
              setEditing((open) => !open)
            }}
          >
            {editing ? 'Bearbeiten beenden' : 'Bearbeiten'}
          </Button>
        ) : null
      }
    >
      {editing && editable ? (
        <HeaderForm
          document={document}
          setting={setting}
          onDone={() => {
            setEditing(false)
          }}
        />
      ) : (
        <Facts>
          <Fact label="Betreff">{text(document, 'subject')}</Fact>
          <Fact label="Belegdatum">{date(document['documentDate'])}</Fact>
          {isInvoice(documentKindOf(document)) ? (
            <Fact label="Leistungszeitraum">{servicePeriod(document)}</Fact>
          ) : null}
          <Fact label="Umsatzsteuer">{taxTreatmentLabel[taxTreatmentOf(document)]}</Fact>
          {statesTerm ? (
            <Fact label="Zahlungsziel">{termFact(ownTerm(document), setting)}</Fact>
          ) : null}
          <Fact label="Text über den Positionen">
            {maybeText(document, 'introText') ? (
              <span className="whitespace-pre-line">{text(document, 'introText')}</span>
            ) : null}
          </Fact>
          <Fact label="Text unter den Positionen">
            {maybeText(document, 'closingText') ? (
              <span className="whitespace-pre-line">{text(document, 'closingText')}</span>
            ) : null}
          </Fact>
        </Facts>
      )}
    </Section>
  )
}

const treatmentOptions = taxTreatments.map((treatment) => ({
  value: treatment,
  label: taxTreatmentLabel[treatment],
}))

function HeaderForm({
  document,
  setting,
  onDone,
}: {
  readonly document: RecordState
  /** The business's payment term on the document's date, when it can be read. */
  readonly setting: number | null
  readonly onDone: () => void
}) {
  const client = useSync()
  const [subject, setSubject] = useState(text(document, 'subject'))
  const [documentDate, setDocumentDate] = useState(text(document, 'documentDate'))
  const [serviceFrom, setServiceFrom] = useState(text(document, 'serviceFrom'))
  const [serviceUntil, setServiceUntil] = useState(text(document, 'serviceUntil'))
  const invoice = isInvoice(documentKindOf(document))
  const statesTerm = statesPaymentTerm(documentKindOf(document))
  const [treatment, setTreatment] = useState<string>(taxTreatmentOf(document))
  const [term, setTerm] = useState(() => {
    const own = ownTerm(document)

    return own === null ? '' : String(own)
  })
  const [introText, setIntroText] = useState(text(document, 'introText'))
  const [closingText, setClosingText] = useState(text(document, 'closingText'))
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  // Empty is not a mistake here, it hands the document back to the setting.
  const termRead = term.trim() === '' ? null : daysFrom(term)
  const termProblem = termRead !== null && 'problem' in termRead ? termRead.problem : null
  // The period as it is sent: a last day without a first is dropped below,
  // so it is no mistake here either.
  const periodProblem = invoice
    ? servicePeriodProblem(serviceFrom, serviceFrom.trim() === '' ? null : serviceUntil)
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
        subject: asTextOrNull(subject),
        documentDate,
        // Only on an invoice, and there as entered: the first day alone is a
        // single day of work, and a last day without a first is not a period.
        ...(invoice
          ? {
              serviceFrom: asTextOrNull(serviceFrom),
              serviceUntil: asTextOrNull(serviceFrom) === null ? null : asTextOrNull(serviceUntil),
            }
          : {}),
        taxTreatment: treatment,
        ...(statesTerm
          ? { paymentTermDays: termRead !== null && 'days' in termRead ? termRead.days : null }
          : {}),
        introText: asTextOrNull(introText),
        closingText: asTextOrNull(closingText),
      })

      if (saved.outcome === 'queued') {
        onDone()
      } else {
        setTrouble(refusalText[saved.reason])
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Betreff"
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value)
          }}
        />
        <Field
          label="Belegdatum"
          type="date"
          required
          value={documentDate}
          onChange={(event) => {
            setDocumentDate(event.target.value)
          }}
        />
        {invoice ? (
          <>
            <Field
              label="Leistung von"
              type="date"
              hint="Der Tag der Arbeit, bei mehreren Tagen der erste."
              value={serviceFrom}
              onChange={(event) => {
                setServiceFrom(event.target.value)
              }}
            />
            <Field
              label="Leistung bis"
              type="date"
              hint="Leer lassen, wenn es ein einziger Tag war."
              value={serviceUntil}
              onChange={(event) => {
                setServiceUntil(event.target.value)
              }}
              {...(periodProblem === null ? {} : { problem: periodProblem })}
            />
          </>
        ) : null}
        <SelectField
          label="Umsatzsteuer"
          value={treatment}
          options={treatmentOptions}
          hint="Beim Anlegen aus dem Kunden und den Angaben des Betriebs vorgeschlagen."
          onChange={setTreatment}
        />
        {statesTerm ? (
          <Field
            label="Zahlungsziel in Tagen"
            name="paymentTermDays"
            inputMode="numeric"
            numeric
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
            }}
            {...(termProblem === null ? {} : { problem: termProblem })}
            hint={
              setting === null
                ? 'Leer lassen für das Zahlungsziel aus den Einstellungen. 0 heißt sofort zahlbar.'
                : `Leer lassen für das Zahlungsziel aus den Einstellungen, ${paymentTermLabel(setting)}. ` +
                  '0 heißt sofort zahlbar.'
            }
          />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <TextArea
            label="Text über den Positionen"
            value={introText}
            onChange={(event) => {
              setIntroText(event.target.value)
            }}
          />
          <SnippetPicker
            purpose="intro"
            label="Textbaustein für oben"
            onPick={(snippet) => {
              setIntroText((current) => withSnippet(current, snippet))
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <TextArea
            label="Text unter den Positionen"
            value={closingText}
            onChange={(event) => {
              setClosingText(event.target.value)
            }}
          />
          <SnippetPicker
            purpose="closing"
            label="Textbaustein für unten"
            onPick={(snippet) => {
              setClosingText((current) => withSnippet(current, snippet))
            }}
          />
        </div>
      </div>

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary" disabled={working}>
          {working ? 'Wird gespeichert' : 'Speichern'}
        </Button>
        <Button tone="quiet" disabled={working} onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}
