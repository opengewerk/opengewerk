import type { RecordState } from '@opengewerk/domain'
import { taxTreatments } from '@opengewerk/domain'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field, SelectField, TextArea } from '../../components/index.js'
import { date } from '../../app/format.js'
import { taxTreatmentLabel, taxTreatmentOf } from '../../app/labels.js'
import { asTextOrNull } from '../../app/record-form.js'
import { refusalText } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useSync } from '../../sync/provider.js'
import { Fact, Facts, Section } from '../layout.js'
import { SnippetPicker, withSnippet } from './snippet-picker.js'

/**
 * The head of a document and the texts around its lines: what it is about,
 * when it was written, how it is taxed, and what it says before and after the
 * positions.
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
