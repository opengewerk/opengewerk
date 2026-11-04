import {
  type CallDirection,
  callDirectionLabel,
  callDirections,
  communicationProblems,
  communicationTitle,
  customerMailKindLabel,
  type HistoryItem,
  historyMailStatusLabel,
  historyOf,
  type RecordState,
} from '@opengewerk/domain'
import {
  Button,
  Choice,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  TextArea,
} from '@opengewerk/platform-web'
import { maybeText, RequestRefused, text, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarDays, Check, Mail, Pencil, Phone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { useAuthorName } from '../../app/defects.js'
import { useMay } from '../../app/queries.js'
import {
  history,
  historyKey,
  type HistorySubject,
  writeCommunication,
} from '../../session/communications.js'

const berlin = 'Europe/Berlin'

const dayAndTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: berlin,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const weekdayAndTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: berlin,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const timeOnly = new Intl.DateTimeFormat('de-DE', {
  timeZone: berlin,
  hour: '2-digit',
  minute: '2-digit',
})

/** "04.11.2026, 09:12", in German time. */
function when(at: string): string {
  return dayAndTime.format(new Date(at))
}

/** "Mo 09.11.2026, 08:00 bis 10:00": an appointment with its end, as the board writes the day. */
function span(at: string, endsAt: string): string {
  const start = weekdayAndTime.format(new Date(at)).replace(/^(\p{L}+)\.?, /u, '$1 ')

  return `${start} bis ${timeOnly.format(new Date(endsAt))}`
}

/** The moment of now as a field for date and time wants it, in the time of the device. */
function nowForField(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)

  return local.toISOString().slice(0, 16)
}

function Line({
  icon: Icon,
  title,
  meta,
  children,
}: {
  readonly icon: LucideIcon
  readonly title: string
  readonly meta: string
  readonly children: ReactNode
}) {
  return (
    <li className="flex gap-2.5 border-b border-row py-[9px] last:border-b-0">
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-ink-muted"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] text-ink-faint">
          <span className="font-semibold text-ink">{title}</span>
          {meta ? ` · ${meta}` : ''}
        </span>
        <span className="whitespace-pre-line text-[14px] leading-[1.45]">{children}</span>
      </div>
    </li>
  )
}

/**
 * The card "Verlauf" at a customer and at a site (#313), as the board
 * "Kundenakte mit Verlauf" draws it: the appointments still to come on top,
 * then everything that happened, the newest first. At a customer the entries
 * of its sites say which site they are about.
 */
export function HistoryPanel({
  subject,
  customerId,
  sites,
}: {
  readonly subject: HistorySubject
  readonly customerId: string
  /** The sites of the customer, at a customer; the one site, at a site. */
  readonly sites: readonly RecordState[]
}) {
  const reads = useMay('customer.read')
  const writes = useMay('customer.write')
  const { online } = useSyncStatus()
  const author = useAuthorName()
  const [writing, setWriting] = useState<'note' | 'call' | null>(null)
  const list = useQuery({
    queryKey: historyKey(subject),
    queryFn: () => history(subject),
    enabled: online && reads,
  })
  const atCustomer = 'customerId' in subject
  const siteName = (siteId: string | null) => {
    if (!atCustomer || siteId === null) {
      return null
    }

    const site = sites.find((candidate) => text(candidate, 'id') === siteId)

    return site ? `am Objekt ${text(site, 'designation')}` : null
  }
  const meta = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ')
  const names = (userIds: readonly string[]) => userIds.map((userId) => author(userId)).join(', ')

  if (!reads) {
    return null
  }

  const { coming, past } = historyOf(list.data ?? [], new Date())

  const lineOf = (item: HistoryItem) => {
    if (item.type === 'entry') {
      return (
        <Line
          key={`e-${item.entry.id}`}
          icon={item.entry.kind === 'call' ? Phone : Pencil}
          title={communicationTitle(item.entry)}
          meta={meta(when(item.at), author(item.entry.createdBy), siteName(item.entry.siteId))}
        >
          {item.entry.counterpart
            ? `${item.entry.counterpart}: ${item.entry.text}`
            : item.entry.text}
        </Line>
      )
    }

    if (item.type === 'mail') {
      return (
        <Line
          key={`m-${item.id}`}
          icon={Mail}
          title="E-Mail"
          meta={meta(when(item.at), `an ${item.recipient}`, siteName(item.siteId))}
        >
          {item.subject}
          <span className="text-ink-faint">
            {` · ${customerMailKindLabel[item.kind]}, ${historyMailStatusLabel[item.status]}`}
          </span>
        </Line>
      )
    }

    return (
      <Line
        key={`a-${item.id}`}
        icon={CalendarDays}
        title={item.series ? 'Serientermin' : 'Termin'}
        meta={meta(span(item.at, item.endsAt), names(item.userIds), siteName(item.siteId))}
      >
        <Link
          to={`/auftraege/${item.jobId}`}
          className="text-copper-text underline underline-offset-2"
        >
          {item.jobDesignation}
        </Link>
        {item.series ? ' seit diesem Tag' : ' war da'}
      </Line>
    )
  }

  return (
    <Panel
      title="Verlauf"
      action={
        writes ? (
          <div className="flex gap-1.5">
            <Button
              size="small"
              icon={Pencil}
              disabled={!online}
              onClick={() => {
                setWriting('note')
              }}
            >
              Notiz
            </Button>
            <Button
              size="small"
              icon={Phone}
              disabled={!online}
              onClick={() => {
                setWriting('call')
              }}
            >
              Anruf eintragen
            </Button>
          </div>
        ) : null
      }
    >
      {!online ? (
        <p className="text-[13px] text-ink-muted">
          Der Verlauf liegt auf dem Server, dafür braucht es Verbindung.
        </p>
      ) : (
        <div className="flex flex-col">
          {coming.length > 0 ? (
            <section
              aria-label="Kommt"
              className="mb-1 flex flex-col gap-1 rounded-[4px] border border-line bg-surface-sunken px-2.5 py-2"
            >
              <span className="text-[13px] font-semibold text-ink-muted">Kommt</span>
              {coming.map((item) =>
                item.type === 'appointment' ? (
                  <span key={item.id} className="flex items-center gap-2 text-[14px]">
                    <CalendarDays
                      size={15}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="shrink-0"
                    />
                    <span>
                      {`${span(item.at, item.endsAt)} · `}
                      <Link
                        to={`/auftraege/${item.jobId}`}
                        className="text-copper-text underline underline-offset-2"
                      >
                        {item.jobDesignation}
                      </Link>
                      {item.userIds.length > 0 ? ` · ${names(item.userIds)}` : ''}
                    </span>
                  </span>
                ) : null,
              )}
            </section>
          ) : null}
          {past.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Noch nichts im Verlauf.</p>
          ) : (
            <ul aria-label="Verlauf">{past.map(lineOf)}</ul>
          )}
          <p className="mt-2 text-[13px] text-ink-faint">
            Einträge bleiben, wie sie geschrieben sind. Eine Korrektur ist ein neuer Eintrag.
          </p>
        </div>
      )}
      {writing ? (
        <EntryDialog
          kind={writing}
          subject={subject}
          customerId={customerId}
          sites={sites}
          onClose={() => {
            setWriting(null)
          }}
        />
      ) : null}
    </Panel>
  )
}

/** The dialogs "Anruf eintragen" and "Notiz schreiben". */
function EntryDialog({
  kind,
  subject,
  customerId,
  sites,
  onClose,
}: {
  readonly kind: 'note' | 'call'
  readonly subject: HistorySubject
  readonly customerId: string
  readonly sites: readonly RecordState[]
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const atSite = 'siteId' in subject
  const [direction, setDirection] = useState<CallDirection>('incoming')
  const [counterpart, setCounterpart] = useState('')
  const [happened, setHappened] = useState(nowForField())
  const [siteId, setSiteId] = useState(atSite ? subject.siteId : '')
  const [content, setContent] = useState('')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const title = kind === 'call' ? 'Anruf eintragen' : 'Notiz schreiben'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const moment = new Date(happened)
    const values = {
      customerId,
      siteId: siteId === '' ? null : siteId,
      kind,
      direction: kind === 'call' ? direction : null,
      counterpart: kind === 'call' && counterpart.trim() !== '' ? counterpart.trim() : null,
      text: content.trim(),
      happenedAt: Number.isNaN(moment.getTime()) ? happened : moment.toISOString(),
    }
    const found = communicationProblems(values, new Date())

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      await writeCommunication(values)
      await queries.invalidateQueries({ queryKey: ['communications'] })
      onClose()
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Ein Eintrag wird mit Verbindung geschrieben.',
      )
    } finally {
      setWorking(false)
    }
  }

  const siteOptions = [
    ...(atSite ? [] : [{ value: '', label: 'Kunde allgemein' }]),
    ...sites.map((site) => ({
      value: text(site, 'id'),
      label: maybeText(site, 'designation') ?? '',
    })),
  ]

  return (
    <Dialog title={title} width={600} onClose={onClose}>
      <form
        className="flex flex-col gap-[13px]"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        {kind === 'call' ? (
          <>
            <Choice
              label="Richtung"
              value={direction}
              options={callDirections.map((option) => ({
                value: option,
                label: callDirectionLabel[option],
                note:
                  option === 'incoming' ? 'Der Kunde hat angerufen.' : 'Der Betrieb hat angerufen.',
              }))}
              onChange={(value) => {
                setDirection(value as CallDirection)
              }}
            />
            <Field
              label="Gesprächspartner"
              value={counterpart}
              hint="Wer am Telefon war, wenn es nicht der Kunde selbst war."
              problem={problems['counterpart']}
              onChange={(event) => {
                setCounterpart(event.target.value)
              }}
            />
          </>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Wann"
            type="datetime-local"
            required
            starred
            value={happened}
            problem={problems['happenedAt']}
            onChange={(event) => {
              setHappened(event.target.value)
            }}
          />
          <SelectField
            label="Objekt"
            value={siteId}
            options={siteOptions}
            disabled={atSite}
            {...(atSite ? {} : { hint: 'Oder „Kunde allgemein“.' })}
            onChange={setSiteId}
          />
        </div>
        <TextArea
          label="Inhalt"
          starred
          value={content}
          problem={problems['text']}
          onChange={(event) => {
            setContent(event.target.value)
          }}
        />
        <p className="text-[13px] text-ink-faint">
          Ein Eintrag bleibt, wie er geschrieben ist. Eine Korrektur ist ein neuer Eintrag.
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
            {working ? 'Wird geschrieben' : 'Eintragen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
