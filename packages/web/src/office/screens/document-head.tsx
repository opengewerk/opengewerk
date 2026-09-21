import type { RecordState } from '@opengewerk/domain'
import { isInvoice, taxTreatments } from '@opengewerk/domain'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field, SelectField, TextArea } from '../../components/index.js'
import { date } from '../../app/format.js'
import { documentKindOf, taxTreatmentLabel, taxTreatmentOf } from '../../app/labels.js'
import { asTextOrNull } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useSync } from '../../sync/provider.js'
import { Fact, Facts, Section } from '../layout.js'
import { SnippetPicker, withSnippet } from './snippet-picker.js'

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
 */
export function HeaderSection({
  document,
  editable,
}: {
  readonly document: RecordState
  readonly editable: boolean
}) {
  const [editing, setEditing] = useState(false)

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
  onDone,
}: {
  readonly document: RecordState
  readonly onDone: () => void
}) {
  const client = useSync()
  const [subject, setSubject] = useState(text(document, 'subject'))
  const [documentDate, setDocumentDate] = useState(text(document, 'documentDate'))
  const [serviceFrom, setServiceFrom] = useState(text(document, 'serviceFrom'))
  const [serviceUntil, setServiceUntil] = useState(text(document, 'serviceUntil'))
  const invoice = isInvoice(documentKindOf(document))
  const [treatment, setTreatment] = useState<string>(taxTreatmentOf(document))
  const [introText, setIntroText] = useState(text(document, 'introText'))
  const [closingText, setClosingText] = useState(text(document, 'closingText'))
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
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
