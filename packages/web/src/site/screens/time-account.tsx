import {
  type AccountDay,
  addDays,
  balanceOf,
  balanceText,
  hoursText,
  type IsoDate,
} from '@opengewerk/domain'
import { Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { SiteLink, SiteScreen, SiteText } from '@opengewerk/platform-web/site'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'

import { countedText, countingText, monthsOf, weekBalanceText } from '../../app/time-account.js'
import { ownTimeAccount, type TimeAccount } from '../../session/time-account.js'
import { SiteHeader } from '../header.js'

/**
 * One's own time account on site (#289): where it stands, this week day by
 * day, and the months of the year, the newest first. Boards "Zeitkonto",
 * "Zeitkonto, ohne Netz" and "Zeiten mit der Karte Zeitkonto" of the canvas,
 * version 97.
 *
 * The account is not on the device: its target comes from the file, the
 * absences and the holidays, which travel to none. Without a network the
 * screen says so instead of showing an old state.
 */

const weekdayNames = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
]

const ownKey = (from: IsoDate, to: IsoDate) => ['time-account', 'mine', from, to] as const

/** The Monday of the week a day is in. */
function mondayOf(on: IsoDate): IsoDate {
  return addDays(on, -((new Date(`${on}T12:00:00Z`).getUTCDay() + 6) % 7))
}

function useOwnAccount(from: IsoDate, to: IsoDate) {
  return useQuery({
    queryKey: ownKey(from, to),
    queryFn: () => ownTimeAccount(from, to),
    retry: false,
  })
}

function offline(error: unknown): boolean {
  return !(error instanceof RequestRefused)
}

function hasAccount(account: TimeAccount | undefined): account is TimeAccount {
  return account !== undefined && account.hasFile && account.startsOn !== null
}

/** The card "Zeitkonto" on "Zeiten": where it stands and this week so far. */
export function TimeAccountCard() {
  const monday = mondayOf(today())
  const week = useOwnAccount(monday, addDays(monday, 6))

  // Nothing until the account is there: without a network, without a file, without a working time.
  if (!hasAccount(week.data)) {
    return null
  }

  const counted = week.data.days.filter((day) => day.counted)
  const until =
    week.data.countedUntil === addDays(today(), -1)
      ? 'gezählt bis gestern'
      : `gezählt bis ${date(week.data.countedUntil ?? today())}`

  return (
    <Panel title="Zeitkonto">
      <div className="flex flex-col gap-2">
        <SiteText size={17}>
          {`${balanceText(week.data.balanceMinutes)} auf deinem Konto, ${until}.`}
        </SiteText>
        {counted.length > 0 ? (
          <SiteText muted size={15}>
            {`Diese Woche bis gestern: ${balanceText(balanceOf(counted).balanceMinutes)}`}
          </SiteText>
        ) : null}
        <SiteLink to="/zeitkonto">Zeitkonto ansehen</SiteLink>
      </div>
    </Panel>
  )
}

export function SiteTimeAccountScreen() {
  return (
    <SiteScreen gap={12}>
      <SiteHeader title="Zeitkonto" sub="Zeiten" />
      <OwnTimeAccount />
    </SiteScreen>
  )
}

function Line({
  title,
  sub,
  right,
  short = false,
}: {
  readonly title: string
  readonly sub: string
  readonly right: string
  readonly short?: boolean
}) {
  return (
    <li className="flex items-start gap-2.5 border-b border-row py-2.5 last:border-b-0">
      <div className="min-w-0 grow">
        <div className="text-[17px] font-bold">{title}</div>
        <div className="mt-0.5 text-[15px] text-ink-muted">{sub}</div>
      </div>
      <div
        className={`numeric text-[17px] font-bold whitespace-nowrap ${short ? 'text-waiting' : ''}`}
      >
        {right}
      </div>
    </li>
  )
}

/** A day of the week as a line: counted with its balance, today so far, later with its target. */
function dayLine(day: AccountDay, index: number, now: IsoDate) {
  const title = `${weekdayNames[index] ?? ''}, ${date(day.on).slice(0, 6)}`

  if (day.counted) {
    const balance = day.workedMinutes - day.targetMinutes

    return (
      <Line
        key={day.on}
        title={title}
        sub={`Soll ${hoursText(day.targetMinutes)} · Ist ${hoursText(day.workedMinutes)}`}
        right={balanceText(balance)}
        short={balance < 0}
      />
    )
  }

  if (day.on === now) {
    return (
      <Line
        key={day.on}
        title={title}
        sub={`Soll ${hoursText(day.targetMinutes)} · bisher ${hoursText(day.workedMinutes)}`}
        right="heute"
      />
    )
  }

  return <Line key={day.on} title={title} sub={`Soll ${hoursText(day.targetMinutes)}`} right="" />
}

/**
 * What the screen "Zeitkonto" holds below its header: where the account
 * stands, the week and the months, or why there is none of it.
 */
export function OwnTimeAccount() {
  const now = today()
  const monday = mondayOf(now)
  const year = Number(now.slice(0, 4))
  const week = useOwnAccount(monday, addDays(monday, 6))
  const months = useOwnAccount(
    `${String(year)}-01-01` as IsoDate,
    `${String(year)}-12-31` as IsoDate,
  )
  const error = week.error ?? months.error

  if (error !== null) {
    return (
      <Panel>
        <div className="flex flex-col gap-2">
          <SiteText size={17}>
            {offline(error) ? 'Ohne Netz lässt sich dein Zeitkonto nicht ansehen.' : error.message}
          </SiteText>
          {offline(error) ? (
            <SiteText muted size={15}>
              Sobald das Gerät wieder Netz hat, lädt die Seite von selbst.
            </SiteText>
          ) : null}
        </div>
      </Panel>
    )
  }

  if (week.data === undefined || months.data === undefined) {
    return <SiteText muted>Wird geladen.</SiteText>
  }

  if (!week.data.hasFile) {
    return (
      <SiteText>
        Für dich gibt es in diesem Betrieb noch keine Akte. Das Büro legt sie an; dann steht dein
        Zeitkonto hier.
      </SiteText>
    )
  }

  if (!hasAccount(week.data)) {
    return (
      <SiteText>
        In deiner Akte steht noch keine vereinbarte Arbeitszeit, deshalb gibt es kein Zeitkonto.
      </SiteText>
    )
  }

  const carried =
    months.data.startsOn !== null && months.data.startsOn < `${String(year)}-01-01`
      ? ` Übertrag aus ${String(year - 1)}: ${balanceText(months.data.balanceBeforeMinutes)}`
      : ''
  const days = week.data.days
    .map((day, index) => ({ day, index }))
    // A day with nothing agreed and nothing worked says nothing, as a weekend.
    .filter(({ day }) => day.targetMinutes > 0 || day.workedMinutes > 0)
  const balance = weekBalanceText(week.data)
  const rows = [...monthsOf(months.data)].reverse()

  return (
    <>
      <Panel>
        <div className="flex flex-col gap-1">
          <div className="numeric text-[32px] font-bold">
            {balanceText(week.data.balanceMinutes)}
          </div>
          <SiteText muted size={15}>{`${countedText(week.data)}.${carried}`}</SiteText>
        </div>
      </Panel>
      <Panel title="Diese Woche">
        <div className="flex flex-col gap-2">
          <ul className="m-0 list-none p-0">
            {days.map(({ day, index }) => dayLine(day, index, now))}
          </ul>
          {balance === null ? null : (
            <SiteText muted size={15}>
              {balance}
            </SiteText>
          )}
        </div>
      </Panel>
      <Panel title={`${String(year)} nach Monaten`}>
        <div className="flex flex-col gap-2">
          {rows.length === 0 ? (
            <SiteText muted size={15}>
              In diesem Jahr ist noch kein Tag gezählt.
            </SiteText>
          ) : (
            <ul className="m-0 list-none p-0">
              {rows.map((row) => (
                <Line
                  key={row.label}
                  title={row.label}
                  sub={`Soll ${hoursText(row.targetMinutes)} · Ist ${hoursText(row.workedMinutes)}`}
                  right={balanceText(row.balanceMinutes)}
                  short={row.balanceMinutes < 0}
                />
              ))}
            </ul>
          )}
          <SiteText muted size={15}>
            {countingText(months.data)}
          </SiteText>
        </div>
      </Panel>
    </>
  )
}
