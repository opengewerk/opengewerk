import {
  filledMailSubject,
  filledMailText,
  type MailFacts,
  type MailOccasion,
  mailOccasionLabel,
  mailOccasions,
  mailPlaceholderLabel,
  mailPlaceholders,
  shippedMails,
  type SnippetPurpose,
  snippetPurposes,
} from '@opengewerk/domain'
import { Button, Confirm, Field, Panel, SelectField, TextArea } from '@opengewerk/platform-web'
import { PageHead, Screen } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { snippetPurposeLabel } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import {
  createSnippet,
  removeSnippet,
  textSnippets,
  updateSnippet,
} from '../../session/documents.js'
import type { SnippetValues, TextSnippet } from '../../session/documents.js'

const purposeOptions = snippetPurposes.map((purpose) => ({
  value: purpose,
  label: snippetPurposeLabel[purpose],
}))

/** The heading each list gets, in the plural of what is in it. */
const listTitle: Readonly<Record<SnippetPurpose, string>> = {
  line: 'Positionen',
  intro: 'Texte über den Positionen',
  closing: 'Texte unter den Positionen',
  mail: 'Texte für E-Mails',
}

/** What each list is for, in one sentence under its heading. */
const listHint: Readonly<Record<SnippetPurpose, string>> = {
  line: 'Der Name wird zur Bezeichnung der Position, der Text zu ihrer Beschreibung.',
  intro: 'Die Anrede und der Anlass, etwa der Dank für die Anfrage.',
  closing: 'Der Schluss, etwa wie lange ein Angebot gilt und ein Gruß.',
  mail: 'Der Betreff steht als Name in der Liste, der Text ist die E-Mail. Für einen Anlass ohne eigenen Text gilt der mitgelieferte.',
}

const occasionOptions = mailOccasions.map((occasion) => ({
  value: occasion,
  label: mailOccasionLabel[occasion],
}))

/**
 * The values the preview fills in, the story of the board "Textbaustein für
 * eine E-Mail" (#315): a call about a fuse, an appointment on a Wednesday.
 * An automatic mail has nobody who sends it, so `{benutzer}` stays empty.
 */
const exampleFacts: MailFacts = {
  kunde: 'Klaus Lehmann',
  termin: 'Mittwoch, 04.11.2026, 13:30 bis 15:00 Uhr',
  auftrag: 'AU-2026-0233 Sicherung Küche löst aus',
  benutzer: null,
  briefkopf: 'Elektro Nord GmbH',
}

/** What the mail of an occasion carries besides its text. */
function attachmentOf(occasion: MailOccasion): string {
  return occasion === 'job_received'
    ? 'Für einen Verbraucher hängen die Belehrungen als PDF an, mit einem Satz dazu unter dem Text.'
    : 'Dazu die Kalenderdatei Termin.ics.'
}

/** The mail as a customer reads it, with example values, as the card "Vorschau" of the board has it. */
function MailPreview({
  occasion,
  subject,
  text,
}: {
  readonly occasion: MailOccasion
  readonly subject: string
  readonly text: string
}) {
  return (
    <Panel title="Vorschau">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] text-ink-muted">
          So liest es ein Kunde bei „{mailOccasionLabel[occasion]}“, mit Beispielwerten.
        </p>
        <p className="text-[14px] font-semibold">{filledMailSubject(subject, exampleFacts)}</p>
        <p className="whitespace-pre-line text-[13px] leading-[1.5]">
          {filledMailText(text, exampleFacts)}
        </p>
        <p className="text-[13px] text-ink-muted">
          Darunter steht die Signatur des Betriebs aus den E-Mail-Einstellungen.{' '}
          {attachmentOf(occasion)}
        </p>
      </div>
    </Panel>
  )
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
  const [occasion, setOccasion] = useState<MailOccasion>(
    snippet?.mailOccasion ?? 'appointment_arranged',
  )
  const [title, setTitle] = useState(snippet?.title ?? '')
  const [body, setBody] = useState(snippet?.text ?? '')
  const mail = purpose === 'mail'

  /** A new text for mails starts from the shipped one of its occasion. */
  function startFrom(next: MailOccasion) {
    if (adding) {
      setTitle(shippedMails[next].subject)
      setBody(shippedMails[next].text)
    }
  }
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    const values: SnippetValues = {
      purpose: purpose as SnippetPurpose,
      title,
      text: body,
      mailOccasion: mail ? occasion : null,
    }

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

  const form = (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Wofür"
          value={purpose}
          options={purposeOptions}
          onChange={(next) => {
            setPurpose(next)

            if (next === 'mail' && title === '' && body === '') {
              startFrom(occasion)
            }
          }}
        />
        {mail ? (
          <SelectField
            label="Anlass"
            value={occasion}
            options={occasionOptions}
            hint="Je Anlass ein Text. Ohne eigenen gilt der mitgelieferte."
            onChange={(next) => {
              setOccasion(next as MailOccasion)
              startFrom(next as MailOccasion)
            }}
          />
        ) : (
          <Field
            label="Name"
            required
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
          />
        )}
      </div>
      {mail ? (
        <Field
          label="Betreff"
          required
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
          }}
        />
      ) : null}
      <TextArea
        label="Text"
        rows={mail ? 8 : 6}
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
        }}
      />
      {mail ? (
        <div className="text-[13px] text-ink-muted">
          <p className="font-semibold text-ink">Platzhalter</p>
          <ul className="list-disc pl-[18px] leading-[1.55]">
            {mailPlaceholders.map((key) => (
              <li key={key}>
                <code className="font-semibold font-sans">{`{${key}}`}</code>{' '}
                {mailPlaceholderLabel[key]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

  return mail ? (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      {form}
      <MailPreview occasion={occasion} subject={title} text={body} />
    </div>
  ) : (
    form
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
        <p className="flex flex-wrap items-baseline gap-2 text-[14px] font-semibold text-ink">
          {snippet.title}
          {snippet.mailOccasion ? (
            <span className="rounded-control border border-control bg-surface px-[9px] text-[13px] font-normal">
              {mailOccasionLabel[snippet.mailOccasion]}
            </span>
          ) : null}
        </p>
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
        sub="Texte für Positionen, für den Text über und unter den Positionen eines Belegs und für E-Mails."
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
      <SnippetList purpose="mail" snippets={all} editable={editable} />
    </Screen>
  )
}
