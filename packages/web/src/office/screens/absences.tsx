import {
  type AbsenceKind,
  absenceKindLabel,
  absenceStateLabel,
  dayCount,
  type IsoDate,
  ruleScopeNames,
} from '@opengewerk/domain'
import {
  Button,
  cardLink,
  Cell,
  Choice,
  Column,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  IconButton,
  Panel,
  PanelLabel,
  SelectField,
  Status,
  type StatusTone,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, PageHead, RecordColumns, Screen } from '@opengewerk/platform-web/office'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Check, Copy, Info, Pencil, Plus, Trash2, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'

import {
  type AbsenceOverview,
  absenceOverview,
  absencesKey,
  type AbsenceView,
  approveRequest,
  changeAbsence,
  daysForPerson,
  enterAbsence,
  personYear,
  rejectRequest,
  removeAbsence,
  type RequestView,
  setEntitlement,
} from '../../session/absences.js'

/**
 * Leave and sickness of the business (#288), for whoever keeps absences: the
 * open requests and the year of everybody, the year of one person with every
 * absence, and the dialogs to enter one, to keep the days of a year and to
 * turn a request down. Boards "Abwesenheiten", "Abwesenheiten einer Person",
 * "Krankheit eintragen", "Anspruch und Übertrag" and "Antrag ablehnen" of the
 * canvas, version 95.
 */

const base = '/abwesenheiten'

function problemOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Das hat nicht geklappt.'
}

function Problem({ children }: { readonly children: string | null }) {
  return children ? (
    <p role="alert" className="m-0 text-body font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

/** The days of an absence in words, with the half days. */
export function spanText(
  absence: Pick<AbsenceView, 'firstDay' | 'lastDay' | 'startsAtNoon' | 'endsAtNoon'>,
): string {
  if (absence.firstDay === absence.lastDay) {
    const half = absence.startsAtNoon ? ', ab Mittag' : absence.endsAtNoon ? ', bis Mittag' : ''

    return `${date(absence.firstDay)}${half}`
  }

  const halves = [
    absence.startsAtNoon ? 'erster Tag ab Mittag' : null,
    absence.endsAtNoon ? 'letzter Tag bis Mittag' : null,
  ].filter(Boolean)

  return `${date(absence.firstDay)} bis ${date(absence.lastDay)}${halves.length > 0 ? `, ${halves.join(', ')}` : ''}`
}

const stateTone: Readonly<Record<AbsenceView['state'], StatusTone>> = {
  requested: 'waiting',
  approved: 'done',
  rejected: 'conflict',
}

/** What a day counts in, as the note under every list of absences says it. */
function countingNote(state: AbsenceOverview['state']): string {
  const where =
    state === null
      ? 'Ohne Bundesland zählt OpenGewerk keine Feiertage; es steht unter Einstellungen, Feiertage.'
      : `Ein Urlaubstag ist ein Arbeitstag nach der vereinbarten Arbeitszeit, der in ${ruleScopeNames[state]} kein Feiertag ist.`

  return `${where} Ein Tag, an dem jemand krank ist, zählt nicht als Urlaub (§ 9 BUrlG). Von einer Krankheit hält OpenGewerk nur, dass und wie lange, nie warum.`
}

function YearChoice({
  year,
  onChange,
}: {
  readonly year: number
  readonly onChange: (year: number) => void
}) {
  const now = Number(today().slice(0, 4))

  return (
    <div className="flex gap-1.5" role="group" aria-label="Jahr">
      {[now - 1, now, now + 1].map((which) => (
        <Button
          key={which}
          size="small"
          tone={year === which ? 'dark' : 'secondary'}
          aria-pressed={year === which}
          onClick={() => {
            onChange(which)
          }}
        >
          {String(which)}
        </Button>
      ))}
    </div>
  )
}

type Asking =
  | { readonly kind: 'enter'; readonly personId: string | null }
  | { readonly kind: 'change'; readonly absence: AbsenceView; readonly name: string }
  | { readonly kind: 'reject'; readonly absence: AbsenceView; readonly name: string }
  | { readonly kind: 'entitlement' }
  | { readonly kind: 'remove'; readonly absence: AbsenceView }

/** The absences of the business for a year: the open requests first, then everybody's year. */
export function AbsencesScreen() {
  const [year, setYear] = useState(() => Number(today().slice(0, 4)))
  const overview = useQuery({
    queryKey: [...absencesKey, 'overview', year],
    queryFn: () => absenceOverview(year),
  })
  const [asking, setAsking] = useState<Asking | null>(null)
  const close = () => {
    setAsking(null)
  }

  return (
    <Screen>
      <PageHead
        title="Abwesenheiten"
        count={`Urlaub ${String(year)}`}
        actions={
          <Button
            tone="primary"
            icon={Plus}
            onClick={() => {
              setAsking({ kind: 'enter', personId: null })
            }}
          >
            Abwesenheit eintragen
          </Button>
        }
      />
      <YearChoice year={year} onChange={setYear} />
      {overview.isError ? <Empty>{problemOf(overview.error)}</Empty> : null}
      {overview.data ? (
        <>
          {overview.data.requests.length > 0 ? (
            <RequestsPanel
              requests={overview.data.requests}
              onReject={(request) => {
                setAsking({ kind: 'reject', absence: request, name: request.name })
              }}
            />
          ) : null}
          <OverviewTable overview={overview.data} />
        </>
      ) : null}
      {asking?.kind === 'enter' && overview.data ? (
        <AbsenceDialog
          people={overview.data.people.map((person) => ({ id: person.id, name: person.name }))}
          personId={asking.personId}
          absence={null}
          onClose={close}
        />
      ) : null}
      {asking?.kind === 'reject' ? (
        <RejectDialog absence={asking.absence} name={asking.name} onClose={close} />
      ) : null}
    </Screen>
  )
}

function RequestsPanel({
  requests,
  onReject,
}: {
  readonly requests: readonly RequestView[]
  readonly onReject: (request: RequestView) => void
}) {
  const queries = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)

  async function approve(request: RequestView) {
    try {
      await approveRequest(request.id)
      setProblem(null)
      await queries.invalidateQueries({ queryKey: absencesKey })
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Panel title={`Anträge (${String(requests.length)})`}>
      <ul className="m-0 flex list-none flex-col p-0">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-2 border-t border-row py-2.5 sm:flex-row sm:items-center sm:gap-3.5"
          >
            <div className="font-semibold sm:w-[150px] sm:shrink-0">
              <Link
                to="/abwesenheiten/$personId"
                params={{ personId: request.personId }}
                className={cardLink}
              >
                {request.name}
              </Link>
            </div>
            <div className="min-w-0 grow">
              <div>{spanText(request)}</div>
              <div className="text-[13px] text-ink-muted">
                {`${dayCount(request.leaveHalfDays ?? 0)} Arbeitstage · Rest danach ${dayCount(request.restAfterHalfDays)}`}
              </div>
              {request.note ? (
                <div className="mt-0.5 text-[13px] text-ink-muted">{`„${request.note}“`}</div>
              ) : null}
              {request.alsoAway.map((away) => (
                <div
                  key={`${away.name}${away.firstDay}`}
                  className="mt-0.5 flex items-center gap-1.5 text-[13px] text-waiting"
                >
                  <Info size={13} aria-hidden="true" className="shrink-0" />
                  {away.firstDay === away.lastDay
                    ? `${away.name} ist am ${date(away.firstDay)} abwesend.`
                    : `${away.name} ist vom ${date(away.firstDay)} bis ${date(away.lastDay)} abwesend.`}
                </div>
              ))}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                icon={X}
                onClick={() => {
                  onReject(request)
                }}
              >
                Ablehnen
              </Button>
              <Button tone="primary" icon={Check} onClick={() => void approve(request)}>
                Freigeben
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Problem>{problem}</Problem>
      <p className="m-0 mt-2 text-[13px] leading-[1.45] text-ink-muted">
        Wer beantragt, sieht unter „Zeiten“, „Urlaub“, wie entschieden ist, und liest dort die
        Antwort.
      </p>
    </Panel>
  )
}

function OverviewTable({ overview }: { readonly overview: AbsenceOverview }) {
  const faint = (halves: number) => (halves === 0 ? 'text-ink-faint' : undefined)

  if (overview.people.length === 0) {
    return (
      <Empty>
        Noch keine Akte. Abwesenheiten gibt es für jede Person mit einer Akte unter „Mitarbeiter“.
      </Empty>
    )
  }

  return (
    <TablePanel
      caption={`Urlaub ${String(overview.year)}, in Arbeitstagen`}
      cards={overview.people.map((person) => ({
        key: person.id,
        title: (
          <Link to="/abwesenheiten/$personId" params={{ personId: person.id }} className={cardLink}>
            {person.name}
          </Link>
        ),
        sub: (
          <>
            {`${dayCount(person.leave.approvedHalfDays)} von ${dayCount(person.leave.entitledHalfDays)}`}
            {person.leave.carriedHalfDays > 0 ? ` + ${dayCount(person.leave.carriedHalfDays)}` : ''}
            {' freigegeben'}
            {person.leave.requestedHalfDays > 0
              ? `, ${dayCount(person.leave.requestedHalfDays)} beantragt`
              : ''}
            {`, Rest ${dayCount(person.leave.restHalfDays)}`}
            {person.awayToday ? <AwayToday away={person.awayToday} /> : null}
          </>
        ),
      }))}
      note={countingNote(overview.state)}
    >
      <thead>
        <tr>
          <Column className="min-w-[200px]">Name</Column>
          <Column numeric className="w-[92px]">
            Anspruch
          </Column>
          <Column numeric className="w-[88px]">
            Übertrag
          </Column>
          <Column numeric className="w-[104px]">
            Freigegeben
          </Column>
          <Column numeric className="w-[96px]">
            Beantragt
          </Column>
          <Column numeric className="w-[70px]">
            Rest
          </Column>
          <Column numeric className="w-[70px]">
            Krank
          </Column>
        </tr>
      </thead>
      <tbody>
        {overview.people.map((person) => (
          <tr key={person.id}>
            <Cell className="font-medium">
              <Link
                to="/abwesenheiten/$personId"
                params={{ personId: person.id }}
                className="text-ink no-underline hover:underline"
              >
                {person.name}
              </Link>
              {person.awayToday ? <AwayToday away={person.awayToday} /> : null}
            </Cell>
            <Cell numeric>{dayCount(person.leave.entitledHalfDays)}</Cell>
            <Cell numeric>{dayCount(person.leave.carriedHalfDays)}</Cell>
            <Cell numeric>{dayCount(person.leave.approvedHalfDays)}</Cell>
            <Cell numeric className={faint(person.leave.requestedHalfDays)}>
              {dayCount(person.leave.requestedHalfDays)}
            </Cell>
            <Cell numeric className="font-semibold">
              {dayCount(person.leave.restHalfDays)}
            </Cell>
            <Cell numeric className={faint(person.leave.sickHalfDays)}>
              {dayCount(person.leave.sickHalfDays)}
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function AwayToday({
  away,
}: {
  readonly away: NonNullable<AbsenceOverview['people'][number]['awayToday']>
}) {
  const word = away.kind === 'sickness' ? 'Krank' : 'Urlaub'

  return (
    <span className="ml-2 inline-block align-middle">
      <Status tone="waiting">{`${word} bis ${date(away.lastDay).slice(0, 6)}`}</Status>
    </span>
  )
}

/** The year of one person: what they are entitled to and every absence with its kind. */
export function AbsencePersonScreen() {
  const { personId } = useParams({ strict: false }) as { readonly personId: string }
  const [year, setYear] = useState(() => Number(today().slice(0, 4)))
  const found = useQuery({
    queryKey: [...absencesKey, 'person', personId, year],
    queryFn: () => personYear(personId, year),
  })
  const [asking, setAsking] = useState<Asking | null>(null)
  const close = () => {
    setAsking(null)
  }

  if (found.isError) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: base, label: 'Abwesenheiten' }]} />
        <Empty>Diese Person gibt es nicht oder nicht mehr.</Empty>
      </Screen>
    )
  }

  const current = found.data

  return (
    <Screen>
      <PageHead
        title={current?.person.name ?? ''}
        crumbs={[
          { to: base, label: 'Abwesenheiten' },
          { to: `${base}/${personId}`, label: current?.person.name ?? '' },
        ]}
        phoneBack={{ to: base, label: 'Abwesenheiten' }}
        actions={
          current ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                setAsking({ kind: 'enter', personId })
              }}
            >
              Abwesenheit eintragen
            </Button>
          ) : null
        }
      />
      {current ? (
        <RecordColumns
          sideWidth={282}
          main={
            <>
              <YearChoice year={year} onChange={setYear} />
              <AbsencesTable
                data={current}
                onChange={(absence) => {
                  setAsking({ kind: 'change', absence, name: current.person.name })
                }}
                onRemove={(absence) => {
                  setAsking({ kind: 'remove', absence })
                }}
                onReject={(absence) => {
                  setAsking({ kind: 'reject', absence, name: current.person.name })
                }}
              />
            </>
          }
          side={
            <YearFacts
              data={current}
              onEntitlement={() => {
                setAsking({ kind: 'entitlement' })
              }}
            />
          }
        />
      ) : null}
      {current && asking?.kind === 'enter' ? (
        <AbsenceDialog
          people={[{ id: current.person.id, name: current.person.name }]}
          personId={current.person.id}
          absence={null}
          onClose={close}
        />
      ) : null}
      {current && asking?.kind === 'change' ? (
        <AbsenceDialog
          people={[{ id: current.person.id, name: current.person.name }]}
          personId={current.person.id}
          absence={asking.absence}
          onClose={close}
        />
      ) : null}
      {current && asking?.kind === 'entitlement' ? (
        <EntitlementDialog
          personId={current.person.id}
          name={current.person.name}
          year={year}
          onClose={close}
        />
      ) : null}
      {asking?.kind === 'remove' ? <RemoveDialog absence={asking.absence} onClose={close} /> : null}
      {asking?.kind === 'reject' ? (
        <RejectDialog absence={asking.absence} name={asking.name} onClose={close} />
      ) : null}
    </Screen>
  )
}

function AbsencesTable({
  data,
  onChange,
  onRemove,
  onReject,
}: {
  readonly data: NonNullable<Awaited<ReturnType<typeof personYear>>>
  readonly onChange: (absence: AbsenceView) => void
  readonly onRemove: (absence: AbsenceView) => void
  readonly onReject: (absence: AbsenceView) => void
}) {
  const queries = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)

  async function approve(absence: AbsenceView) {
    try {
      await approveRequest(absence.id)
      await queries.invalidateQueries({ queryKey: absencesKey })
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  const counted = (absence: AbsenceView): ReactNode => {
    if (absence.leaveHalfDays === null) {
      return <span className="text-ink-faint">Kein Urlaub</span>
    }

    if (absence.state === 'rejected') {
      return '0'
    }

    return absence.sickHalfDays > 0
      ? `${dayCount(absence.leaveHalfDays)}, ${dayCount(absence.sickHalfDays)} Tage krank`
      : dayCount(absence.leaveHalfDays)
  }

  const working = (absence: AbsenceView): string =>
    absence.holidays > 0
      ? `${dayCount(absence.workingHalfDays)}, ohne ${String(absence.holidays)} ${absence.holidays === 1 ? 'Feiertag' : 'Feiertage'}`
      : dayCount(absence.workingHalfDays)

  const tools = (absence: AbsenceView): ReactNode =>
    absence.state === 'requested' ? (
      <span className="mt-1.5 flex gap-1.5">
        <Button
          size="small"
          onClick={() => {
            onReject(absence)
          }}
        >
          Ablehnen
        </Button>
        <Button size="small" onClick={() => void approve(absence)}>
          Freigeben
        </Button>
      </span>
    ) : (
      <span className="ml-2.5 inline-flex gap-1 align-middle">
        <IconButton
          label={`${absenceKindLabel[absence.kind]} ab ${date(absence.firstDay)} ändern`}
          onClick={() => {
            onChange(absence)
          }}
        >
          <Pencil size={15} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={`${absenceKindLabel[absence.kind]} ab ${date(absence.firstDay)} entfernen`}
          onClick={() => {
            onRemove(absence)
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
        </IconButton>
      </span>
    )

  if (data.absences.length === 0) {
    return <Empty>{`${data.person.name} hat ${String(data.year)} keine Abwesenheit.`}</Empty>
  }

  return (
    <>
      <TablePanel
        caption={`Abwesenheiten ${String(data.year)}`}
        cards={data.absences.map((absence) => ({
          key: absence.id,
          title: `${absenceKindLabel[absence.kind]}, ${spanText(absence)}`,
          sub: (
            <>
              {`${working(absence)} Arbeitstage`}
              <span className="mt-1.5 block">
                <Status tone={stateTone[absence.state]}>
                  {absenceStateLabel(absence.kind, absence.state)}
                </Status>
              </span>
            </>
          ),
        }))}
        note={countingNote(data.state)}
      >
        <thead>
          <tr>
            <Column className="w-[86px]">Art</Column>
            <Column className="w-[102px]">Erster Tag</Column>
            <Column className="w-[102px]">Letzter Tag</Column>
            <Column className="w-[116px]">Arbeitstage</Column>
            <Column className="w-[116px]">Zählt als Urlaub</Column>
            <Column>Stand</Column>
          </tr>
        </thead>
        <tbody>
          {data.absences.map((absence) => (
            <tr key={absence.id}>
              <Cell className="font-medium">{absenceKindLabel[absence.kind]}</Cell>
              <Cell>
                {date(absence.firstDay)}
                {absence.startsAtNoon ? (
                  <span className="block text-[12px] text-ink-muted">ab Mittag</span>
                ) : null}
              </Cell>
              <Cell>
                {date(absence.lastDay)}
                {absence.endsAtNoon ? (
                  <span className="block text-[12px] text-ink-muted">bis Mittag</span>
                ) : null}
              </Cell>
              <Cell>{working(absence)}</Cell>
              <Cell>{counted(absence)}</Cell>
              <Cell>
                <Status tone={stateTone[absence.state]}>
                  {absenceStateLabel(absence.kind, absence.state)}
                </Status>
                {absence.answer ? (
                  <span className="mt-1 block text-[12px] text-ink-muted">{`„${absence.answer}“`}</span>
                ) : null}
                {tools(absence)}
              </Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      <Problem>{problem}</Problem>
    </>
  )
}

function YearFacts({
  data,
  onEntitlement,
}: {
  readonly data: NonNullable<Awaited<ReturnType<typeof personYear>>>
  readonly onEntitlement: () => void
}) {
  const days = (halves: number) => `${dayCount(halves)} ${halves === 2 ? 'Tag' : 'Tage'}`
  const facts: [string, ReactNode][] = [
    ['Anspruch', days(data.leave.entitledHalfDays)],
    ['Übertrag', `${days(data.leave.carriedHalfDays)} aus ${String(data.year - 1)}`],
    ['Freigegeben', days(data.leave.approvedHalfDays)],
    ['Beantragt', days(data.leave.requestedHalfDays)],
    ['Rest', <b key="rest">{days(data.leave.restHalfDays)}</b>],
  ]

  return (
    <Panel>
      <PanelLabel>{`Urlaub ${String(data.year)}`}</PanelLabel>
      <dl className="m-0 mt-2 grid grid-cols-[96px_1fr] gap-x-2 gap-y-[5px] text-[13px]">
        {facts.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-ink-faint">{key}</dt>
            <dd className="m-0 min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2.5">
        <Button icon={Pencil} onClick={onEntitlement}>
          Anspruch und Übertrag
        </Button>
      </div>
      <p className="m-0 mt-2.5 text-[13px] leading-[1.45] text-ink-muted">
        {`${data.person.name} sieht die eigenen Abwesenheiten unter „Zeiten“, „Urlaub“.`}
      </p>
    </Panel>
  )
}

/** Half days from what a days field holds: "30", "27,5"; nothing for anything else. */
export function halvesFrom(typed: string): number | null {
  const text = typed.trim().replace(',', '.')

  if (!/^\d{1,3}(\.[05])?$/.test(text)) {
    return null
  }

  return Math.round(Number(text) * 2)
}

/**
 * Leave or a sickness entered by the office, or the days of one changed. A
 * sickness has no note: there is no field for one, so nothing about why can
 * be written down.
 */
function AbsenceDialog({
  people,
  personId,
  absence,
  onClose,
}: {
  readonly people: readonly { readonly id: string; readonly name: string }[]
  readonly personId: string | null
  readonly absence: AbsenceView | null
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [person, setPerson] = useState(personId ?? people[0]?.id ?? '')
  const [kind, setKind] = useState<AbsenceKind>(absence?.kind ?? 'vacation')
  const [firstDay, setFirstDay] = useState<IsoDate>(absence?.firstDay ?? today())
  const [lastDay, setLastDay] = useState<IsoDate>(absence?.lastDay ?? today())
  const [startsAtNoon, setStartsAtNoon] = useState(absence?.startsAtNoon ?? false)
  const [endsAtNoon, setEndsAtNoon] = useState(absence?.endsAtNoon ?? false)
  const [note, setNote] = useState(absence?.note ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const span = { firstDay, lastDay, startsAtNoon, endsAtNoon }
  const name = people.find((candidate) => candidate.id === person)?.name ?? ''
  const count = useQuery({
    queryKey: [...absencesKey, 'days', person, kind, span],
    queryFn: () => daysForPerson(person, kind, span),
    enabled: person !== '' && firstDay !== '' && lastDay !== '' && lastDay >= firstDay,
    retry: false,
  })

  async function save(event: FormEvent) {
    event.preventDefault()

    const days = { ...span, note: kind === 'vacation' && note.trim() !== '' ? note.trim() : null }

    try {
      await (absence === null ? enterAbsence(person, kind, days) : changeAbsence(absence.id, days))
      await queries.invalidateQueries({ queryKey: absencesKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  const checkbox = (label: string, checked: boolean, change: (checked: boolean) => void) => (
    <label className="flex min-h-[34px] items-center gap-2 text-[14px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          change(event.target.checked)
        }}
      />
      {label}
    </label>
  )

  return (
    <Dialog
      title={absence === null ? 'Abwesenheit eintragen' : `${absenceKindLabel[kind]} ändern`}
      onClose={onClose}
      width={600}
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        {absence === null && personId === null ? (
          <SelectField
            label="Person"
            starred
            required
            value={person}
            options={people.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            onChange={setPerson}
          />
        ) : (
          <p className="m-0 text-[14px]">{name}</p>
        )}
        {absence === null ? (
          <Choice
            label="Art"
            value={kind}
            options={[
              {
                value: 'vacation',
                label: 'Urlaub',
                note: 'Freigegeben, sobald er eingetragen ist.',
              },
              {
                value: 'sickness',
                label: 'Krankheit',
                note: 'Nur dass und wie lange. Kein Grund, keine Bescheinigung.',
              },
            ]}
            onChange={setKind}
          />
        ) : null}
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div className="flex w-[160px] flex-col gap-1">
            <Field
              label="Erster Tag"
              type="date"
              starred
              required
              value={firstDay}
              onChange={(event) => {
                setFirstDay(event.target.value)
              }}
            />
            {checkbox('Erst ab Mittag', startsAtNoon, setStartsAtNoon)}
          </div>
          <div className="flex w-[160px] flex-col gap-1">
            <Field
              label="Letzter Tag"
              type="date"
              starred
              required
              value={lastDay}
              onChange={(event) => {
                setLastDay(event.target.value)
              }}
            />
            {checkbox('Nur bis Mittag', endsAtNoon, setEndsAtNoon)}
          </div>
        </div>
        {typeof count.data?.workingHalfDays === 'number' ? (
          <p className="m-0 rounded-[4px] bg-surface-sunken px-3 py-[9px] text-[14px]">
            <b>{`${dayCount(count.data.workingHalfDays)} Arbeitstage`}</b>
            <span className="text-ink-muted">
              {` nach der Arbeitszeit von ${name}.`}
              {count.data.holidays > 0
                ? ` ${String(count.data.holidays)} ${count.data.holidays === 1 ? 'Feiertag zählt' : 'Feiertage zählen'} nicht.`
                : ''}
            </span>
          </p>
        ) : null}
        {kind === 'vacation' ? (
          <TextArea
            label="Notiz"
            rows={2}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
            }}
          />
        ) : (
          <p className="m-0 text-[13px] leading-[1.45] text-ink-muted">
            Für eine Krankheit gibt es kein Notizfeld: OpenGewerk hält nur, dass und wie lange
            jemand krank ist. Wer nur plant, sieht „abwesend“.
          </p>
        )}
        <Problem>{problem}</Problem>
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={Check} disabled={person === ''}>
            {absence === null ? 'Eintragen' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function RejectDialog({
  absence,
  name,
  onClose,
}: {
  readonly absence: AbsenceView
  readonly name: string
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [answer, setAnswer] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()

    try {
      await rejectRequest(absence.id, answer.trim())
      await queries.invalidateQueries({ queryKey: absencesKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog title="Antrag ablehnen" onClose={onClose} width={520}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <p className="m-0 text-[14px]">
          {`${name}, ${spanText(absence)}, ${dayCount(absence.leaveHalfDays ?? 0)} Arbeitstage.`}
        </p>
        <TextArea
          label="Antwort"
          rows={3}
          maxLength={500}
          value={answer}
          hint={`${name} liest sie unter „Zeiten“, „Urlaub“.`}
          onChange={(event) => {
            setAnswer(event.target.value)
          }}
        />
        <Problem>{problem}</Problem>
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={X}>
            Ablehnen
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** The days of leave of a year and what is carried over, with the rest of the year before to take over. */
function EntitlementDialog({
  personId,
  name,
  year: shown,
  onClose,
}: {
  readonly personId: string
  readonly name: string
  readonly year: number
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [year, setYear] = useState(shown)
  const data = useQuery({
    queryKey: [...absencesKey, 'person', personId, year],
    queryFn: () => personYear(personId, year),
  })
  const [entitled, setEntitled] = useState<string | null>(null)
  const [carried, setCarried] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const leave = data.data?.leave
  const entitledText = entitled ?? (leave ? dayCount(leave.entitledHalfDays) : '')
  const carriedText = carried ?? (leave ? dayCount(leave.carriedHalfDays) : '')
  const rest = data.data?.restBefore ?? 0

  async function save(event: FormEvent) {
    event.preventDefault()

    const entitledHalfDays = halvesFrom(entitledText)
    const carriedHalfDays = halvesFrom(carriedText === '' ? '0' : carriedText)

    if (entitledHalfDays === null || carriedHalfDays === null) {
      setProblem('Ganze oder halbe Tage, etwa 30 oder 27,5.')

      return
    }

    try {
      await setEntitlement(personId, year, { entitledHalfDays, carriedHalfDays })
      await queries.invalidateQueries({ queryKey: absencesKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog title="Anspruch und Übertrag" onClose={onClose} width={600}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <p className="m-0 text-[14px]">{name}</p>
        <div className="w-[160px]">
          <SelectField
            label="Jahr"
            value={String(year)}
            options={[shown - 1, shown, shown + 1].map((which) => ({
              value: String(which),
              label: String(which),
            }))}
            onChange={(value) => {
              setYear(Number(value))
              setEntitled(null)
              setCarried(null)
            }}
          />
        </div>
        <div className="w-[160px]">
          <Field
            label="Anspruch"
            starred
            required
            inputMode="decimal"
            numeric
            unit="Tage"
            value={entitledText}
            hint="Ganze oder halbe Tage, nach der vereinbarten Arbeitszeit."
            onChange={(event) => {
              setEntitled(event.target.value)
            }}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-[160px]">
            <Field
              label={`Übertrag aus ${String(year - 1)}`}
              inputMode="decimal"
              numeric
              unit="Tage"
              value={carriedText}
              onChange={(event) => {
                setCarried(event.target.value)
              }}
            />
          </div>
          <Button
            icon={Copy}
            onClick={() => {
              setCarried(dayCount(rest))
            }}
          >
            {`Rest übernehmen: ${dayCount(rest)} Tage`}
          </Button>
        </div>
        <p className="m-0 text-[13px] leading-[1.45] text-ink-muted">
          {`Der Rest aus ${String(year - 1)} ist heute ${dayCount(rest)} Tage. Ob und wann ein Übertrag verfällt, entscheidet der Betrieb, OpenGewerk lässt ihn nicht von selbst verfallen.`}
        </p>
        <Problem>{problem}</Problem>
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={Check}>
            Speichern
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function RemoveDialog({
  absence,
  onClose,
}: {
  readonly absence: AbsenceView
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    await removeAbsence(absence.id)
    await queries.invalidateQueries({ queryKey: absencesKey })
    onClose()
  }

  return (
    <Confirm
      open
      title={`${absenceKindLabel[absence.kind]} entfernen`}
      confirm="Entfernen"
      tone="danger"
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void remove()}
    >
      {`${absenceKindLabel[absence.kind]}, ${spanText(absence)}. Das Änderungsprotokoll behält den Eintrag.`}
    </Confirm>
  )
}
