import type { SnippetPurpose } from '@opengewerk/domain'
import { snippetPurposes } from '@opengewerk/domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Card, Field, SelectField, TextArea } from '../../components/index.js'
import { snippetPurposeLabel } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import {
  createSnippet,
  removeSnippet,
  textSnippets,
  updateSnippet,
} from '../../session/documents.js'
import type { SnippetValues, TextSnippet } from '../../session/documents.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'

const purposeOptions = snippetPurposes.map((purpose) => ({
  value: purpose,
  label: snippetPurposeLabel[purpose],
}))

/** The heading each list gets, in the plural of what is in it. */
const listTitle: Readonly<Record<SnippetPurpose, string>> = {
  line: 'Positionen',
  intro: 'Texte über den Positionen',
  closing: 'Texte unter den Positionen',
}

/** What each list is for, in one sentence under its heading. */
const listHint: Readonly<Record<SnippetPurpose, string>> = {
  line: 'Der Name wird zur Bezeichnung der Position, der Text zu ihrer Beschreibung.',
  intro: 'Die Anrede und der Anlass, etwa der Dank für die Anfrage.',
  closing: 'Der Schluss, etwa wie lange ein Angebot gilt und ein Gruß.',
}

function SnippetForm({
  snippet,
  submitLabel,
  onDone,
}: {
  readonly snippet?: TextSnippet
  readonly submitLabel: string
  readonly onDone: () => void
}) {
  const queries = useQueryClient()
  const [purpose, setPurpose] = useState<string>(snippet?.purpose ?? 'line')
  const [title, setTitle] = useState(snippet?.title ?? '')
  const [body, setBody] = useState(snippet?.text ?? '')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    const values: SnippetValues = { purpose: purpose as SnippetPurpose, title, text: body }

    try {
      await (snippet ? updateSnippet(snippet.id, values) : createSnippet(values))
      await queries.invalidateQueries({ queryKey: ['text-snippets'] })
      onDone()
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Textbausteine werden mit Verbindung gespeichert.',
      )
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
        <SelectField label="Wofür" value={purpose} options={purposeOptions} onChange={setPurpose} />
        <Field
          label="Name"
          required
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
          }}
        />
      </div>
      <TextArea
        label="Text"
        rows={6}
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
        }}
      />

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary" disabled={working}>
          {working ? 'Wird gespeichert' : submitLabel}
        </Button>
        <Button tone="quiet" disabled={working} onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

function SnippetEntry({
  snippet,
  editable,
}: {
  readonly snippet: TextSnippet
  readonly editable: boolean
}) {
  const queries = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function remove() {
    setTrouble(null)

    try {
      await removeSnippet(snippet.id)
      await queries.invalidateQueries({ queryKey: ['text-snippets'] })
    } catch (error) {
      setRemoving(false)
      setTrouble(error instanceof RequestRefused ? error.message : 'Keine Verbindung.')
    }
  }

  if (editing) {
    return (
      <li>
        <SnippetForm
          snippet={snippet}
          submitLabel="Speichern"
          onDone={() => {
            setEditing(false)
          }}
        />
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-1 border-b border-line pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">{snippet.title}</span>
        {editable ? (
          removing ? (
            <span className="inline-flex flex-wrap gap-2">
              <Button tone="danger" onClick={() => void remove()}>
                Entfernen
              </Button>
              <Button
                tone="quiet"
                onClick={() => {
                  setRemoving(false)
                }}
              >
                Behalten
              </Button>
            </span>
          ) : (
            <span className="inline-flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setEditing(true)
                }}
              >
                Bearbeiten
              </Button>
              <Button
                tone="quiet"
                aria-label={`${snippet.title} entfernen`}
                onClick={() => {
                  setRemoving(true)
                }}
              >
                Entfernen
              </Button>
            </span>
          )
        ) : null}
      </div>
      {snippet.text ? (
        <p className="whitespace-pre-line text-body text-ink-muted">{snippet.text}</p>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </li>
  )
}

/**
 * The texts the office writes once and uses again, in three lists: for
 * positions, and for the text above and below them.
 *
 * Changing one here changes nothing that was written with it. A document
 * takes a copy of the text, so a quote from last year still says what it
 * said when it went out.
 */
export function TextSnippetScreen() {
  const snippets = useQuery({ queryKey: ['text-snippets'], queryFn: textSnippets })
  const editable = useMay('document.write')
  const [adding, setAdding] = useState(false)

  return (
    <Page
      title="Textbausteine"
      meta="Texte für Positionen und für den Text über und unter den Positionen eines Belegs."
      actions={
        editable && !adding ? (
          <Button
            tone="primary"
            onClick={() => {
              setAdding(true)
            }}
          >
            Textbaustein anlegen
          </Button>
        ) : null
      }
    >
      {adding ? (
        <Card label="Neuer Textbaustein">
          <SnippetForm
            submitLabel="Textbaustein anlegen"
            onDone={() => {
              setAdding(false)
            }}
          />
        </Card>
      ) : null}

      {snippets.isError ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          Die Textbausteine ließen sich nicht laden. Sie liegen auf dem Server und brauchen eine
          Verbindung.
        </p>
      ) : null}

      {snippetPurposes.map((purpose) => {
        const listed = (snippets.data ?? []).filter((snippet) => snippet.purpose === purpose)

        return (
          <Section key={purpose} title={listTitle[purpose]}>
            <p className="mb-3 text-table text-ink-muted">{listHint[purpose]}</p>
            {listed.length === 0 ? (
              <Nothing>Noch keiner.</Nothing>
            ) : (
              <ul className="flex flex-col gap-3">
                {listed.map((snippet) => (
                  <SnippetEntry key={snippet.id} snippet={snippet} editable={editable} />
                ))}
              </ul>
            )}
          </Section>
        )
      })}
    </Page>
  )
}
