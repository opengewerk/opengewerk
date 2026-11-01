import { addDays, balanceText, hoursText, type IsoDate } from '@opengewerk/domain'
import { Button, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import type { TableCard } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { countingText, monthsOf, standingText } from '../../app/time-account.js'
import { type TimeAccount, timeAccountOf } from '../../session/time-account.js'

/**
 * The time account (#289) on the screen "Zeiterfassung": the target of each
 * day of the week, the balance of the week up to yesterday, and the account
 * of a year by months, with what came over from the year before. The office
 * reads it for one person at a time, like the week, behind the same right.
 */

function problemOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Das hat nicht geklappt.'
}

export const timeAccountKey = (userId: string, from: IsoDate, to: IsoDate) =>
  ['time-account', userId, from, to] as const

/** The account of a person for the days of one week. */
export function useWeekAccount(userId: string, monday: IsoDate) {
  const sunday = addDays(monday, 6)

  return useQuery({
    queryKey: timeAccountKey(userId, monday, sunday),
    queryFn: () => timeAccountOf(userId, monday, sunday),
    enabled: userId !== '',
    retry: false,
  })
}

function YearChoice({
  years,
  year,
  onChange,
}: {
  readonly years: readonly number[]
  readonly year: number
  readonly onChange: (year: number) => void
}) {
  return (
    <div className="flex gap-1.5" role="group" aria-label="Jahr">
      {years.map((which) => (
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

const balanceCell = (minutes: number) => (
  <span className={minutes < 0 ? 'text-waiting' : undefined}>{balanceText(minutes)}</span>
)

/** Why there is no account, or null where there is one. */
export function missingAccountText(account: TimeAccount): string | null {
  if (!account.hasFile) {
    return 'Für diese Person gibt es keine Akte. Ohne vereinbarte Arbeitszeit gibt es kein Zeitkonto.'
  }

  return account.startsOn === null
    ? 'In der Akte steht keine vereinbarte Arbeitszeit, deshalb gibt es kein Zeitkonto.'
    : null
}

/** The account of one person for a year, by months, under the week. */
export function AccountPanel({ userId }: { readonly userId: string }) {
  const now = Number(today().slice(0, 4))
  const [year, setYear] = useState(now)
  const from = `${String(year)}-01-01` as IsoDate
  const to = `${String(year)}-12-31` as IsoDate
  const account = useQuery({
    queryKey: timeAccountKey(userId, from, to),
    queryFn: () => timeAccountOf(userId, from, to),
    enabled: userId !== '',
    retry: false,
  })

  if (account.isError) {
    return (
      <Panel title="Zeitkonto">
        <p className="m-0 text-[14px] text-ink-muted">{problemOf(account.error)}</p>
      </Panel>
    )
  }

  if (account.data === undefined) {
    return null
  }

  const missing = missingAccountText(account.data)

  if (missing !== null) {
    return (
      <Panel title="Zeitkonto">
        <p className="m-0 text-[14px] text-ink-muted">{missing}</p>
      </Panel>
    )
  }

  const first = Number((account.data.startsOn ?? from).slice(0, 4))
  const years = Array.from(
    { length: now - Math.max(first, now - 4) + 1 },
    (_, at) => Math.max(first, now - 4) + at,
  )
  const rows = monthsOf(account.data)
  const carried = account.data.startsOn !== null && account.data.startsOn < from
  const cards: TableCard[] = [
    ...(carried
      ? [
          {
            key: 'carried',
            title: `Übertrag aus ${String(year - 1)}`,
            right: balanceText(account.data.balanceBeforeMinutes),
          },
        ]
      : []),
    ...rows.map((row) => ({
      key: row.label,
      title: row.label,
      sub: `Soll ${hoursText(row.targetMinutes)} · Ist ${hoursText(row.workedMinutes)} · Stand ${balanceText(row.standingMinutes)}`,
      right: balanceCell(row.balanceMinutes),
    })),
  ]

  return (
    <TablePanel
      title={`Zeitkonto ${String(year)}`}
      action={years.length > 1 ? <YearChoice years={years} year={year} onChange={setYear} /> : null}
      caption={`Zeitkonto ${String(year)} nach Monaten`}
      cards={cards}
      cardsEmpty={
        <p className="m-0 text-[14px] text-ink-muted">In diesem Jahr ist noch kein Tag gezählt.</p>
      }
      note={
        <>
          <strong className="font-semibold text-ink">{standingText(account.data)}</strong>
          <br />
          {countingText(account.data)}
        </>
      }
    >
      <thead>
        <tr>
          <Column className="w-[220px]">Monat</Column>
          <Column numeric className="w-[110px]">
            Soll
          </Column>
          <Column numeric className="w-[110px]">
            Ist
          </Column>
          <Column numeric className="w-[110px]">
            Saldo
          </Column>
          <Column numeric>Stand am Ende</Column>
        </tr>
      </thead>
      <tbody>
        {carried ? (
          <tr>
            <Cell className="text-ink-muted">{`Übertrag aus ${String(year - 1)}`}</Cell>
            <Cell numeric>{''}</Cell>
            <Cell numeric>{''}</Cell>
            <Cell numeric>{''}</Cell>
            <Cell numeric className="font-semibold">
              {balanceText(account.data.balanceBeforeMinutes)}
            </Cell>
          </tr>
        ) : null}
        {rows.map((row) => (
          <tr key={row.label}>
            <Cell className="whitespace-nowrap">{row.label}</Cell>
            <Cell numeric className="whitespace-nowrap">
              {hoursText(row.targetMinutes)}
            </Cell>
            <Cell numeric className="whitespace-nowrap">
              {hoursText(row.workedMinutes)}
            </Cell>
            <Cell numeric className="whitespace-nowrap">
              {balanceCell(row.balanceMinutes)}
            </Cell>
            <Cell numeric className="font-semibold whitespace-nowrap">
              {balanceText(row.standingMinutes)}
            </Cell>
          </tr>
        ))}
        {rows.length === 0 && !carried ? (
          <tr>
            <Cell className="text-ink-muted">In diesem Jahr ist noch kein Tag gezählt.</Cell>
            <Cell numeric>{''}</Cell>
            <Cell numeric>{''}</Cell>
            <Cell numeric>{''}</Cell>
            <Cell numeric>{''}</Cell>
          </tr>
        ) : null}
      </tbody>
    </TablePanel>
  )
}
