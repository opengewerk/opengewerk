import { absenceStateLabel, dayCount, type IsoDate } from '@opengewerk/domain'
import { Button, Field, Panel, Status, type StatusTone, TextArea } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  SiteActionBar,
  SiteLink,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Send } from 'lucide-react'
import { useState } from 'react'

import {
  absencesKey,
  type AbsenceView,
  askForLeave,
  daysForMe,
  ownYear,
  takeBackRequest,
} from '../../session/absences.js'
import { SiteHeader } from '../header.js'

/**
 * One's own leave on site (#288): the year in four numbers, every absence of
 * one's own with its kind, asking for leave and taking a request back while
 * the office has not decided. Boards "Urlaub", "Urlaub beantragen", "Urlaub,
 * ohne Netz" and "Zeiten mit der Karte Urlaub" of the canvas, version 95.
 *
 * Leave is not on the device: the files of the people travel to none, and a
 * request has to reach the office to mean anything. Without a network the
 * screen says so instead of showing an old state.
 */

const ownKey = (year: number) => [...absencesKey, 'mine', year] as const

const stateTone: Readonly<Record<AbsenceView['state'], StatusTone>> = {
  requested: 'waiting',
  approved: 'done',
  rejected: 'conflict',
}

function offline(error: unknown): boolean {
  return !(error instanceof RequestRefused)
}

function spanOf(absence: AbsenceView): string {
  const first = date(absence.firstDay)
  const last = date(absence.lastDay)

  if (absence.firstDay === absence.lastDay) {
    return `${first}${absence.startsAtNoon ? ', ab Mittag' : absence.endsAtNoon ? ', bis Mittag' : ''}`
  }

  return `${first.slice(0, 6)} bis ${last}`
}

/** The line under an absence: how it counts for the person. */
function countOf(absence: AbsenceView): string {
  if (absence.leaveHalfDays === null) {
    return `${dayCount(absence.workingHalfDays)} Arbeitstage`
  }

  if (absence.state === 'rejected') {
    return 'Zählt nicht'
  }

  const holidays =
    absence.holidays > 0
      ? `, ${String(absence.holidays)} ${absence.holidays === 1 ? 'Feiertag zählt' : 'Feiertage zählen'} nicht`
      : ''
  const sick =
    absence.sickHalfDays > 0 ? `, an ${dayCount(absence.sickHalfDays)} Tagen warst du krank` : ''

  return `${dayCount(absence.leaveHalfDays)} Urlaubstage${holidays}${sick}`
}

/** The card "Urlaub" at the end of "Zeiten": what is left, and a request that waits. */
export function LeaveCard() {
  const year = Number(today().slice(0, 4))
  const own = useQuery({ queryKey: ownKey(year), queryFn: () => ownYear(year), retry: false })

  // Nothing until the year is there: without a network, and without a file of one's own.
  if (own.data?.leave === undefined) {
    return null
  }

  const waiting = own.data.absences.find((absence) => absence.state === 'requested')

  return (
    <Panel title="Urlaub">
      <div className="flex flex-col gap-2">
        <SiteText size={17}>
          {`${dayCount(own.data.leave.restHalfDays)} Tage übrig in ${String(year)}`}
          {own.data.leave.requestedHalfDays > 0
            ? `, ${dayCount(own.data.leave.requestedHalfDays)} beantragt.`
            : '.'}
        </SiteText>
        {waiting ? (
          <SiteText
            muted
            size={15}
          >{`Am ${spanOf(waiting)} wartet dein Antrag auf das Büro.`}</SiteText>
        ) : null}
        <SiteLink to="/urlaub">Urlaub ansehen und beantragen</SiteLink>
      </div>
    </Panel>
  )
}

export function SiteLeaveScreen() {
  return (
    <SiteScreen gap={12}>
      <SiteHeader title="Urlaub" sub="Zeiten" />
      <OwnLeave />
    </SiteScreen>
  )
}

/**
 * What the screen "Urlaub" holds below its header: the year, the absences and
 * the button to ask, or why there is none of it.
 */
export function OwnLeave() {
  const year = Number(today().slice(0, 4))
  const own = useQuery({ queryKey: ownKey(year), queryFn: () => ownYear(year), retry: false })
  const navigate = useNavigate()

  if (own.isError) {
    return (
      <>
        <Panel>
          <div className="flex flex-col gap-2">
            <SiteText size={17}>
              {offline(own.error)
                ? 'Ohne Netz lässt sich dein Urlaub nicht ansehen und kein Antrag stellen.'
                : own.error.message}
            </SiteText>
            {offline(own.error) ? (
              <SiteText muted size={15}>
                Sobald das Gerät wieder Netz hat, lädt die Seite von selbst.
              </SiteText>
            ) : null}
          </div>
        </Panel>
      </>
    )
  }

  if (own.data === null) {
    return (
      <>
        <SiteText>
          Für dich gibt es in diesem Betrieb noch keine Akte. Das Büro legt sie an; dann steht dein
          Urlaub hier.
        </SiteText>
      </>
    )
  }

  const data = own.data

  return (
    <>
      {data ? (
        <>
          <Panel>
            <dl className="grid grid-cols-4 gap-1.5 text-center">
              {[
                [
                  'Anspruch',
                  data.leave.carriedHalfDays > 0
                    ? `${dayCount(data.leave.entitledHalfDays)} + ${dayCount(data.leave.carriedHalfDays)}`
                    : dayCount(data.leave.entitledHalfDays),
                ],
                ['Freigegeben', dayCount(data.leave.approvedHalfDays)],
                ['Beantragt', dayCount(data.leave.requestedHalfDays)],
                ['Rest', dayCount(data.leave.restHalfDays)],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col-reverse">
                  <dt className="text-[14px] text-ink-muted">{label}</dt>
                  <dd className="numeric m-0 text-[22px] font-bold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 mt-2.5 text-[15px] leading-[1.4] text-ink-muted">
              {`Arbeitstage in ${String(year)}`}
              {data.leave.carriedHalfDays > 0
                ? `, der Anspruch mit ${dayCount(data.leave.carriedHalfDays)} Tagen aus ${String(year - 1)}.`
                : '.'}
            </p>
          </Panel>
          <OwnAbsences absences={data.absences} year={year} />
        </>
      ) : (
        <SiteText muted>Wird geladen.</SiteText>
      )}
      <SiteActionBar>
        <Button
          wide
          tone="primary"
          icon={Plus}
          onClick={() => {
            void navigate({ to: '/urlaub/beantragen' })
          }}
        >
          Urlaub beantragen
        </Button>
      </SiteActionBar>
    </>
  )
}

function OwnAbsences({
  absences,
  year,
}: {
  readonly absences: readonly AbsenceView[]
  readonly year: number
}) {
  const queries = useQueryClient()
  const [trouble, setTrouble] = useState<string | null>(null)

  async function takeBack(absence: AbsenceView) {
    try {
      await takeBackRequest(absence.id)
      setTrouble(null)
      await queries.invalidateQueries({ queryKey: absencesKey })
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : 'Das hat nicht geklappt.')
    }
  }

  return (
    <Panel title={`Deine Abwesenheiten ${String(year)}`}>
      {absences.length === 0 ? (
        <SiteText muted size={15}>
          Noch keine.
        </SiteText>
      ) : (
        <ul className="m-0 list-none p-0">
          {absences.map((absence) => (
            <li key={absence.id} className="border-b border-row py-2.5 last:border-b-0">
              <div className="flex items-center gap-2">
                <div className="grow text-[17px]">
                  <b>{absence.kind === 'sickness' ? 'Krank' : 'Urlaub'}</b>
                  {`, ${spanOf(absence)}`}
                </div>
                <Status tone={stateTone[absence.state]}>
                  {absenceStateLabel(absence.kind, absence.state)}
                </Status>
              </div>
              <div className="mt-0.5 text-[15px] text-ink-muted">{countOf(absence)}</div>
              {absence.answer ? (
                <div className="mt-1 text-[15px] text-ink-muted">{`Antwort: „${absence.answer}“`}</div>
              ) : null}
              {absence.state === 'requested' ? (
                <div className="mt-2">
                  <Button onClick={() => void takeBack(absence)}>Zurückziehen</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
    </Panel>
  )
}

export function SiteLeaveRequestScreen() {
  const navigate = useNavigate()
  const queries = useQueryClient()
  const [firstDay, setFirstDay] = useState<IsoDate>(today())
  const [lastDay, setLastDay] = useState<IsoDate>(today())
  const [startsAtNoon, setStartsAtNoon] = useState(false)
  const [endsAtNoon, setEndsAtNoon] = useState(false)
  const [note, setNote] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const span = { firstDay, lastDay, startsAtNoon, endsAtNoon }
  const count = useQuery({
    queryKey: [...absencesKey, 'my-days', span],
    queryFn: () => daysForMe(span),
    enabled: firstDay !== '' && lastDay !== '' && lastDay >= firstDay,
    retry: false,
  })

  async function send() {
    setSending(true)

    try {
      await askForLeave({ ...span, note: note.trim() === '' ? null : note.trim() })
      await queries.invalidateQueries({ queryKey: absencesKey })
      void navigate({ to: '/urlaub' })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Ohne Netz geht kein Antrag hinaus. Versuch es noch einmal, sobald das Gerät Netz hat.',
      )
    } finally {
      setSending(false)
    }
  }

  const check = (label: string, checked: boolean, change: (checked: boolean) => void) => (
    <label className="flex min-h-[44px] items-center gap-3 text-[17px]">
      <input
        type="checkbox"
        className="size-6"
        checked={checked}
        onChange={(event) => {
          change(event.target.checked)
        }}
      />
      {label}
    </label>
  )

  return (
    <SiteScreen gap={12}>
      <SiteHeader title="Urlaub beantragen" sub="Urlaub" />
      <Field
        label="Erster Tag"
        type="date"
        value={firstDay}
        onChange={(event) => {
          setFirstDay(event.target.value)
        }}
      />
      {check('Erst ab Mittag', startsAtNoon, setStartsAtNoon)}
      <Field
        label="Letzter Tag"
        type="date"
        value={lastDay}
        onChange={(event) => {
          setLastDay(event.target.value)
        }}
      />
      {check('Nur bis Mittag', endsAtNoon, setEndsAtNoon)}
      {typeof count.data?.workingHalfDays === 'number' ? (
        <Panel>
          <div className="flex flex-col gap-1">
            <SiteText size={17}>
              <b>{`${dayCount(count.data.leaveHalfDays ?? count.data.workingHalfDays)} Arbeitstage`}</b>
            </SiteText>
            <SiteText muted size={15}>
              {`Danach bleiben dir ${dayCount(count.data.restAfterHalfDays)} Tage.`}
            </SiteText>
          </div>
        </Panel>
      ) : null}
      <TextArea
        label="Notiz an das Büro"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(event) => {
          setNote(event.target.value)
        }}
      />
      <SiteText muted size={15}>
        Ein Antrag braucht Netz. Das Büro gibt ihn frei oder lehnt ihn ab; wie es entschieden hat,
        steht dann unter „Urlaub“.
      </SiteText>
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      <SiteActionBar>
        <Button
          wide
          className="flex-1 basis-0"
          onClick={() => {
            void navigate({ to: '/urlaub' })
          }}
        >
          Abbrechen
        </Button>
        <Button
          wide
          tone="primary"
          icon={Send}
          className="flex-[2] basis-0"
          disabled={sending}
          onClick={() => void send()}
        >
          Beantragen
        </Button>
      </SiteActionBar>
    </SiteScreen>
  )
}
