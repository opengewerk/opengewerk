import {
  type DocumentKind,
  documentKinds,
  type InstructionTemplate,
  instructionBlocks,
  instructionPlaceholders,
  normalizedWording,
} from '@opengewerk/domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Card, Field, TextArea } from '../../components/index.js'
import { date } from '../../app/format.js'
import { documentKindLabel } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import {
  createInstruction,
  type InstructionView,
  instructions,
  removeInstruction,
  restoreInstruction,
  updateInstruction,
} from '../../session/instructions.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'

const queryKey = ['instructions']

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** "Angebot", "Angebot und Kostenvoranschlag", "Angebot, Auftragsbestätigung und Rechnung". */
function inWords(parts: readonly string[]): string {
  return parts.length <= 1
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} und ${parts.at(-1) ?? ''}`
}

/**
 * What a changed model costs, in the words the screen says it in. Only the two
 * that are the law's own words lose something; the sheet for an early start
 * is OpenGewerk's wording and gets a reminder of what it has to keep saying.
 */
const changedWarning: Readonly<Record<InstructionTemplate, string>> = {
  withdrawal:
    'Der Wortlaut weicht vom gesetzlichen Muster ab. Nur das Muster, zutreffend ausgefüllt und ' +
    'in Textform übermittelt, erfüllt die Pflicht zur Belehrung sicher (Art. 246a § 1 Abs. 2 ' +
    'Satz 2 EGBGB). Genügt eine geänderte Belehrung nicht, beginnt die Widerrufsfrist nicht, und ' +
    'der Kunde kann bis zu zwölf Monate und 14 Tage lang widerrufen (§ 356 Abs. 3 und 4 BGB).',
  withdrawal_form:
    'Das Formular weicht vom gesetzlichen Muster ab. Der Kunde muss das Muster-Widerrufsformular ' +
    'der Anlage 2 bekommen (Art. 246a § 1 Abs. 2 Satz 1 Nr. 1 EGBGB), und ein geändertes ist ' +
    'dieses Muster nicht mehr.',
  early_start:
    'Der Vordruck ist kein gesetzliches Muster, eine Änderung kostet keine Absicherung. Er sollte ' +
    'aber weiter sagen, dass der Kunde den Beginn vor Ablauf der Widerrufsfrist ausdrücklich ' +
    'verlangt und dass er weiß, dass sein Widerrufsrecht mit der vollständigen Erfüllung erlischt ' +
    '(§ 356 Abs. 5 Nr. 2 und § 357a Abs. 2 BGB).',
}

/** Whether a template is the law's words, so that changing it costs the safe harbour. */
function isStatutory(template: InstructionTemplate | null): boolean {
  return template === 'withdrawal' || template === 'withdrawal_form'
}

/**
 * The words of an instruction the way they are printed: headings, paragraphs,
 * points and lines to write on. Placeholders stay as they are, because here
 * the words are looked at before any document fills them.
 */
export function InstructionText({ text }: { readonly text: string }) {
  return (
    <div className="flex flex-col gap-2 text-body">
      {instructionBlocks(text).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h3 key={index} className="mt-2 font-semibold">
                {block.text}
              </h3>
            )
          case 'item':
            return (
              <p key={index} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span className="whitespace-pre-line">{block.text}</span>
              </p>
            )
          case 'line':
            return <div key={index} className="h-5 border-b border-line-strong" />
          case 'paragraph':
            return (
              <p key={index} className="whitespace-pre-line">
                {block.text}
              </p>
            )
        }
      })}
    </div>
  )
}

/** Which kinds, whom and whether it goes out with the document, in two sentences. */
function Summary({ instruction }: { readonly instruction: InstructionView }) {
  const kinds = documentKinds.filter((kind) => instruction.kinds.includes(kind))

  return (
    <p className="text-table text-ink-muted">
      {kinds.length === 0
        ? 'Zu keinem Beleg vorgeschlagen.'
        : `Vorgeschlagen für ${inWords(kinds.map((kind) => documentKindLabel[kind]))}` +
          (instruction.consumersOnly ? ', nur an Kunden, die kein Unternehmen sind.' : '.')}{' '}
      {instruction.withDocument
        ? 'Geht mit dem Beleg hinaus, im PDF nach dem Beleg und damit auch in der E-Mail.'
        : 'Liegt am Beleg als eigenes Blatt zum Ausdrucken bereit.'}
    </p>
  )
}

function Placeholders() {
  return (
    <details className="text-table text-ink-muted">
      <summary className="cursor-pointer font-semibold text-ink">
        Platzhalter und Gestaltung
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {Object.entries(instructionPlaceholders).map(([token, meaning]) => (
          <li key={token}>
            <code className="font-mono text-ink">{token}</code>: {meaning}
          </li>
        ))}
      </ul>
      <p className="mt-2">
        Eine Zeile mit # am Anfang wird zur Zwischenüberschrift, eine mit - zum Aufzählungspunkt,
        eine Zeile aus ___ zur Linie zum Ausfüllen. Eine leere Zeile beginnt einen neuen Absatz.
      </p>
    </details>
  )
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-body">
      <input
        type="checkbox"
        className="size-5"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      {label}
    </label>
  )
}

/**
 * Writing an instruction or changing one. For a shipped one the words may
 * change and the heading may not, and the moment the words leave the model
 * the form says what that costs, before anything is saved.
 */
function InstructionForm({
  instruction,
  onDone,
}: {
  readonly instruction?: InstructionView
  readonly onDone: () => void
}) {
  const queries = useQueryClient()
  const template = instruction?.template ?? null
  const [title, setTitle] = useState(instruction?.title ?? '')
  const [body, setBody] = useState(instruction?.body ?? '')
  const [kinds, setKinds] = useState<readonly DocumentKind[]>(instruction?.kinds ?? [])
  const [consumersOnly, setConsumersOnly] = useState(instruction?.consumersOnly ?? false)
  const [withDocument, setWithDocument] = useState(instruction?.withDocument ?? true)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const model = instruction?.model ?? null
  const leavesModel =
    template !== null && model !== null && normalizedWording(body) !== normalizedWording(model.text)

  async function save(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    const settings = { kinds, consumersOnly, withDocument }

    try {
      if (instruction) {
        // The words only when they were edited. Sent again unchanged, a changed
        // model would count as looked at, and the notice of a newer version of
        // the law would go away because somebody ticked a kind of document.
        await updateInstruction(instruction.id, {
          ...settings,
          ...(body === instruction.body ? {} : { body }),
          ...(template === null ? { title } : {}),
        })
      } else {
        await createInstruction({ ...settings, title, body })
      }

      await queries.invalidateQueries({ queryKey })
      onDone()
    } catch (error) {
      setTrouble(saidWhy(error, 'Keine Verbindung. Belehrungen werden mit Verbindung gespeichert.'))
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
      {template === null ? (
        <Field
          label="Überschrift"
          required
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
          }}
        />
      ) : null}
      <TextArea
        label="Wortlaut"
        rows={16}
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
        }}
      />
      <Placeholders />

      {leavesModel ? (
        <div role="note" className="rounded-control border border-conflict p-3 text-body">
          <p className="font-semibold text-conflict">
            {isStatutory(template) ? 'Geändertes Muster' : 'Geänderter Vordruck'}
          </p>
          <p className="mt-1">{changedWarning[template]}</p>
          <p className="mt-1 text-table text-ink-muted">
            Der ursprüngliche Wortlaut lässt sich jederzeit wiederherstellen.
          </p>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-body font-medium text-ink">Vorgeschlagen für</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {documentKinds.map((kind) => (
            <Check
              key={kind}
              label={documentKindLabel[kind]}
              checked={kinds.includes(kind)}
              onChange={(checked) => {
                setKinds(
                  checked
                    ? documentKinds.filter((each) => each === kind || kinds.includes(each))
                    : kinds.filter((each) => each !== kind),
                )
              }}
            />
          ))}
        </div>
      </fieldset>
      <Check
        label="Nur für Kunden, die kein Unternehmen sind"
        checked={consumersOnly}
        onChange={setConsumersOnly}
      />
      <div className="flex flex-col gap-1">
        <Check
          label="Geht mit dem Beleg hinaus"
          checked={withDocument}
          onChange={setWithDocument}
        />
        <p className="text-table text-ink-muted">
          Dann steht die Belehrung im PDF nach dem Beleg, auf Papier wie in der E-Mail. Sonst liegt
          sie am Beleg als eigenes Blatt zum Ausdrucken bereit.
        </p>
      </div>

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary" disabled={working}>
          {working
            ? 'Wird gespeichert'
            : instruction
              ? leavesModel && isStatutory(template)
                ? 'Geändert speichern'
                : 'Speichern'
              : 'Belehrung anlegen'}
        </Button>
        <Button tone="quiet" disabled={working} onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/** Where a shipped instruction comes from, or that the business wrote it. */
function origin(instruction: InstructionView): string {
  if (instruction.template === null) {
    return 'Eigene Belehrung'
  }

  // The sheet for an early start ships like the models and is none: the law
  // has no model for it, and the screen does not pretend otherwise.
  const shipped = isStatutory(instruction.template)
    ? 'Mitgeliefertes Muster'
    : 'Mitgelieferter Vordruck'
  const since = instruction.model ? `, Fassung ab ${date(instruction.model.validFrom)}` : ''

  return instruction.changed ? `${shipped}, vom Betrieb geändert${since}` : `${shipped}${since}`
}

function InstructionEntry({
  instruction,
  mayWrite,
}: {
  readonly instruction: InstructionView
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function act(action: () => Promise<unknown>) {
    setWorking(true)
    setTrouble(null)

    try {
      await action()
      await queries.invalidateQueries({ queryKey })
    } catch (error) {
      setRemoving(false)
      setTrouble(saidWhy(error, 'Keine Verbindung.'))
    } finally {
      setWorking(false)
    }
  }

  const actions = mayWrite ? (
    <span className="inline-flex flex-wrap gap-2">
      {editing ? null : (
        <Button
          onClick={() => {
            setEditing(true)
          }}
        >
          Bearbeiten
        </Button>
      )}
      {instruction.changed && !editing ? (
        <Button
          tone="quiet"
          disabled={working}
          onClick={() => void act(() => restoreInstruction(instruction.id))}
        >
          Original wiederherstellen
        </Button>
      ) : null}
      {instruction.template === null && !editing ? (
        removing ? (
          <>
            <Button
              tone="danger"
              disabled={working}
              onClick={() => void act(() => removeInstruction(instruction.id))}
            >
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
          </>
        ) : (
          <Button
            tone="quiet"
            aria-label={`${instruction.title} entfernen`}
            onClick={() => {
              setRemoving(true)
            }}
          >
            Entfernen
          </Button>
        )
      ) : null}
    </span>
  ) : null

  return (
    <Section title={instruction.title} actions={actions}>
      <div className="flex flex-col gap-3">
        <p className="text-table font-semibold text-ink-muted">{origin(instruction)}</p>

        {instruction.changed && instruction.template !== null ? (
          <div role="note" className="rounded-control border border-conflict p-3 text-body">
            <p className="font-semibold text-conflict">
              {isStatutory(instruction.template) ? 'Geändertes Muster' : 'Geänderter Vordruck'}
            </p>
            <p className="mt-1">{changedWarning[instruction.template]}</p>
          </div>
        ) : null}

        {instruction.newerModel ? (
          <p role="note" className="text-body font-semibold">
            Seit dieser Änderung ist eine neue Fassung des Musters erschienen, gültig ab{' '}
            {date(instruction.newerModel.validFrom)}. Die geänderte Fassung wurde dabei nicht
            angepasst; mit „Original wiederherstellen“ gilt wieder das Muster.
          </p>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {editing ? (
          <InstructionForm
            instruction={instruction}
            onDone={() => {
              setEditing(false)
            }}
          />
        ) : (
          <>
            <Summary instruction={instruction} />
            <details>
              <summary className="cursor-pointer text-body font-semibold">Wortlaut</summary>
              <div className="mt-3 flex flex-col gap-3">
                <InstructionText text={instruction.body} />
                {instruction.model ? (
                  <p className="text-table text-ink-muted">
                    Fundstelle des Musters: {instruction.model.source}
                  </p>
                ) : null}
              </div>
            </details>
          </>
        )}
      </div>
    </Section>
  )
}

/**
 * The instructions a business hands its customers with a document, #109.
 *
 * Shipped are the instruction on withdrawal and its form, the models of the
 * law, and a sheet for a customer who wants the work to begin before the
 * fourteen days are over. The business decides for which documents each is
 * proposed and whether it goes out with the document, and it writes its own.
 *
 * Only the owner changes them; the office sees them with nothing to press,
 * like the letterhead.
 */
export function InstructionsScreen() {
  const listed = useQuery({ queryKey, queryFn: instructions })
  const mayWrite = useMay('settings.write')
  const [adding, setAdding] = useState(false)

  return (
    <Page
      title="Belehrungen"
      meta="Was Kunden mit einem Beleg bekommen, allen voran die Widerrufsbelehrung."
      actions={
        mayWrite && !adding ? (
          <Button
            tone="primary"
            onClick={() => {
              setAdding(true)
            }}
          >
            Belehrung anlegen
          </Button>
        ) : null
      }
    >
      <p className="text-body text-ink-muted">
        Eine Belehrung wird zu den Belegen vorgeschlagen, die hier angehakt sind, und lässt sich am
        Beleg ein- und ausschalten. Mit dem Festschreiben wird ihr Wortlaut mit dem Beleg
        festgehalten; eine spätere Änderung hier betrifft nur Belege, die danach festgeschrieben
        werden.
      </p>

      {adding ? (
        <Card label="Neue Belehrung">
          <InstructionForm
            onDone={() => {
              setAdding(false)
            }}
          />
        </Card>
      ) : null}

      {listed.isPending ? (
        <Nothing>Wird geladen.</Nothing>
      ) : listed.isError ? (
        <Nothing>{saidWhy(listed.error, 'Die Belehrungen kamen nicht an.')}</Nothing>
      ) : (
        listed.data.map((instruction) => (
          <InstructionEntry key={instruction.id} instruction={instruction} mayWrite={mayWrite} />
        ))
      )}
    </Page>
  )
}
