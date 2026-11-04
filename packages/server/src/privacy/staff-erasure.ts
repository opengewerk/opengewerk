import { createHash } from 'node:crypto'

import {
  type IsoDate,
  personErasureDueOn,
  type PersonHold,
  shippedRules,
  sicknessErasureDueOn,
  staffYearErasureDueOn,
  type TenantId,
} from '@opengewerk/domain'
import {
  accountsOf,
  type Database,
  removeAccountData,
  removeAccountName,
  removedAddress,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'

import { access } from '../authentication/access.js'

/**
 * The staff under the deletion concept (#846, decided on 04.11.2026): which
 * sickness, which year of a person and which file of somebody who left is due,
 * and what goes with each. The protocol, the confirmation and the change log
 * are those of `erasure.ts`; the locks that let these rows go are migration
 * 0131.
 */

/** What the file of somebody keeps once nothing names them any more. */
export const erasedPersonName = 'Gelöschte Person'

/** What their account is called from then on, where it was this business's alone. */
export const erasedAccountName = 'Gelöschter Zugang'

/**
 * The key of one year of one person in the protocol: the first 32 hex digits
 * of the SHA-256 of "<person>/<year>" as a uuid, as `staff_year_key` in the
 * database computes it. It names neither.
 */
export function staffYearKey(personId: string, year: number): string {
  const hex = createHash('sha256')
    .update(`${personId.toLowerCase()}/${String(year)}`, 'utf8')
    .digest('hex')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function uuids(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`array[]::uuid[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::uuid[]`
}

/** A sickness that is due. */
export interface DueSickness {
  readonly absenceId: string
  readonly personId: string
  readonly personName: string
  readonly lastDay: IsoDate
  readonly dueOn: IsoDate
}

/** Every sickness due today, or of those asked for; a sickness removed in the office as well. */
export async function dueSicknesses(
  tx: TenantTransaction,
  today: IsoDate,
  only?: readonly string[],
): Promise<DueSickness[]> {
  const { rows } = await tx.execute<{
    id: string
    person_id: string
    name: string
    last_day: string
  }>(sql`
    select a.id, a.person_id, p.name, a.last_day::text
      from absences a join people p on p.id = a.person_id
     where a.kind = 'sickness'
       ${only === undefined ? sql`` : sql`and a.id = any(${uuids(only)})`}
     order by a.last_day, a.id`)

  return rows.flatMap((row) => {
    const dueOn = sicknessErasureDueOn(row.last_day as IsoDate, today, shippedRules)

    return dueOn > today
      ? []
      : [
          {
            absenceId: row.id,
            personId: row.person_id,
            personName: row.name,
            lastDay: row.last_day as IsoDate,
            dueOn,
          },
        ]
  })
}

/** One year of one person that is due. */
export interface DueStaffYear {
  readonly key: string
  readonly personId: string
  readonly personName: string
  readonly userId: string | null
  readonly year: number
  readonly dueOn: IsoDate
}

/** The last year whose time and leave may go today. */
function lastYearDue(today: IsoDate): number {
  let year = Number(today.slice(0, 4))

  while (staffYearErasureDueOn(year, today, shippedRules) > today) {
    year -= 1
  }

  return year
}

/**
 * The years of a person that hold anything: records of time (a correction
 * counts with the entry it corrects), times on call, absences by their first
 * day and days of leave. A person without an account has no time of their own.
 */
function yearsOf(upTo: number | null): SQL {
  const bound = (year: SQL) => (upTo === null ? sql`true` : sql`${year} <= ${upTo}`)
  const timeYear = sql`extract(year from (t.started_at at time zone 'Europe/Berlin'))::int`
  const callYear = sql`extract(year from (s.starts_at at time zone 'Europe/Berlin'))::int`
  const absenceYear = sql`extract(year from a.first_day)::int`

  return sql`(
    select ${timeYear} as year from time_entries t
     where p.user_id is not null and t.user_id = p.user_id and t.corrects_entry_id is null and ${bound(timeYear)}
    union select ${callYear} from on_call_shifts s
     where p.user_id is not null and s.user_id = p.user_id and ${bound(callYear)}
    union select ${absenceYear} from absences a where a.person_id = p.id and ${bound(absenceYear)}
    union select l.year from leave_entitlements l where l.person_id = p.id and ${bound(sql`l.year`)}
  )`
}

/** Every year of every person due today, or of those keys asked for. */
export async function dueStaffYears(
  tx: TenantTransaction,
  today: IsoDate,
  only?: readonly string[],
): Promise<DueStaffYear[]> {
  const { rows } = await tx.execute<{
    person_id: string
    name: string
    user_id: string | null
    year: number
  }>(sql`
    select p.id as person_id, p.name, p.user_id, y.year
      from people p cross join lateral ${yearsOf(lastYearDue(today))} as y
     order by y.year, p.name, p.id`)
  const wanted = only === undefined ? null : new Set(only.map((key) => key.toLowerCase()))

  return rows.flatMap((row) => {
    const year = Number(row.year)
    const key = staffYearKey(row.person_id, year)

    return wanted !== null && !wanted.has(key)
      ? []
      : [
          {
            key,
            personId: row.person_id,
            personName: row.name,
            userId: row.user_id,
            year,
            dueOn: staffYearErasureDueOn(year, today, shippedRules),
          },
        ]
  })
}

/** Whether anything of any year of a person is still kept. */
async function keepsAYear(tx: TenantTransaction, personId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ kept: boolean }>(sql`
    select exists (select 1 from people p cross join lateral ${yearsOf(null)} as y
                    where p.id = ${personId}) as kept`)

  return rows[0]?.kept === true
}

/** The file of somebody who left, due or held. */
export interface DuePerson {
  readonly personId: string
  readonly personName: string
  readonly userId: string | null
  readonly leftOn: IsoDate
  readonly dueOn: IsoDate
  readonly holds: readonly PersonHold[]
}

/**
 * The files of the people who left that are due today and not deleted yet,
 * or of those asked for, with what holds each. An access to this business
 * that has not ended holds the file: its account goes only after its last day.
 */
export async function duePeople(
  tx: TenantTransaction,
  today: IsoDate,
  only?: readonly string[],
): Promise<DuePerson[]> {
  const { rows } = await tx.execute<{
    id: string
    name: string
    user_id: string | null
    left_on: string
    open: boolean
  }>(sql`
    select p.id, p.name, p.user_id, p.left_on::text,
           (m.user_id is not null and (m.last_day is null or m.last_day >= ${today}::date)) as open
      from people p
      left join memberships m on m.user_id = p.user_id
     where p.left_on is not null
       and not exists (select 1 from erasures e where e.kind::text = 'person' and e.record_id = p.id)
       ${only === undefined ? sql`` : sql`and p.id = any(${uuids(only)})`}
     order by p.left_on, p.name, p.id`)

  return rows.flatMap((row) => {
    const dueOn = personErasureDueOn(row.left_on as IsoDate, today, shippedRules)

    return dueOn > today
      ? []
      : [
          {
            personId: row.id,
            personName: row.name,
            userId: row.user_id,
            leftOn: row.left_on as IsoDate,
            dueOn,
            holds: row.open ? (['access_open'] as const) : [],
          },
        ]
  })
}

/** The rows a deletion took or emptied, by table, for the change log. */
export interface StaffTouched {
  readonly table: string
  readonly ids: readonly string[]
}

async function taken(tx: TenantTransaction, table: string, query: SQL): Promise<StaffTouched> {
  const { rows } = await tx.execute<{ id: string }>(query)

  return { table, ids: rows.map((row) => row.id) }
}

/** Deletes one sickness; the line of the protocol is written already. */
export async function takeSickness(
  tx: TenantTransaction,
  absenceId: string,
): Promise<StaffTouched[]> {
  return [
    await taken(tx, 'absences', sql`delete from absences where id = ${absenceId} returning id`),
  ]
}

/**
 * Whether the file of a person is gone: a line of the protocol says it went,
 * and only the name may still stand in it.
 */
async function fileGone(tx: TenantTransaction, personId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ gone: boolean }>(sql`
    select exists (select 1 from erasures where kind::text = 'person' and record_id = ${personId}) as gone`)

  return rows[0]?.gone === true
}

/**
 * Takes the name of a person whose file went and of whom no year is kept any
 * more: the empty file keeps its key and the key of the account, and the
 * answers about recording the place go, which nothing needs once no record of
 * time is left. The name of the account follows outside the transaction
 * (`finishErasedAccounts`).
 */
async function takeName(
  tx: TenantTransaction,
  personId: string,
  userId: string | null,
): Promise<StaffTouched[]> {
  const touched = [
    await taken(
      tx,
      'people',
      sql`update people
             set name = ${erasedPersonName}, joined_on = null, left_on = null,
                 deleted_at = coalesce(deleted_at, now()), updated_at = now()
           where id = ${personId} returning id`,
    ),
  ]

  if (userId !== null) {
    touched.push(
      await taken(
        tx,
        'location_consents',
        sql`delete from location_consents where user_id = ${userId} returning id`,
      ),
    )
  }

  return touched
}

/**
 * Deletes one year of one person: the records of time from the end of each
 * chain of corrections, the times on call, the absences and the days of leave
 * of that year. Takes the name as well where the file went and this was the
 * last year kept. The line of the protocol is written already.
 */
export async function takeStaffYear(
  tx: TenantTransaction,
  year: DueStaffYear,
): Promise<StaffTouched[]> {
  const touched: StaffTouched[] = []

  if (year.userId !== null) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      select id from time_entries where user_id = ${year.userId} and time_entry_year(id) = ${year.year}`)
    let left = rows.map((row) => row.id)
    const gone: string[] = []

    // A correction names the entry it corrects, so the end of a chain goes first.
    while (left.length > 0) {
      const round = await taken(
        tx,
        'time_entries',
        sql`delete from time_entries t
             where t.id = any(${uuids(left)})
               and not exists (select 1 from time_entries c where c.corrects_entry_id = t.id)
            returning t.id`,
      )

      if (round.ids.length === 0) {
        throw new Error('A chain of corrections would not come apart')
      }

      gone.push(...round.ids)
      const done = new Set(round.ids)
      left = left.filter((id) => !done.has(id))
    }

    touched.push({ table: 'time_entries', ids: gone })
    touched.push(
      await taken(
        tx,
        'on_call_shifts',
        sql`delete from on_call_shifts
             where user_id = ${year.userId}
               and extract(year from (starts_at at time zone 'Europe/Berlin'))::int = ${year.year}
            returning id`,
      ),
    )
  }

  touched.push(
    await taken(
      tx,
      'absences',
      sql`delete from absences
           where person_id = ${year.personId} and extract(year from first_day)::int = ${year.year}
          returning id`,
    ),
    await taken(
      tx,
      'leave_entitlements',
      sql`delete from leave_entitlements where person_id = ${year.personId} and year = ${year.year}
          returning id`,
    ),
  )

  if ((await fileGone(tx, year.personId)) && !(await keepsAYear(tx, year.personId))) {
    touched.push(...(await takeName(tx, year.personId, year.userId)))
  }

  return touched
}

/**
 * Deletes the file of somebody who left: the working time agreed, the
 * qualifications with their certificates, the devices and calendar feeds of
 * the access here; the file stays empty with its name while a year of the
 * person is still kept, and loses the name too where none is. The data of the
 * account follow outside the transaction (`finishErasedAccounts`). The line
 * of the protocol is written already.
 */
export async function takePerson(
  tx: TenantTransaction,
  person: DuePerson,
): Promise<StaffTouched[]> {
  const touched = [
    await taken(
      tx,
      'working_times',
      sql`delete from working_times where person_id = ${person.personId} returning id`,
    ),
    await taken(
      tx,
      'qualifications',
      sql`delete from qualifications where person_id = ${person.personId} returning id`,
    ),
  ]

  if (person.userId !== null) {
    touched.push(
      await taken(
        tx,
        'push_subscriptions',
        sql`delete from push_subscriptions where user_id = ${person.userId} returning id`,
      ),
      await taken(
        tx,
        'push_opt_outs',
        sql`delete from push_opt_outs where user_id = ${person.userId} returning id`,
      ),
      await taken(
        tx,
        'calendar_feeds',
        sql`update calendar_feeds set ended_at = now(), updated_at = now()
             where user_id = ${person.userId} and ended_at is null returning id`,
      ),
    )
  }

  if (await keepsAYear(tx, person.personId)) {
    touched.push(
      await taken(
        tx,
        'people',
        sql`update people
               set joined_on = null, left_on = null, deleted_at = coalesce(deleted_at, now()),
                   updated_at = now()
             where id = ${person.personId} returning id`,
      ),
    )
  } else {
    touched.push(...(await takeName(tx, person.personId, person.userId)))
  }

  return touched
}

/** How long after it went the account of a file is looked after again, should a step have failed. */
const accountsAfterDays = 7

/**
 * What a deletion of the staff leaves for the account (#846), outside the
 * transaction that deleted, because the foundation opens transactions of its
 * own for the accounts of the instance: the data of the account of every file
 * that went (`removeAccountData`: sign-ins, passkeys, second factor, password
 * and address, where the account works nowhere else), and its name where the
 * file has lost the name too (`removeAccountName`). Asked again after each
 * pass for the files that changed in the last days, so a step cut off is done
 * on the next; what is done already is not done again. Returns how many
 * accounts it changed.
 */
export async function finishErasedAccounts(
  database: Database,
  tenantId: TenantId,
): Promise<number> {
  const actor = { tenantId, reason: 'privacy.erase' }
  const files = await database.forTenant(actor, async (tx) => {
    const { rows } = await tx.execute<{ user_id: string; nameless: boolean }>(sql`
      select p.user_id, bool_or(p.name = ${erasedPersonName}) as nameless
        from people p
       where p.user_id is not null
         and p.updated_at > now() - make_interval(days => ${accountsAfterDays})
         and exists (select 1 from erasures e where e.kind::text = 'person' and e.record_id = p.id)
       group by p.user_id`)

    return rows
  })

  if (files.length === 0) {
    return 0
  }

  const accounts = await accountsOf(
    database,
    files.map((file) => file.user_id),
    '',
  )
  let changed = 0

  for (const file of files) {
    const account = accounts.get(file.user_id)

    if (account === undefined) {
      continue
    }

    const dataLeft = account.email !== removedAddress(file.user_id)
    const nameLeft = file.nameless && account.name !== erasedAccountName

    if (dataLeft) {
      await removeAccountData(access, database, actor, file.user_id)
    }

    // The name goes only where the account was this business's alone; the
    // foundation answers that, and false leaves it as it is.
    if (nameLeft) {
      await removeAccountName(access, database, actor, file.user_id, erasedAccountName)
    }

    if (dataLeft || nameLeft) {
      changed += 1
    }
  }

  return changed
}
