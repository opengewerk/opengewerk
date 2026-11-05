import {
  type AccessRequestView,
  accessRequestProblem,
  accessRequestSentence,
  type AccessSubjectHit,
  accessSubjectLabel,
  type ErasureRequestChannel,
  erasureRequestChannelLabel,
  erasureRequestChannels,
  type IsoDate,
} from '@opengewerk/domain'
import {
  Button,
  Cell,
  cardLink,
  Column,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  SelectField,
  Status,
  type TableCard,
  TablePanel,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { type RequestedFile, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { Check, Download, Plus, Shield } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, type ReactNode, useId, useState } from 'react'

import { useMay } from '../../app/queries.js'
import {
  accessRequests,
  accessRequestsKey,
  answerAccessRequest,
  drawAccessAnswer,
  findAccessSubjects,
  recordAccessRequest,
} from '../../session/privacy.js'

/** Who gets the answer, and what the business checks first (#318). */
export const accessIdentity =
  'Herausgegeben wird die Auskunft nur an die Person selbst. Ob die Anfrage von ihr kommt, prüft der Betrieb, etwa über die Anschrift, E-Mail-Adresse oder Telefonnummer, die er schon von ihr kennt.'

/** What the card says under the list. */
export const accessNote = `Eine Auskunft gibt es zu einer erfassten Anfrage. Das ZIP enthält ein PDF zum Lesen, eine JSON-Datei zum Übertragen in eine andere Anwendung und die gespeicherten Dateien der Person. Namen von Mitarbeitern bleiben darin, Daten anderer Kunden nicht. ${accessIdentity} Jedes Herunterladen steht im Änderungsprotokoll; beantwortete Anfragen bleiben zwölf Monate in der Liste.`

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** Hands the file to the browser to save, under the name the server gave it. */
export function saveFile(file: RequestedFile, fallback: string): void {
  const address = URL.createObjectURL(file.content)
  const link = document.createElement('a')

  link.href = address
  link.download = file.name ?? fallback
  link.click()
  // The browser has taken the file once the click is through.
  setTimeout(() => {
    URL.revokeObjectURL(address)
  }, 0)
}

/** The name of whom a request is about, a link to the file where there is one. */
function nameOf(view: AccessRequestView, className?: string): ReactNode {
  const name = view.name ?? `Gelöschter ${accessSubjectLabel[view.request.subject]}`
  const id = view.request.subjectId
  const link = clsx('text-copper-text underline underline-offset-2', className)

  if (id !== null && view.request.subject === 'customer') {
    return (
      <Link to="/kunden/$customerId" params={{ customerId: id }} className={link}>
        {name}
      </Link>
    )
  }

  if (id !== null && view.request.subject === 'person') {
    return (
      <Link to="/mitarbeiter/$personId" params={{ personId: id }} className={link}>
        {name}
      </Link>
    )
  }

  return <span>{name}</span>
}

/** "Mitarbeiter · Eingegangen am 28.10.2026 persönlich · ZIP erstellt am 03.11.2026" */
export function accessLine(view: AccessRequestView): string {
  const what =
    view.name === null
      ? view.detail
      : view.request.subject === 'contact'
        ? view.detail
        : accessSubjectLabel[view.request.subject]
  const drawn =
    view.request.producedAt === null ? [] : [`ZIP erstellt am ${date(view.request.producedAt)}`]

  return [what, accessRequestSentence(view.request), ...drawn].join(' · ')
}

/** "Antwort bis 28.11.2026" or "Beantwortet am 21.10.2026". */
function dueOf(view: AccessRequestView): string {
  return view.request.status === 'answered'
    ? `Beantwortet am ${date(view.request.answeredAt)}`
    : `Antwort bis ${date(view.request.answerDueOn)}`
}

/**
 * The requests for access (#318), as the boards "Datenschutz" draw them, on
 * top: those that run and those answered in the last twelve months, the ZIP
 * to download for each, and "Beantwortet" once it was drawn. Only for whoever
 * may give access, the owner; the server asks the same.
 */
export function AccessSection() {
  const may = useMay('privacy.access')

  return may ? <AccessRequests /> : null
}

function AccessRequests() {
  const queries = useQueryClient()
  const listed = useQuery({ queryKey: accessRequestsKey, queryFn: accessRequests })
  const [recording, setRecording] = useState(false)
  const [drawing, setDrawing] = useState<string | null>(null)
  const [answering, setAnswering] = useState<AccessRequestView | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const draw = async (view: AccessRequestView) => {
    setDrawing(view.request.id)
    setProblem(null)

    try {
      saveFile(await drawAccessAnswer(view.request.id), 'Auskunft.zip')
      await queries.invalidateQueries({ queryKey: accessRequestsKey })
    } catch (error) {
      setProblem(saidWhy(error, 'Die Auskunft kam nicht an. Ohne Verbindung gibt es keine.'))
    } finally {
      setDrawing(null)
    }
  }

  const answer = async () => {
    if (answering === null) {
      return
    }

    setBusy(true)
    setProblem(null)

    try {
      await answerAccessRequest(answering.request.id)
      await queries.invalidateQueries({ queryKey: accessRequestsKey })
    } catch (error) {
      setProblem(saidWhy(error, 'Das ging nicht durch. Nichts wurde geändert.'))
    } finally {
      setBusy(false)
      setAnswering(null)
    }
  }

  const record = (
    <Button
      size="small"
      icon={Plus}
      onClick={() => {
        setRecording(true)
      }}
    >
      Anfrage erfassen
    </Button>
  )
  const actionsOf = (view: AccessRequestView) => (
    <span className="inline-flex flex-wrap justify-end gap-1.5">
      {view.request.subjectId === null ? null : (
        <Button
          size="small"
          icon={Download}
          disabled={drawing !== null}
          onClick={() => {
            void draw(view)
          }}
        >
          {drawing === view.request.id ? 'Wird erstellt' : 'Herunterladen'}
        </Button>
      )}
      {view.request.status === 'open' && view.request.producedAt !== null ? (
        <Button
          size="small"
          icon={Check}
          onClick={() => {
            setAnswering(view)
          }}
        >
          Beantwortet
        </Button>
      ) : null}
    </span>
  )
  const statusOf = (view: AccessRequestView) => (
    <Status tone={view.request.status === 'answered' ? 'done' : 'waiting'}>
      {view.request.status === 'answered' ? 'Beantwortet' : 'Offen'}
    </Status>
  )
  const views = listed.data ?? []
  const note = (
    <>
      {problem ? (
        <span role="alert" className="mb-1 block text-conflict">
          {problem}
        </span>
      ) : null}
      {listed.isError ? `${saidWhy(listed.error, 'Die Auskunftsanfragen kamen nicht an.')} ` : null}
      {accessNote}
    </>
  )
  const cards: TableCard[] = views.map((view) => ({
    key: view.request.id,
    title: nameOf(view, cardLink),
    sub: `${accessLine(view)} · ${dueOf(view)}`,
    right: statusOf(view),
    actions: actionsOf(view),
  }))

  return (
    <>
      <TablePanel
        title="Auskunftsanfragen"
        caption="Auskunftsanfragen"
        action={record}
        note={note}
        cards={cards}
        cardsEmpty={listed.isPending ? 'Wird geladen.' : 'Keine Auskunftsanfrage.'}
      >
        <thead>
          <tr>
            <Column>Person</Column>
            <Column className="w-[110px]">Stand</Column>
            <Column className="w-[170px]">Fällig</Column>
            <Column className="w-[250px] text-right">
              <span className="sr-only">Auskunft</span>
            </Column>
          </tr>
        </thead>
        <tbody>
          {views.length === 0 ? (
            <tr>
              <Cell colSpan={4} className="text-ink-muted">
                {listed.isPending ? 'Wird geladen.' : 'Keine Auskunftsanfrage.'}
              </Cell>
            </tr>
          ) : (
            views.map((view) => (
              <tr key={view.request.id}>
                <Cell>
                  <span className="flex flex-col gap-px">
                    {nameOf(view)}
                    <span className="text-[12px] text-ink-faint">{accessLine(view)}</span>
                  </span>
                </Cell>
                <Cell>{statusOf(view)}</Cell>
                <Cell>{dueOf(view)}</Cell>
                <Cell className="text-right">{actionsOf(view)}</Cell>
              </tr>
            ))
          )}
        </tbody>
      </TablePanel>
      {recording ? (
        <RecordDialog
          onClose={() => {
            setRecording(false)
          }}
        />
      ) : null}
      <Confirm
        open={answering !== null}
        title={
          answering === null ? '' : `Auskunft an ${answering.name ?? 'die Person'} beantwortet?`
        }
        confirm="Beantwortet"
        tone="primary"
        busy={busy}
        onConfirm={() => {
          void answer()
        }}
        onCancel={() => {
          setAnswering(null)
        }}
      >
        {answering === null
          ? null
          : `Vermerkt wird, dass ${answering.name ?? 'die Person'} die Auskunft${answering.request.producedAt === null ? '' : ` vom ${date(answering.request.producedAt)}`} bekommen hat; die Frist entfällt. Die Anfrage bleibt zwölf Monate in der Liste.`}
      </Confirm>
    </>
  )
}

/** The field that finds the person among customers, contacts, leads and the staff, and what it found. */
function PersonSearch({
  chosen,
  onChoose,
}: {
  readonly chosen: AccessSubjectHit | null
  readonly onChoose: (hit: AccessSubjectHit | null) => void
}) {
  const listId = useId()
  const hintId = useId()
  const [typed, setTyped] = useState(chosen?.name ?? '')
  const [open, setOpen] = useState(false)
  const [marker, setMarker] = useState(0)
  const query = typed.trim()
  const found = useQuery({
    queryKey: [...accessRequestsKey, 'subjects', query],
    queryFn: () => findAccessSubjects(query),
    enabled: query.length >= 2,
  })
  const hits = query.length >= 2 ? (found.data ?? []) : []
  const shown = open && hits.length > 0
  const at = Math.min(marker, hits.length - 1)

  const take = (hit: AccessSubjectHit) => {
    onChoose(hit)
    setTyped(hit.name)
    setOpen(false)
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setMarker((current) => {
        const last = Math.max(hits.length - 1, 0)

        return event.key === 'ArrowDown' ? Math.min(current + 1, last) : Math.max(current - 1, 0)
      })
    } else if (event.key === 'Enter' && shown) {
      event.preventDefault()

      const hit = hits[at]

      if (hit) {
        take(hit)
      }
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Field
          label="Person"
          starred
          value={typed}
          role="combobox"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${listId}-${String(at)}` : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          onChange={(event) => {
            setTyped(event.target.value)
            setOpen(true)
            setMarker(0)
            onChoose(null)
          }}
          onFocus={() => {
            setOpen(true)
          }}
          onBlur={() => {
            setOpen(false)
          }}
          onKeyDown={onKey}
        />
        {shown ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Gefunden"
            className="absolute top-full right-0 left-0 z-10 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-control border border-line-strong bg-surface py-1 shadow-[0_6px_18px_rgb(27_36_48/0.14)]"
          >
            {hits.map((hit, index) => (
              <li
                key={`${hit.subject}:${hit.id}`}
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={index === at}
                // Down, not click: the field would lose the focus first and
                // close the list under the pointer.
                onMouseDown={(event) => {
                  event.preventDefault()
                  take(hit)
                }}
                className={clsx(
                  'flex cursor-pointer flex-col gap-px px-2.5 py-[7px]',
                  index === at && 'bg-surface-sunken',
                )}
              >
                <span className="text-[14px]">{hit.name}</span>
                <span className="text-[12px] text-ink-faint">{hit.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p id={hintId} className="text-[13px] text-ink-faint">
        {chosen === null
          ? 'Kunden, Ansprechpartner, Leads und Mitarbeiter, gesucht nach dem Namen.'
          : chosen.detail}
      </p>
    </div>
  )
}

/** The dialog "Auskunftsanfrage erfassen": whom, the day it came in and how. */
function RecordDialog({ onClose }: { readonly onClose: () => void }) {
  const queries = useQueryClient()
  const [chosen, setChosen] = useState<AccessSubjectHit | null>(null)
  const [receivedOn, setReceivedOn] = useState<string>(today())
  const [channel, setChannel] = useState<ErasureRequestChannel>('email')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const values = {
      subject: chosen?.subject,
      subjectId: chosen?.id,
      receivedOn: receivedOn as IsoDate,
      channel,
    }
    const problem = accessRequestProblem(values, today())

    if (problem !== null || chosen === null) {
      setTrouble(problem ?? 'Wer die Auskunft möchte, ist niemand aus der Liste.')

      return
    }

    setWorking(true)

    try {
      await recordAccessRequest({
        subject: chosen.subject,
        subjectId: chosen.id,
        receivedOn: receivedOn as IsoDate,
        channel,
      })
      await queries.invalidateQueries({ queryKey: accessRequestsKey })
      onClose()
    } catch (error) {
      setTrouble(
        saidWhy(error, 'Keine Verbindung. Eine Auskunftsanfrage wird mit Verbindung erfasst.'),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title="Auskunftsanfrage erfassen" width={520} onClose={onClose}>
      <form
        className="flex flex-col gap-[13px]"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <PersonSearch chosen={chosen} onChoose={setChosen} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Eingegangen am"
            type="date"
            starred
            value={receivedOn}
            onChange={(event) => {
              setReceivedOn(event.target.value)
            }}
          />
          <SelectField
            label="Weg"
            value={channel}
            options={erasureRequestChannels.map((option) => ({
              value: option,
              label: erasureRequestChannelLabel[option],
            }))}
            hint="Brief, E-Mail, Telefon, persönlich oder anders."
            onChange={(value) => {
              setChannel(value as ErasureRequestChannel)
            }}
          />
        </div>
        <p
          role="note"
          className="flex gap-2 rounded-[4px] border border-waiting-edge bg-waiting-fill px-3 py-2.5 text-[13px] leading-[1.45] text-waiting"
        >
          <Shield size={14} strokeWidth={2.2} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{accessIdentity}</span>
        </p>
        <p className="text-[13px] text-ink-faint">
          Die Antwort ist einen Monat nach Eingang fällig (Art. 12 Abs. 3 DSGVO); eine Frist
          erinnert daran.
        </p>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button onClick={onClose} disabled={working}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Wird erfasst' : 'Erfassen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
