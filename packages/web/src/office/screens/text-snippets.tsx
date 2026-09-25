import type { SnippetPurpose } from '@opengewerk/domain'
import { snippetPurposes } from '@opengewerk/domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Confirm, Field, Panel, SelectField, TextArea } from '../../components/index.js'
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
import { PageHead, Screen } from '../kit.js'

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
  // A new one is the one thing the screen is doing while its card is open,
  // and the head's button waits for it; a change beside the list is not, and
  // leaves the copper to the head (#223).
  const adding = snippet === undefined
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
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
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

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button disabled={working} onClick={onDone}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          tone={adding ? 'primary' : 'secondary'}
          icon={Check}
          disabled={working}
        >
          {working ? 'Wird gespeichert' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

/**
 * One text in its list, as the board "Textbausteine" draws it: the name, the
 * text under it, and at the right "Bearbeiten" and "Entfernen". Entfernen asks
 * first, as everything that goes does (#222).
 */
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
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function remove() {
    setTrouble(null)
    setWorking(true)

    try {
      await removeSnippet(snippet.id)
      await queries.invalidateQueries({ queryKey: ['text-snippets'] })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : 'Keine Verbindung.')
    } finally {
      setWorking(false)
      setRemoving(false)
    }
  }

  if (editing) {
    return (
      <li className="border-b border-row py-[9px]">
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
    <li className="flex flex-wrap items-start gap-3 border-b border-row py-[9px]">
      <div className="min-w-0 grow basis-[240px]">
        <p className="text-[14px] font-semibold text-ink">{snippet.title}</p>
        {snippet.text ? (
          <p className="whitespace-pre-line text-[13px] leading-[1.45] text-ink-muted">
            {snippet.text}
          </p>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
      {editable ? (
        <span className="ml-auto flex shrink-0 gap-1.5">
          <Button
            size="small"
            icon={Pencil}
            aria-label={`${snippet.title} bearbeiten`}
            onClick={() => {
              setEditing(true)
            }}
          >
            Bearbeiten
          </Button>
          <Button
            size="small"
            aria-label={`${snippet.title} entfernen`}
            onClick={() => {
              setRemoving(true)
            }}
          >
            Entfernen
          </Button>
        </span>
      ) : null}
      <Confirm
        open={removing}
        title={`${snippet.title} entfernen?`}
        confirm="Entfernen"
        busy={working}
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(false)
        }}
      >
        Der Textbaustein verschwindet aus der Auswahl. Belege, die ihn schon verwenden, behalten
        ihren Text.
      </Confirm>
    </li>
  )
}

/** One of the three lists, as a card with its sentence under the heading. */
function SnippetList({
  purpose,
  snippets,
  editable,
}: {
  readonly purpose: SnippetPurpose
  readonly snippets: readonly TextSnippet[]
  readonly editable: boolean
}) {
  const listed = snippets.filter((snippet) => snippet.purpose === purpose)

  return (
    <Panel title={listTitle[purpose]}>
      <p className="-mt-[3px] mb-1.5 text-[13px] text-ink-faint">{listHint[purpose]}</p>
      {listed.length === 0 ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">Noch keiner.</p>
      ) : (
        <ul>
          {listed.map((snippet) => (
            <SnippetEntry key={snippet.id} snippet={snippet} editable={editable} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * The texts the office writes once and uses again, in three lists: for
 * positions, and for the text above and below them, laid out as the board
 * "Textbausteine" has them.
 *
 * Changing one here changes nothing that was written with it. A document
 * takes a copy of the text, so a quote from last year still says what it
 * said when it went out.
 */
export function TextSnippetScreen() {
  const snippets = useQuery({ queryKey: ['text-snippets'], queryFn: textSnippets })
  const editable = useMay('document.write')
  const [adding, setAdding] = useState(false)
  const all = snippets.data ?? []

  return (
    <Screen>
      <PageHead
        title="Textbausteine"
        sub="Texte für Positionen und für den Text über und unter den Positionen eines Belegs."
        wideActions
        actions={
          editable ? (
            <Button
              tone="primary"
              icon={Plus}
              disabled={adding}
              onClick={() => {
                setAdding(true)
              }}
            >
              Textbaustein anlegen
            </Button>
          ) : null
        }
      />

      {adding ? (
        <Panel title="Neuer Textbaustein">
          <SnippetForm
            submitLabel="Textbaustein anlegen"
            onDone={() => {
              setAdding(false)
            }}
          />
        </Panel>
      ) : null}

      {snippets.isError ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          Die Textbausteine ließen sich nicht laden. Sie liegen auf dem Server und brauchen eine
          Verbindung.
        </p>
      ) : null}

      <SnippetList purpose="line" snippets={all} editable={editable} />
      <div className="grid gap-3 lg:grid-cols-2">
        <SnippetList purpose="intro" snippets={all} editable={editable} />
        <SnippetList purpose="closing" snippets={all} editable={editable} />
      </div>
    </Screen>
  )
}
