import {
  addDays,
  type IsoDate,
  personLevelLabel,
  personLevels,
  type PersonLevel,
  type PersonStanding,
  qualificationStandingLabel,
  type QualificationStanding,
  type Weekday,
  weekdayLabel,
  weekdayMinutes,
  weekdays,
  weekdayShort,
} from '@opengewerk/platform-domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Check, LogOut, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'

import { Button, IconButton, useButtonLook } from '../components/button.js'
import { Dialog, DialogActions } from '../components/dialog.js'
import { Field, SelectField } from '../components/field.js'
import { cardLink, Panel, PanelLabel, TablePanel } from '../components/panel.js'
import { Status, type StatusTone } from '../components/status.js'
import { Cell, Column } from '../components/table.js'
import { date, scaledNumber, today } from '../format.js'
import {
  addQualification,
  addWorkingTime,
  changePerson,
  changeQualification,
  changeWorkingTime,
  freeAccounts,
  newOwnKind,
  newPerson,
  ownFile,
  peopleOf,
  type PersonFile,
  personOf,
  type QualificationRow,
  qualificationKindsOf,
  removeQualification,
  removeWorkingTime,
  type WorkingTimeRow,
} from '../session/people.js'
import { Empty, PageHead, RecordColumns, Screen } from './kit.js'

/**
 * The files of the people who work for a tenant (ADR 0016, opengewerk#287):
 * the list with what runs out, one file with the working time agreed from a
 * day on and the qualifications, a new file with or without an account, and
 * the own file of whoever reads "Konto". A working time whose day has begun
 * stays as it is; a change is a new one from a later day.
 *
 * What a role is called, who may read the files and what the deadline of a
 * qualification does are the application's words.
 */

export interface PeopleWords {
  /** The name of a role by its key: "Monteur". */
  readonly role: (key: string) => string
  /** Under the list: who reads and keeps the files. */
  readonly whoReads: string
  /** Under the qualifications: what happens before one runs out. */
  readonly beforeExpiry: string
}

export interface PeoplePaths {
  readonly people: string
  readonly person: (personId: string) => string
  readonly newPerson: string
}

export interface PeopleScreenProps {
  readonly words: PeopleWords
  readonly paths: PeoplePaths
  /** Whether the person may keep the files, as the application's right says. */
  readonly mayWrite: boolean
}

export interface PersonScreenProps extends PeopleScreenProps {
  readonly personId: string
}

const peopleKey = ['people'] as const

const standingTone: Readonly<Record<QualificationStanding, StatusTone>> = {
  valid: 'done',
  expiring: 'waiting',
  expired: 'conflict',
}

const personTone: Readonly<Record<PersonStanding, StatusTone>> = {
  joining: 'waiting',
  employed: 'done',
  left: 'neutral',
}

const personWord: Readonly<Record<PersonStanding, string>> = {
  joining: 'Tritt noch ein',
  employed: 'Beschäftigt',
  left: 'Ausgetreten',
}

function problemOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Das hat nicht geklappt.'
}

/** Minutes as hours the way a form shows them: "8", "7,5", "0". */
export function hoursOf(minutes: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(minutes / 60)
}

/** Hours as typed, "7,5", into whole minutes; null for what is no number of hours in a day. */
export function minutesOf(text: string): number | null {
  const hundredths = scaledNumber(text.trim() === '' ? '0' : text, 2)

  if (hundredths === null || hundredths < 0) {
    return null
  }

  const minutes = Math.round((hundredths * 60) / 100)

  return minutes > 24 * 60 ? null : minutes
}

function weekText(minutes: number | null): string {
  return minutes === null ? '' : `${hoursOf(minutes)} Std.`
}

/** The days of a working time with hours, "Mo 8, Di 8, Mi 8". */
function daysText(time: WorkingTimeRow): string {
  return weekdays
    .filter((day) => time[weekdayMinutes[day]] > 0)
    .map((day) => `${weekdayShort[day]} ${hoursOf(time[weekdayMinutes[day]])}`)
    .join(', ')
}

function Problem({ children }: { readonly children: string | null }) {
  return children ? (
    <p role="alert" className="m-0 text-[13px] font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

/** Everybody with a file, those at work or those who left. */
export function PeopleScreen({ words, paths, mayWrite: writes }: PeopleScreenProps) {
  const people = useQuery({ queryKey: [...peopleKey, 'list'], queryFn: peopleOf })
  const primary = useButtonLook('primary')
  const [left, setLeft] = useState(false)
  const rows = (people.data ?? []).filter((row) => (row.standing === 'left') === left)

  const qualificationsOf = (row: (typeof rows)[number]): ReactNode => {
    const { valid, expiring, expired } = row.qualifications

    if (expiring === 0 && expired === 0) {
      return (
        <span className="text-ink-faint">{valid === 0 ? 'Keine' : `${String(valid)} gültig`}</span>
      )
    }

    return (
      <span className="inline-flex flex-wrap gap-1.5">
        {expired > 0 ? <Status tone="conflict">{`${String(expired)} abgelaufen`}</Status> : null}
        {expiring > 0 ? (
          <Status tone="waiting">{`${String(expiring)} läuft bald ab`}</Status>
        ) : null}
      </span>
    )
  }

  const accessOf = (row: (typeof rows)[number]): string =>
    row.account === null ? 'Kein Zugang' : row.account.roles.map(words.role).join(', ')

  return (
    <Screen>
      <PageHead
        title="Mitarbeiter"
        count={people.isSuccess ? `${String(people.data.length)} Personen` : undefined}
        actions={
          writes ? (
            <Link to={paths.newPerson} className={primary}>
              <Plus size={15} aria-hidden="true" className="shrink-0" />
              Neue Akte
            </Link>
          ) : null
        }
      />
      <div className="flex gap-1.5" role="group" aria-label="Zeigen">
        {[false, true].map((which) => (
          <Button
            key={String(which)}
            size="small"
            tone={left === which ? 'dark' : 'secondary'}
            aria-pressed={left === which}
            onClick={() => {
              setLeft(which)
            }}
          >
            {which ? 'Ausgetreten' : 'Beschäftigt'}
          </Button>
        ))}
      </div>
      {people.isSuccess && rows.length === 0 ? (
        <Empty>
          {left
            ? 'Niemand ist ausgetreten.'
            : 'Noch keine Akte. Eine Akte gibt es auch für jemanden ohne Zugang, etwa einen Helfer ohne Telefon.'}
        </Empty>
      ) : (
        <TablePanel
          caption="Mitarbeiter"
          cards={rows.map((row) => ({
            key: row.id,
            title: (
              <Link to={paths.person(row.id)} className={cardLink}>
                {row.name}
              </Link>
            ),
            // The state of the qualifications under the line, as the board on the phone draws it.
            sub: (
              <>
                {[
                  accessOf(row),
                  row.joinedOn ? `seit ${date(row.joinedOn)}` : null,
                  weekText(row.weekMinutes),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                <span className="mt-2 block">{qualificationsOf(row)}</span>
              </>
            ),
          }))}
          note={words.whoReads}
        >
          <thead>
            <tr>
              <Column className="min-w-[200px]">Name</Column>
              <Column className="w-[170px]">Zugang</Column>
              <Column className="w-[110px]">Eintritt</Column>
              <Column numeric className="w-[120px]">
                Arbeitszeit
              </Column>
              <Column className="w-[250px]">Qualifikationen</Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Cell className="font-medium">
                  <Link to={paths.person(row.id)} className="text-ink no-underline hover:underline">
                    {row.name}
                  </Link>
                </Cell>
                <Cell className={row.account === null ? 'text-ink-faint' : 'text-ink-muted'}>
                  {accessOf(row)}
                </Cell>
                <Cell>{date(row.joinedOn)}</Cell>
                <Cell numeric>{weekText(row.weekMinutes)}</Cell>
                <Cell>{qualificationsOf(row)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}

type Asking =
  | { readonly kind: 'edit' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'time'; readonly time: WorkingTimeRow | null }
  | { readonly kind: 'qualification'; readonly qualification: QualificationRow | null }

/** One file: the working times from the latest down, the qualifications and the facts beside. */
export function PersonScreen({ personId, words, paths, mayWrite: writes }: PersonScreenProps) {
  const file = useQuery({
    queryKey: [...peopleKey, 'file', personId],
    queryFn: () => personOf(personId),
  })
  const [asking, setAsking] = useState<Asking | null>(null)
  const close = () => {
    setAsking(null)
  }

  if (file.isError) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: paths.people, label: 'Mitarbeiter' }]} />
        <Empty>Diese Akte gibt es nicht oder nicht mehr.</Empty>
      </Screen>
    )
  }

  const current = file.data

  return (
    <Screen>
      <PageHead
        title={current?.name ?? ''}
        crumbs={[
          { to: paths.people, label: 'Mitarbeiter' },
          { to: paths.person(personId), label: current?.name ?? '' },
        ]}
        phoneBack={{ to: paths.people, label: 'Mitarbeiter' }}
        badges={
          current ? (
            <Status tone={personTone[current.standing]}>{personWord[current.standing]}</Status>
          ) : null
        }
        sub={current?.joinedOn ? `Seit ${date(current.joinedOn)}` : undefined}
        actions={
          writes && current ? (
            <>
              {current.leftOn === null ? (
                <Button
                  icon={LogOut}
                  onClick={() => {
                    setAsking({ kind: 'leave' })
                  }}
                >
                  Austritt eintragen
                </Button>
              ) : null}
              <Button
                icon={Pencil}
                onClick={() => {
                  setAsking({ kind: 'edit' })
                }}
              >
                Bearbeiten
              </Button>
            </>
          ) : null
        }
      />
      {current ? (
        <RecordColumns
          sideWidth={282}
          main={
            <>
              <WorkingTimes
                file={current}
                writes={writes}
                onAsk={(time) => {
                  setAsking({ kind: 'time', time })
                }}
              />
              <Qualifications
                file={current}
                writes={writes}
                note={words.beforeExpiry}
                onAsk={(qualification) => {
                  setAsking({ kind: 'qualification', qualification })
                }}
              />
            </>
          }
          side={<FileFacts file={current} words={words} />}
        />
      ) : null}
      {current && asking?.kind === 'edit' ? (
        <EditPersonDialog file={current} words={words} onClose={close} />
      ) : null}
      {current && asking?.kind === 'leave' ? <LeaveDialog file={current} onClose={close} /> : null}
      {current && asking?.kind === 'time' ? (
        <WorkingTimeDialog file={current} time={asking.time} onClose={close} />
      ) : null}
      {current && asking?.kind === 'qualification' ? (
        <QualificationDialog file={current} qualification={asking.qualification} onClose={close} />
      ) : null}
    </Screen>
  )
}

function FileFacts({ file, words }: { readonly file: PersonFile; readonly words: PeopleWords }) {
  const facts: [string, ReactNode][] = [
    ['Zugang', file.account?.email ?? <span className="text-ink-faint">Kein Zugang</span>],
    ...(file.account
      ? [['Rollen', file.account.roles.map(words.role).join(', ')] as [string, ReactNode]]
      : []),
    ['Eintritt', date(file.joinedOn)],
    ['Austritt', file.leftOn ? date(file.leftOn) : <span className="text-ink-faint">Keiner</span>],
  ]

  return (
    <Panel>
      <PanelLabel>Akte</PanelLabel>
      <dl className="m-0 mt-2 grid grid-cols-[80px_1fr] gap-x-2 gap-y-[5px] text-[13px]">
        {facts.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-ink-faint">{key}</dt>
            <dd className="m-0 min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {file.account ? (
        <p className="m-0 mt-2.5 text-[13px] leading-[1.45] text-ink-muted">
          {`${file.name} liest diese Akte unter „Konto“.`}
        </p>
      ) : null}
    </Panel>
  )
}

function WorkingTimes({
  file,
  writes,
  onAsk,
}: {
  readonly file: PersonFile
  readonly writes: boolean
  readonly onAsk: (time: WorkingTimeRow | null) => void
}) {
  const queries = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)

  async function remove(time: WorkingTimeRow) {
    try {
      await removeWorkingTime(file.id, time.id)
      await queries.invalidateQueries({ queryKey: peopleKey })
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  const stateOf = (time: WorkingTimeRow): ReactNode =>
    time.holdsToday ? (
      <Status tone="done">Gilt heute</Status>
    ) : time.begun ? (
      <Status tone="neutral">Galt bis zur nächsten</Status>
    ) : (
      <Status tone="waiting">{`Ab ${date(time.validFrom)}`}</Status>
    )

  return (
    <TablePanel
      title="Vereinbarte Arbeitszeit"
      caption="Vereinbarte Arbeitszeit"
      action={
        writes ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              onAsk(null)
            }}
          >
            Neue Arbeitszeit
          </Button>
        ) : null
      }
      cards={file.workingTimes.map((time) => ({
        key: time.id,
        title: `Ab ${date(time.validFrom)} · ${weekText(time.weekMinutes)}`,
        sub: daysText(time),
        right: stateOf(time),
      }))}
      note={
        <>
          Stunden je Wochentag. Eine Arbeitszeit gilt ab ihrem Tag bis zum Tag vor der nächsten. Hat
          ihr Tag begonnen, bleibt sie, wie sie ist; eine Änderung ist eine neue ab einem späteren
          Tag.
          {problem ? (
            <span role="alert" className="block font-semibold text-conflict">
              {problem}
            </span>
          ) : null}
        </>
      }
    >
      <thead>
        <tr>
          <Column className="w-[104px]">Gültig ab</Column>
          {weekdays.map((day) => (
            <Column key={day} numeric className="w-[46px]">
              <abbr title={weekdayLabel[day]} className="no-underline">
                {weekdayShort[day]}
              </abbr>
            </Column>
          ))}
          <Column numeric className="w-[84px]">
            Je Woche
          </Column>
          <Column className="min-w-[150px]">
            <span className="sr-only">Zustand</span>
          </Column>
        </tr>
      </thead>
      <tbody>
        {file.workingTimes.map((time) => (
          <tr key={time.id}>
            <Cell>{date(time.validFrom)}</Cell>
            {weekdays.map((day) => {
              const minutes = time[weekdayMinutes[day]]

              return (
                <Cell key={day} numeric className={minutes === 0 ? 'text-ink-faint' : undefined}>
                  {hoursOf(minutes)}
                </Cell>
              )
            })}
            <Cell numeric className="font-semibold">
              {weekText(time.weekMinutes)}
            </Cell>
            <Cell>
              <span className="inline-flex items-center gap-2">
                {stateOf(time)}
                {writes && !time.begun ? (
                  <>
                    <IconButton
                      label={`Arbeitszeit ab ${date(time.validFrom)} ändern`}
                      onClick={() => {
                        onAsk(time)
                      }}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`Arbeitszeit ab ${date(time.validFrom)} entfernen`}
                      onClick={() => void remove(time)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  </>
                ) : null}
              </span>
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function Qualifications({
  file,
  writes,
  note,
  onAsk,
}: {
  readonly file: PersonFile
  readonly writes: boolean
  readonly note: string
  readonly onAsk: (qualification: QualificationRow | null) => void
}) {
  const kindOf = (row: QualificationRow) => (
    <>
      <span className="font-medium">{row.kindLabel}</span>
      {row.ownKindId ? <span className="ml-1.5 text-[12px] text-ink-faint">eigene Art</span> : null}
      {row.kindLevel ? (
        <span className="block text-[12px] text-ink-muted">{personLevelLabel[row.kindLevel]}</span>
      ) : null}
    </>
  )

  return (
    <TablePanel
      title="Qualifikationen"
      caption="Qualifikationen"
      action={
        writes ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              onAsk(null)
            }}
          >
            Qualifikation hinzufügen
          </Button>
        ) : null
      }
      cards={file.qualifications.map((row) => ({
        key: row.id,
        title: row.kindLabel,
        sub: row.validUntil ? `bis ${date(row.validUntil)}` : 'läuft nicht ab',
        right: (
          <Status tone={standingTone[row.standing]}>
            {qualificationStandingLabel[row.standing]}
          </Status>
        ),
      }))}
      note={note}
    >
      <thead>
        <tr>
          <Column className="min-w-[180px]">Art und Stufe</Column>
          <Column className="w-[110px]">Gültig bis</Column>
          <Column className="w-[170px]">Stand</Column>
          <Column className="w-[200px]">Notiz</Column>
        </tr>
      </thead>
      <tbody>
        {file.qualifications.map((row) => (
          <tr key={row.id}>
            <Cell>{kindOf(row)}</Cell>
            <Cell className={row.validUntil ? undefined : 'text-ink-faint'}>
              {row.validUntil ? date(row.validUntil) : 'Läuft nicht ab'}
            </Cell>
            <Cell>
              <span className="inline-flex items-center gap-2">
                <Status tone={standingTone[row.standing]}>
                  {qualificationStandingLabel[row.standing]}
                </Status>
                {writes ? (
                  <IconButton
                    label={`${row.kindLabel} ändern`}
                    onClick={() => {
                      onAsk(row)
                    }}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </IconButton>
                ) : null}
              </span>
            </Cell>
            <Cell className="text-ink-muted">
              {row.certificateSha256 ? <Paperclip aria-label="Nachweis" size={14} /> : null}
              {row.note ?? ''}
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The hours of the seven days, as typed. */
type HoursTyped = Readonly<Record<Weekday, string>>

const noHours: HoursTyped = {
  monday: '0',
  tuesday: '0',
  wednesday: '0',
  thursday: '0',
  friday: '0',
  saturday: '0',
  sunday: '0',
}

function hoursFrom(time: WorkingTimeRow | null): HoursTyped {
  return time === null
    ? noHours
    : (Object.fromEntries(
        weekdays.map((day) => [day, hoursOf(time[weekdayMinutes[day]])]),
      ) as HoursTyped)
}

/** The minutes of each day as the routes take them, or the first day that is no number of hours. */
function minutesFrom(hours: HoursTyped): Record<string, number> | Weekday {
  const minutes: Record<string, number> = {}

  for (const day of weekdays) {
    const value = minutesOf(hours[day])

    if (value === null) {
      return day
    }

    minutes[weekdayMinutes[day]] = value
  }

  return minutes
}

function HoursFields({
  hours,
  onChange,
}: {
  readonly hours: HoursTyped
  readonly onChange: (hours: HoursTyped) => void
}) {
  const total = minutesFrom(hours)

  return (
    <>
      <div className="flex flex-wrap gap-x-3 gap-y-2.5">
        {weekdays.map((day) => (
          <div key={day} className="w-[72px]">
            <Field
              label={weekdayShort[day]}
              aria-label={weekdayLabel[day]}
              inputMode="decimal"
              numeric
              className="text-right"
              unit="Std."
              value={hours[day]}
              onChange={(event) => {
                onChange({ ...hours, [day]: event.target.value })
              }}
            />
          </div>
        ))}
      </div>
      <p className="m-0 flex items-baseline gap-2 text-[14px]">
        <span className="text-ink-muted">Je Woche</span>
        <b className="numeric text-[16px]">
          {typeof total === 'string'
            ? ''
            : `${hoursOf(Object.values(total).reduce((sum, value) => sum + value, 0))} Std.`}
        </b>
      </p>
    </>
  )
}

/** A new file, for somebody with an account here or without one, with the first working time. */
export function NewPersonScreen({ words, paths }: Omit<PeopleScreenProps, 'mayWrite'>) {
  const navigate = useNavigate()
  const queries = useQueryClient()
  const secondary = useButtonLook()
  const accounts = useQuery({ queryKey: [...peopleKey, 'accounts'], queryFn: freeAccounts })
  const [name, setName] = useState('')
  const [userId, setUserId] = useState('')
  const [joinedOn, setJoinedOn] = useState<IsoDate>(today())
  const [validFrom, setValidFrom] = useState<IsoDate>(today())
  const [hours, setHours] = useState<HoursTyped>(noHours)
  const [problem, setProblem] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()

    const minutes = minutesFrom(hours)

    if (typeof minutes === 'string') {
      setProblem(`${weekdayLabel[minutes]}: von 0 bis 24 Stunden.`)
      return
    }

    try {
      const created = await newPerson({
        name,
        userId: userId === '' ? null : userId,
        joinedOn: joinedOn === '' ? null : joinedOn,
        workingTime: { validFrom, ...minutes },
      })
      await queries.invalidateQueries({ queryKey: peopleKey })
      await navigate({ to: paths.person(created.id) })
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Screen>
      <form className="flex flex-col gap-3.5" onSubmit={(event) => void save(event)}>
        <PageHead
          title="Neue Akte"
          crumbs={[
            { to: paths.people, label: 'Mitarbeiter' },
            { to: paths.newPerson, label: 'Neue Akte' },
          ]}
          phoneBack={{ to: paths.people, label: 'Mitarbeiter' }}
          actions={
            <>
              <Link to={paths.people} className={secondary}>
                Abbrechen
              </Link>
              <Button type="submit" tone="primary" icon={Check}>
                Anlegen
              </Button>
            </>
          }
        />
        <Problem>{problem}</Problem>
        <Panel>
          <PanelLabel>Person</PanelLabel>
          <div className="mt-2.5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
            <Field
              label="Name"
              starred
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
            <SelectField
              label="Zugang"
              value={userId}
              options={[
                { value: '', label: 'Kein Zugang' },
                ...(accounts.data ?? []).map((account) => ({
                  value: account.userId,
                  label: `${account.name} (${account.roles.map(words.role).join(', ')})`,
                })),
              ]}
              onChange={setUserId}
              hint="Ohne Zugang, etwa für einen Helfer ohne Telefon. Ein Zugang lässt sich später verbinden, wenn er noch zu keiner Akte gehört."
            />
            <Field
              label="Eintritt"
              type="date"
              value={joinedOn}
              onChange={(event) => {
                setJoinedOn(event.target.value)
              }}
            />
          </div>
        </Panel>
        <Panel>
          <PanelLabel>Vereinbarte Arbeitszeit</PanelLabel>
          <p className="m-0 mt-1 text-[13px] text-ink-faint">
            Stunden je Wochentag. Eine spätere Änderung ist eine neue Arbeitszeit ab ihrem Tag.
          </p>
          <div className="mt-2.5 flex flex-col gap-3">
            <div className="w-[160px]">
              <Field
                label="Gültig ab"
                type="date"
                starred
                required
                value={validFrom}
                onChange={(event) => {
                  setValidFrom(event.target.value)
                }}
              />
            </div>
            <HoursFields hours={hours} onChange={setHours} />
          </div>
        </Panel>
      </form>
    </Screen>
  )
}

function EditPersonDialog({
  file,
  words,
  onClose,
}: {
  readonly file: PersonFile
  readonly words: PeopleWords
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const accounts = useQuery({ queryKey: [...peopleKey, 'accounts'], queryFn: freeAccounts })
  const [name, setName] = useState(file.name)
  const [userId, setUserId] = useState(file.userId ?? '')
  const [joinedOn, setJoinedOn] = useState(file.joinedOn ?? '')
  const [leftOn, setLeftOn] = useState(file.leftOn ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const choices = [
    { value: '', label: 'Kein Zugang' },
    ...(file.account
      ? [{ value: file.account.userId, label: `${file.account.name} (${file.account.email})` }]
      : []),
    ...(accounts.data ?? []).map((account) => ({
      value: account.userId,
      label: `${account.name} (${account.roles.map(words.role).join(', ')})`,
    })),
  ]

  async function save(event: FormEvent) {
    event.preventDefault()

    try {
      await changePerson(file.id, {
        name,
        userId: userId === '' ? null : userId,
        joinedOn: joinedOn === '' ? null : joinedOn,
        leftOn: leftOn === '' ? null : leftOn,
      })
      await queries.invalidateQueries({ queryKey: peopleKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog title={`${file.name} bearbeiten`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <Field
          label="Name"
          starred
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <SelectField label="Zugang" value={userId} options={choices} onChange={setUserId} />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Eintritt"
            type="date"
            value={joinedOn}
            onChange={(event) => {
              setJoinedOn(event.target.value)
            }}
          />
          <Field
            label="Austritt"
            type="date"
            value={leftOn}
            onChange={(event) => {
              setLeftOn(event.target.value)
            }}
          />
        </div>
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

function LeaveDialog({
  file,
  onClose,
}: {
  readonly file: PersonFile
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [leftOn, setLeftOn] = useState<IsoDate>(today())
  const [problem, setProblem] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()

    try {
      await changePerson(file.id, { leftOn })
      await queries.invalidateQueries({ queryKey: peopleKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog title="Austritt eintragen" onClose={onClose} width={520}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <p className="m-0 text-[14px] leading-[1.55]">
          {`Der letzte Arbeitstag von ${file.name}. Die Akte bleibt; Fristen ihrer Qualifikationen entfallen danach.`}
        </p>
        <div className="w-[160px]">
          <Field
            label="Austritt"
            type="date"
            starred
            required
            value={leftOn}
            onChange={(event) => {
              setLeftOn(event.target.value)
            }}
          />
        </div>
        <Problem>{problem}</Problem>
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={Check}>
            Eintragen
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function WorkingTimeDialog({
  file,
  time,
  onClose,
}: {
  readonly file: PersonFile
  readonly time: WorkingTimeRow | null
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [validFrom, setValidFrom] = useState<IsoDate>(time?.validFrom ?? today())
  const [hours, setHours] = useState<HoursTyped>(hoursFrom(time ?? file.workingTimes[0] ?? null))
  const [problem, setProblem] = useState<string | null>(null)
  const before = file.workingTimes.find(
    (each) => each.id !== time?.id && each.validFrom < validFrom,
  )

  async function save(event: FormEvent) {
    event.preventDefault()

    const minutes = minutesFrom(hours)

    if (typeof minutes === 'string') {
      setProblem(`${weekdayLabel[minutes]}: von 0 bis 24 Stunden.`)
      return
    }

    try {
      await (time === null
        ? addWorkingTime(file.id, { validFrom, ...minutes })
        : changeWorkingTime(file.id, time.id, { validFrom, ...minutes }))
      await queries.invalidateQueries({ queryKey: peopleKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog
      title={time === null ? 'Neue Arbeitszeit' : 'Arbeitszeit ändern'}
      onClose={onClose}
      width={640}
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <div className="w-[160px]">
          <Field
            label="Gültig ab"
            type="date"
            starred
            required
            min={today()}
            value={validFrom}
            onChange={(event) => {
              setValidFrom(event.target.value)
            }}
          />
        </div>
        <p className="m-0 text-[13px] text-ink-faint">
          {before && validFrom !== ''
            ? `Heute oder später. Die bisherige gilt dann bis zum ${date(addDays(validFrom, -1))} und bleibt für die Zeit davor.`
            : 'Heute oder später.'}
        </p>
        <HoursFields hours={hours} onChange={setHours} />
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

function QualificationDialog({
  file,
  qualification,
  onClose,
}: {
  readonly file: PersonFile
  readonly qualification: QualificationRow | null
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const kinds = useQuery({ queryKey: [...peopleKey, 'kinds'], queryFn: qualificationKindsOf })
  const initial = qualification?.ownKindId
    ? `own:${qualification.ownKindId}`
    : qualification?.kindKey
      ? `key:${qualification.kindKey}`
      : ''
  const [kind, setKind] = useState(initial)
  const [validUntil, setValidUntil] = useState(qualification?.validUntil ?? '')
  const [endless, setEndless] = useState(
    qualification !== null && qualification.validUntil === null,
  )
  const [note, setNote] = useState(qualification?.note ?? '')
  const [adding, setAdding] = useState(false)
  const [ownLabel, setOwnLabel] = useState('')
  const [ownLevel, setOwnLevel] = useState<PersonLevel>('instructed_person')
  const [problem, setProblem] = useState<string | null>(null)
  const options = [
    { value: '', label: 'Bitte wählen' },
    ...(kinds.data?.catalogue ?? []).map((each) => ({
      value: `key:${each.key}`,
      label: each.label,
    })),
    ...(kinds.data?.own ?? []).map((each) => ({
      value: `own:${each.id}`,
      label: `${each.label} (eigene Art)`,
    })),
  ]

  async function addKind() {
    try {
      const created = await newOwnKind({ label: ownLabel, level: ownLevel })
      await queries.invalidateQueries({ queryKey: [...peopleKey, 'kinds'] })
      setKind(`own:${created.id}`)
      setAdding(false)
      setOwnLabel('')
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()

    const fields = {
      kindKey: kind.startsWith('key:') ? kind.slice(4) : null,
      ownKindId: kind.startsWith('own:') ? kind.slice(4) : null,
      validUntil: endless || validUntil === '' ? null : validUntil,
      note,
    }

    try {
      await (qualification === null
        ? addQualification(file.id, fields)
        : changeQualification(file.id, qualification.id, fields))
      await queries.invalidateQueries({ queryKey: peopleKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  async function remove() {
    if (qualification === null) {
      return
    }

    try {
      await removeQualification(file.id, qualification.id)
      await queries.invalidateQueries({ queryKey: peopleKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog
      title={
        qualification === null ? 'Qualifikation hinzufügen' : `${qualification.kindLabel} ändern`
      }
      onClose={onClose}
      width={600}
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[220px] grow">
            <SelectField
              label="Art"
              starred
              required
              value={kind}
              options={options}
              onChange={setKind}
            />
          </div>
          {adding ? null : (
            <Button
              icon={Plus}
              onClick={() => {
                setAdding(true)
              }}
            >
              Eigene Art anlegen
            </Button>
          )}
        </div>
        {adding ? (
          <div className="flex flex-col gap-2.5 rounded-[5px] border border-line bg-surface-sunken p-3">
            <Field
              label="Bezeichnung der eigenen Art"
              value={ownLabel}
              onChange={(event) => {
                setOwnLabel(event.target.value)
              }}
            />
            <SelectField
              label="Stufe"
              value={ownLevel}
              options={personLevels.map((level) => ({
                value: level,
                label: personLevelLabel[level],
              }))}
              onChange={(value) => {
                setOwnLevel(value as PersonLevel)
              }}
            />
            <DialogActions>
              <Button
                size="small"
                onClick={() => {
                  setAdding(false)
                }}
              >
                Abbrechen
              </Button>
              <Button size="small" icon={Plus} onClick={() => void addKind()}>
                Art anlegen
              </Button>
            </DialogActions>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-[160px]">
            <Field
              label="Gültig bis"
              type="date"
              disabled={endless}
              value={endless ? '' : validUntil}
              onChange={(event) => {
                setValidUntil(event.target.value)
              }}
            />
          </div>
          <label className="flex min-h-[34px] items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={endless}
              onChange={(event) => {
                setEndless(event.target.checked)
              }}
            />
            Läuft nicht ab
          </label>
        </div>
        <Field
          label="Notiz"
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
        <Problem>{problem}</Problem>
        <DialogActions>
          {qualification === null ? null : (
            <Button tone="danger" icon={Trash2} onClick={() => void remove()}>
              Entfernen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={qualification === null ? Plus : Check}>
            {qualification === null ? 'Hinzufügen' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * "Meine Akte" under "Konto": the own file of whoever reads it, read only,
 * and nothing at all for somebody without a file here.
 */
export function OwnFilePanel() {
  const file = useQuery({ queryKey: [...peopleKey, 'mine'], queryFn: ownFile })
  const current = file.data

  if (!current) {
    return null
  }

  const line = (key: string, first: string, second: string, right: ReactNode) => (
    <li key={key} className="flex items-start gap-2.5 border-t border-row py-2.5">
      <div className="min-w-0 grow">
        <div className="text-[15px] font-medium">{first}</div>
        <div className="mt-0.5 text-[14px] text-ink-muted">{second}</div>
      </div>
      {right}
    </li>
  )

  return (
    <Panel>
      <PanelLabel>Meine Akte</PanelLabel>
      {current.joinedOn ? (
        <p className="m-0 mt-2 text-[14px]">
          <span className="text-ink-faint">Eintritt</span> {date(current.joinedOn)}
        </p>
      ) : null}
      <div className="mt-1 grid gap-x-6 lg:grid-cols-2">
        <section aria-label="Vereinbarte Arbeitszeit">
          <h3 className="m-0 mt-2 font-condensed text-[12px] font-semibold uppercase tracking-[1.1px] text-ink-faint">
            Vereinbarte Arbeitszeit
          </h3>
          <ul className="m-0 list-none p-0">
            {current.workingTimes.map((time) =>
              line(
                time.id,
                `Ab ${date(time.validFrom)} · ${weekText(time.weekMinutes)}`,
                daysText(time),
                time.holdsToday ? (
                  <Status tone="done">Gilt heute</Status>
                ) : time.begun ? null : (
                  <Status tone="waiting">Künftig</Status>
                ),
              ),
            )}
          </ul>
        </section>
        <section aria-label="Qualifikationen">
          <h3 className="m-0 mt-2 font-condensed text-[12px] font-semibold uppercase tracking-[1.1px] text-ink-faint">
            Qualifikationen
          </h3>
          <ul className="m-0 list-none p-0">
            {current.qualifications.map((row) =>
              line(
                row.id,
                row.kindLabel,
                row.validUntil ? `bis ${date(row.validUntil)}` : 'läuft nicht ab',
                <Status tone={standingTone[row.standing]}>
                  {qualificationStandingLabel[row.standing]}
                </Status>,
              ),
            )}
          </ul>
        </section>
      </div>
      <p className="m-0 mt-2.5 text-[13px] leading-[1.45] text-ink-muted">
        Ändern kann sie, wer Akten pflegt.
      </p>
    </Panel>
  )
}
