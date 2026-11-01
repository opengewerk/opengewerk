import { type AccountDay, addDays, balanceOf, balanceText, hoursText } from '@opengewerk/domain'
import { date, today } from '@opengewerk/platform-web/format'

import type { TimeAccount } from '../session/time-account.js'

/**
 * What the screens of the time account (#289) make of the server's days, in
 * the office and on site alike: the target of each day, the balance of a week
 * up to yesterday, the months of a year with where the account stood at the
 * end of each, and the sentences around them.
 */

const months = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

/** The target of each day in minutes; a day without one has none. */
export function targetsOf(account: TimeAccount | undefined): ReadonlyMap<string, number> {
  return new Map((account?.days ?? []).map((day) => [day.on, day.targetMinutes]))
}

/**
 * The balance of a week under its table: target, recorded and balance of the
 * days counted, and that today counts from tomorrow while the week has it.
 */
export function weekBalanceText(account: TimeAccount | undefined): string | null {
  if (account === undefined || !account.hasFile || account.startsOn === null) {
    return null
  }

  const counted = account.days.filter((day) => day.counted)
  const now = today()
  const holdsToday = account.days.some((day) => day.on === now)
  const later = holdsToday ? ' Heute zählt erst ab morgen.' : ''

  if (counted.length === 0) {
    return later.trim() === '' ? null : later.trim()
  }

  const week = balanceOf(counted)
  const until = holdsToday ? 'Bis gestern ' : ''

  return `${until}Soll ${hoursText(week.targetMinutes)}, Ist ${hoursText(week.workedMinutes)}, Saldo ${balanceText(week.balanceMinutes)}${later}`
}

interface Month {
  readonly label: string
  readonly targetMinutes: number
  readonly workedMinutes: number
  readonly balanceMinutes: number
  readonly standingMinutes: number
}

/** The months of a year that have counted days, each with where the account stood at its end. */
export function monthsOf(account: TimeAccount): readonly Month[] {
  const rows: Month[] = []
  let standing = account.balanceBeforeMinutes

  months.forEach((name, index) => {
    const month = String(index + 1).padStart(2, '0')
    const days: AccountDay[] = account.days.filter(
      (day) => day.counted && day.on.slice(5, 7) === month,
    )
    const last = days.at(-1)

    if (last === undefined) {
      return
    }

    const sums = balanceOf(days)
    const monthEnds = addDays(last.on, 1).slice(5, 7) !== month

    standing += sums.balanceMinutes
    rows.push({
      label: monthEnds ? name : `${name}, bis ${date(last.on).slice(0, 6)}`,
      targetMinutes: sums.targetMinutes,
      workedMinutes: sums.workedMinutes,
      balanceMinutes: sums.balanceMinutes,
      standingMinutes: standing,
    })
  })

  return rows
}

/** Until when the account counts: "Stand bis gestern, 04.11.2026", or the day somebody left. */
export function countedText(account: TimeAccount): string {
  const until = account.countedUntil

  if (until === null) {
    return 'Noch kein Tag gezählt'
  }

  return until === addDays(today(), -1)
    ? `Stand bis gestern, ${date(until)}`
    : `Stand am ${date(until)}`
}

/** Where the whole account stands, and until when it counts. */
export function standingText(account: TimeAccount): string {
  return `${countedText(account)}: ${balanceText(account.balanceMinutes)}`
}

/** What every account says about itself: what counts and what lessens the target. */
export function countingText(account: TimeAccount): string {
  const holidays =
    account.state === null
      ? ' Ohne Bundesland zählt kein Feiertag; es steht unter „Einstellungen“, „Feiertage“.'
      : ''

  return `Es zählen Arbeit und Fahrt, Pausen nicht. Feiertage, Urlaub und Krankheit mindern das Soll.${holidays}`
}
