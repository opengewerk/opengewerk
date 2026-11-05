import { createHash } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { addDays, berlinClock, type IsoDate, type TenantId } from '@opengewerk/domain'
import { Database, newId, removedAddress } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { staffYearKey } from '../privacy/staff-erasure.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The staff under the deletion concept (#846, decided on 04.11.2026): a
 * sickness a year after its last day, the time and leave of a year six years
 * after its end, the file of somebody who left three years after the end of
 * that year, its name with the last year kept. What stays of the person is an
 * empty file and the key of the account the rest of the business points at.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

function person(userId: string, roles: string[], tenantId: TenantId = north) {
  return JSON.stringify({ userId, tenantId, roles })
}

const owner = person('lena', ['owner'])
const office = person('bruno', ['office'])
const technician = person('kurt', ['technician'])

const today = berlinClock(new Date()).day
const thisYear = Number(today.slice(0, 4))
/** A year whose time and leave are due: six years after its end have passed. */
const oldYear = thisYear - 7
/** The year after it, which is not due yet. */
const nextYear = oldYear + 1
/** The day the person left, three years and more before the start of this year. */
const leftOn = `${String(thisYear - 4)}-06-30`

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

/** The message of whatever a statement of the application threw, the database's included. */
async function refusedWith(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause

    return String(cause?.message ?? (error as Error).message)
  }

  return 'went through'
}

/** A statement of the application role, in the business of the north as whoever leads it. */
function asApplication(statement: string) {
  return database.forTenant({ tenantId: north, userId: 'lena' }, (tx) =>
    tx.execute(sql.raw(statement)),
  )
}

interface Fixture {
  readonly family: string
  readonly person: string
  readonly certificate: string
  readonly dueSickness: string
  readonly freshSickness: string
  readonly oldSickness: string
  readonly vacation: string
  /** The last entry of the old year, and its correction made after New Year. */
  readonly lastEntry: string
  readonly correction: string
}

/**
 * Dennis Kraft, who left three years and more ago, with something in every
 * table a deletion of the staff reaches and the name of his family in each:
 * records of time, times on call, absences and days of leave of the old year
 * and the year after, a sickness that is due and one that is not, the
 * working time agreed, a qualification with its certificate, an answer
 * about recording the place, and the account he signed in with.
 */
async function kraft(withLaterYears = true): Promise<Fixture> {
  const family = `Kraft${newId<'person'>().slice(-6)}`
  const id = newId<'person'>()
  const certificate = createHash('sha256').update(family).digest('hex')
  const dueSickness = newId<'absence'>()
  const freshSickness = newId<'absence'>()
  const oldSickness = newId<'absence'>()
  const vacation = newId<'absence'>()
  const lastEntry = newId<'time-entry'>()
  const correction = newId<'time-entry'>()
  const dueLast = addDays(today, -400)
  const freshLast = addDays(today, -100)
  const o = String(oldYear)
  const n = String(nextYear)

  await admin.query(
    `update auth_users set name = 'Dennis ${family}', email = 'dennis@${family.toLowerCase()}.example' where id = 'kurt';
     update memberships set last_day = '${leftOn}' where tenant_id = '${north}' and user_id = 'kurt';
     begin;
     set local app.user_id = 'kurt';
     insert into people (id, tenant_id, name, user_id, joined_on, left_on)
       values ('${id}', '${north}', 'Dennis ${family}', 'kurt', '${String(oldYear - 3)}-03-01', '${leftOn}');
     insert into working_times (tenant_id, person_id, valid_from, monday_minutes, tuesday_minutes)
       values ('${north}', '${id}', '${String(oldYear - 3)}-03-01', 480, 480);
     insert into files (tenant_id, sha256, size_bytes, media_type)
       values ('${north}', '${certificate}', 12, 'application/pdf');
     insert into qualifications (tenant_id, person_id, kind_key, valid_until, note, certificate_sha256)
       values ('${north}', '${id}', 'electrician', '2030-01-01', 'Prüfung bei ${family}', '${certificate}');
     insert into absences (id, tenant_id, person_id, kind, state, first_day, last_day, note)
       values ('${vacation}', '${north}', '${id}', 'vacation', 'approved', '${o}-08-01', '${o}-08-14', 'Urlaub der ${family}s'),
              ('${oldSickness}', '${north}', '${id}', 'sickness', 'approved', '${o}-05-06', '${o}-05-10', null);
     insert into leave_entitlements (tenant_id, person_id, year, entitled_half_days, carried_half_days)
       values ('${north}', '${id}', ${o}, 60, 4);
     insert into time_entries (tenant_id, user_id, kind, started_at, ended_at, note, start_latitude_micro, start_longitude_micro)
       values ('${north}', 'kurt', 'work', '${o}-03-04 07:00+01', '${o}-03-04 15:30+01', 'Baustelle ${family}', 53550000, 9990000);
     insert into time_entries (id, tenant_id, user_id, kind, started_at, ended_at, note)
       values ('${lastEntry}', '${north}', 'kurt', 'work', '${o}-12-31 22:00+01', '${o}-12-31 23:30+01', 'Silvester bei ${family}');
     insert into time_entries (id, tenant_id, user_id, kind, started_at, ended_at, note, corrects_entry_id)
       values ('${correction}', '${north}', 'kurt', 'work', '${n}-01-01 00:10+01', '${n}-01-01 01:00+01', 'Silvester bei ${family}, berichtigt', '${lastEntry}');
     insert into on_call_shifts (tenant_id, user_id, starts_at, ends_at, note)
       values ('${north}', 'kurt', '${o}-05-01 16:00+02', '${o}-05-08 07:00+02', 'Bereitschaft ${family}');
     insert into location_consents (tenant_id, user_id, given) values ('${north}', 'kurt', true);
     ${
       withLaterYears
         ? `insert into absences (id, tenant_id, person_id, kind, state, first_day, last_day, note)
              values (gen_random_uuid(), '${north}', '${id}', 'vacation', 'approved', '${n}-07-01', '${n}-07-10', 'Urlaub der ${family}s'),
                     ('${dueSickness}', '${north}', '${id}', 'sickness', 'approved', '${addDays(dueLast, -4)}', '${dueLast}', null),
                     ('${freshSickness}', '${north}', '${id}', 'sickness', 'approved', '${addDays(freshLast, -4)}', '${freshLast}', null);
            insert into leave_entitlements (tenant_id, person_id, year, entitled_half_days, carried_half_days)
              values ('${north}', '${id}', ${n}, 60, 0);
            insert into time_entries (tenant_id, user_id, kind, started_at, ended_at, note)
              values ('${north}', 'kurt', 'work', '${n}-02-02 07:00+01', '${n}-02-02 15:00+01', 'Baustelle ${family}');
            insert into on_call_shifts (tenant_id, user_id, starts_at, ends_at, note)
              values ('${north}', 'kurt', '${n}-05-01 16:00+02', '${n}-05-08 07:00+02', 'Bereitschaft ${family}');`
         : ''
     }
     commit;`,
  )

  return {
    family,
    person: id,
    certificate,
    dueSickness,
    freshSickness,
    oldSickness,
    vacation,
    lastEntry,
    correction,
  }
}

/** Where the family name still stands, as table and column, in every text of the database. */
async function tracesOf(family: string): Promise<string[]> {
  const { rows } = await admin.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type in ('text', 'jsonb', 'character varying')
        and table_name in (select tablename from pg_tables where schemaname = 'public')`,
  )
  const found: string[] = []

  for (const row of rows) {
    const hit = await admin.query(
      `select 1 from "${row.table_name}" where "${row.column_name}"::text ~* $1 limit 1`,
      [family],
    )

    if (hit.rowCount === 1) {
      found.push(`${row.table_name}.${row.column_name}`)
    }
  }

  return found.sort()
}

async function count(statement: string, values: unknown[] = []): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(statement, values)

  return Number(rows[0]?.n)
}

function erase(kind: string, ids: string[], who = owner) {
  return http().post('/privacy/erasures').set('x-test-identity', who).send({ kind, ids })
}

interface Due {
  kind: string
  recordId: string
  name: string
  detail: string
  dueOn: string
}

async function dueFor(who: string): Promise<Due[] | null> {
  const answer = await http().get('/privacy').set('x-test-identity', who).expect(200)

  return (answer.body as { due: Due[] | null }).due
}

async function pass() {
  await runDeadlinesOf({ database }, north, new Date())
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])
  await admin.query(
    `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor) values
       ($1, 'owner', 'Inhaber', '{}', true, false), ($1, 'office', 'Büro', '{}', false, false),
       ($1, 'technician', 'Monteur', '{}', false, false), ($2, 'owner', 'Inhaber', '{}', true, false)`,
    [north, south],
  )
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('lena', 'Lena Leitung', 'lena@example.de'), ('bruno', 'Bruno Büro', 'bruno@example.de'),
       ('kurt', 'Dennis Kraft', 'dennis@example.de'), ('sven', 'Sven Süd', 'sven@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'lena', '{owner}'), ($1, 'bruno', '{office}'), ($1, 'kurt', '{technician}'),
       ($2, 'sven', '{owner}')`,
    [north, south],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from audit_redactions; delete from erasures; delete from erasure_automations;
     delete from deadlines; delete from tasks; delete from time_entries; delete from on_call_shifts;
     delete from absences; delete from leave_entitlements; delete from location_consents;
     delete from qualifications; delete from working_times; delete from people; delete from files;
     commit;`,
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('what of the staff is due (#846)', () => {
  it('is a sickness a year after its last day, a year six years after its end and a file three years after leaving', async () => {
    const dennis = await kraft()

    await pass()

    const due = (await dueFor(owner)) ?? []

    expect(due.map((entry) => [entry.kind, entry.detail]).sort()).toEqual(
      [
        ['person', `Akte, Austritt 30.06.${String(thisYear - 4)}`],
        ['sickness', `Krankheit, letzter Tag ${germanDay(addDays(today, -400))}`],
        ['sickness', `Krankheit, letzter Tag 10.05.${String(oldYear)}`],
        ['staff_year', `Arbeitszeiten und Urlaub ${String(oldYear)}`],
      ].sort(),
    )
    expect(due.every((entry) => entry.name === `Dennis ${dennis.family}`)).toBe(true)
    expect(due.find((entry) => entry.kind === 'staff_year')?.recordId).toBe(
      staffYearKey(dennis.person, oldYear),
    )

    // The deadlines name nobody, and the key of a year is the database's as well.
    const { rows } = await admin.query<{ source_label: string; source_id: string }>(
      `select source_label, source_id::text from deadlines where kind like 'privacy.%'`,
    )

    expect(rows.every((row) => !row.source_label.includes(dennis.family))).toBe(true)
    expect(
      await count(`select count(*) as n from deadlines where source_id = staff_year_key($1, $2)`, [
        dennis.person,
        oldYear,
      ]),
    ).toBe(1)
  })

  it('shows a sickness to whoever keeps absences and a file only to whoever reads the files, in the list of deadlines as well', async () => {
    await kraft()
    await pass()

    expect(((await dueFor(office)) ?? []).map((entry) => entry.kind).sort()).toEqual([
      'sickness',
      'sickness',
    ])

    const kinds = async (who: string) => {
      const answer = await http()
        .get('/deadlines?status=all')
        .set('x-test-identity', who)
        .expect(200)

      return [...new Set((answer.body as { rows: { kind: string }[] }).rows.map((row) => row.kind))]
        .filter((kind) => kind.startsWith('privacy.'))
        .sort()
    }

    expect(await kinds(owner)).toEqual([
      'privacy.person_erasure',
      'privacy.sickness_erasure',
      'privacy.staff_year_erasure',
    ])
    expect(await kinds(office)).toEqual(['privacy.sickness_erasure'])
  })

  it('keeps a file while its access has not ended, and says why', async () => {
    const dennis = await kraft()

    await admin.query(
      `update memberships set last_day = null where tenant_id = $1 and user_id = 'kurt'`,
      [north],
    )
    await pass()

    expect(((await dueFor(owner)) ?? []).some((entry) => entry.kind === 'person')).toBe(false)

    const refused = await erase('person', [dennis.person]).expect(409)

    expect(refusal(refused)).toBe(
      'Eine ausgewählte Akte bleibt noch: Ihr Zugang hat keinen letzten Tag, der vorbei ist.',
    )
    expect(
      await count(`select count(*) as n from working_times where person_id = $1`, [dennis.person]),
    ).toBe(1)
  })

  it('refuses what is not due, and deletes none of those asked for', async () => {
    const dennis = await kraft()

    await pass()

    const refused = await erase('sickness', [dennis.dueSickness, dennis.freshSickness]).expect(409)

    expect(refusal(refused)).toContain('nicht zum Löschen fällig')
    expect(await count(`select count(*) as n from absences where kind = 'sickness'`)).toBe(3)
    await erase('staff_year', [staffYearKey(dennis.person, nextYear)]).expect(409)
    expect(await count(`select count(*) as n from erasures`)).toBe(0)
  })
})

describe('a sickness that is due', () => {
  it('goes, every value of it blacked out, and the line of the protocol names the day and nobody', async () => {
    const dennis = await kraft()

    await pass()
    await erase('sickness', [dennis.dueSickness]).expect(201)

    expect(
      await count(`select count(*) as n from absences where id = $1`, [dennis.dueSickness]),
    ).toBe(0)
    expect(
      await count(
        `select count(*) as n from audit_entries
          where table_name = 'absences' and record_id = $1 and (old_value is not null or new_value is not null)`,
        [dennis.dueSickness],
      ),
    ).toBe(0)

    const { rows } = await admin.query<{ label: string; redactions: number; created_by: string }>(
      `select label, redactions, created_by from erasures where kind::text = 'sickness'`,
    )

    expect(rows).toEqual([
      {
        label: `Krankheit, letzter Tag ${germanDay(addDays(today, -400))}`,
        redactions: expect.any(Number),
        created_by: 'lena',
      },
    ])
    expect(rows[0]?.redactions).toBeGreaterThan(0)
  })

  it('is for whoever leads the business', async () => {
    const dennis = await kraft()

    await pass()
    await erase('sickness', [dennis.dueSickness], office).expect(403)
    expect(
      await count(`select count(*) as n from absences where id = $1`, [dennis.dueSickness]),
    ).toBe(1)
  })
})

describe('the locks of the database (0131)', () => {
  it('let nothing of the staff go without a line of the protocol in the same transaction', async () => {
    const dennis = await kraft()
    const refusals = [
      [`delete from absences where id = '${dennis.dueSickness}'`, 'Eine Abwesenheit wird nur'],
      [`delete from absences where id = '${dennis.vacation}'`, 'Eine Abwesenheit wird nur'],
      [
        `delete from leave_entitlements where person_id = '${dennis.person}'`,
        'Der Urlaubsanspruch',
      ],
      [
        `delete from working_times where person_id = '${dennis.person}'`,
        'Eine vereinbarte Arbeitszeit',
      ],
      [`delete from qualifications where person_id = '${dennis.person}'`, 'Eine Qualifikation'],
      [`delete from location_consents where user_id = 'kurt'`, 'Eine Antwort zur Erfassung'],
      [`delete from on_call_shifts where user_id = 'kurt'`, 'Eine Zeit der Rufbereitschaft'],
      [`delete from time_entries where id = '${dennis.correction}'`, 'Ein Zeiteintrag wird'],
    ] as const

    for (const [statement, sentence] of refusals) {
      expect(await refusedWith(asApplication(statement))).toContain(sentence)
    }
  })

  it('let a year go only with its own line, and not the year after with it', async () => {
    const dennis = await kraft()
    const line = (key: string) =>
      `insert into erasures (tenant_id, kind, record_id, label, automatic, redactions, created_by)
         values ('${north}', 'staff_year', '${key}', 'Probe', false, 0, 'lena');`

    // The line of the old year opens the old year, and nothing of the next.
    expect(
      await refusedWith(
        asApplication(
          `${line(staffYearKey(dennis.person, oldYear))}
           delete from leave_entitlements where person_id = '${dennis.person}' and year = ${String(nextYear)};`,
        ),
      ),
    ).toContain('Der Urlaubsanspruch')
    expect(
      await refusedWith(
        asApplication(
          `${line(staffYearKey(dennis.person, oldYear))}
           delete from leave_entitlements where person_id = '${dennis.person}' and year = ${String(oldYear)};`,
        ),
      ),
    ).toBe('went through')
  })
})

describe('a year of a person that is due', () => {
  it('takes the time, the times on call, the absences and the days of leave of that year, a correction after New Year with its entry, and leaves the year after', async () => {
    const dennis = await kraft()

    await pass()
    await erase('staff_year', [staffYearKey(dennis.person, oldYear)]).expect(201)

    const years = async (table: string, column: string, where: string) => {
      const { rows } = await admin.query<{ year: number }>(
        `select distinct extract(year from (${column}))::int as year from ${table} where ${where} order by 1`,
      )

      return rows.map((row) => Number(row.year))
    }

    expect(
      await years('time_entries', "started_at at time zone 'Europe/Berlin'", `user_id = 'kurt'`),
    ).toEqual([nextYear])
    expect(
      await count(`select count(*) as n from time_entries where id in ($1, $2)`, [
        dennis.lastEntry,
        dennis.correction,
      ]),
    ).toBe(0)
    expect(
      await years('on_call_shifts', "starts_at at time zone 'Europe/Berlin'", `user_id = 'kurt'`),
    ).toEqual([nextYear])
    expect(
      await years('absences', 'first_day', `person_id = '${dennis.person}' and kind = 'vacation'`),
    ).toEqual([nextYear])
    expect(
      await years('leave_entitlements', 'make_date(year, 1, 1)', `person_id = '${dennis.person}'`),
    ).toEqual([nextYear])

    // The file, the name and the answer about the place stay: the file is not due with it.
    expect(
      await count(`select count(*) as n from people where id = $1 and name = $2`, [
        dennis.person,
        `Dennis ${dennis.family}`,
      ]),
    ).toBe(1)
    expect(await count(`select count(*) as n from location_consents where user_id = 'kurt'`)).toBe(
      1,
    )

    const { rows } = await admin.query<{ label: string; record_id: string }>(
      `select label, record_id::text from erasures where kind::text = 'staff_year'`,
    )

    expect(rows).toEqual([
      {
        label: `Arbeitszeiten und Urlaub ${String(oldYear)}`,
        record_id: staffYearKey(dennis.person, oldYear),
      },
    ])
  })

  it('makes every device drop the records of time and the times on call it holds', async () => {
    const dennis = await kraft()
    const narrowed = async () => {
      const answer = await http()
        .get('/sync?since=0')
        .set('x-test-identity', technician)
        .expect(200)

      return (answer.body as { narrowed: Record<string, string> }).narrowed
    }

    const before = await narrowed()

    expect(before['time_entries']).toBe('user:kurt')
    await pass()
    await erase('staff_year', [staffYearKey(dennis.person, oldYear)]).expect(201)

    const after = await narrowed()

    expect(after['time_entries']).toBe('user:kurt:erased:1')
    expect(after['on_call_shifts']).not.toBe(before['on_call_shifts'])
  })
})

describe('the file of somebody who left', () => {
  it('takes the working time, the qualifications with the certificate and the data of the account, and keeps the name while a year is kept', async () => {
    const dennis = await kraft()

    await pass()
    await erase('person', [dennis.person]).expect(201)

    expect(
      await count(`select count(*) as n from working_times where person_id = $1`, [dennis.person]),
    ).toBe(0)
    expect(
      await count(`select count(*) as n from qualifications where person_id = $1`, [dennis.person]),
    ).toBe(0)
    expect(
      await count(`select count(*) as n from files where sha256 = $1`, [dennis.certificate]),
    ).toBe(0)

    const { rows: files } = await admin.query<{
      name: string
      joined_on: string | null
      deleted: boolean
    }>(`select name, joined_on, deleted_at is not null as deleted from people where id = $1`, [
      dennis.person,
    ])

    expect(files).toEqual([{ name: `Dennis ${dennis.family}`, joined_on: null, deleted: true }])

    const { rows: accounts } = await admin.query<{ name: string; email: string }>(
      `select name, email from auth_users where id = 'kurt'`,
    )

    expect(accounts).toEqual([{ name: `Dennis ${dennis.family}`, email: removedAddress('kurt') }])
  })

  it('loses the name with the last year, and with it the answer about the place and the name of the account; nothing of the person is left', async () => {
    // Only the old year is kept: nothing came after, no sickness either.
    const dennis = await kraft(false)

    await pass()
    await erase('person', [dennis.person]).expect(201)
    await pass()
    await erase('staff_year', [staffYearKey(dennis.person, oldYear)]).expect(201)

    const { rows } = await admin.query<{ name: string; user_id: string }>(
      `select name, user_id from people where id = $1`,
      [dennis.person],
    )

    expect(rows).toEqual([{ name: 'Gelöschte Person', user_id: 'kurt' }])
    expect(await count(`select count(*) as n from location_consents where user_id = 'kurt'`)).toBe(
      0,
    )
    expect(
      (await admin.query<{ name: string }>(`select name from auth_users where id = 'kurt'`)).rows,
    ).toEqual([{ name: 'Gelöschter Zugang' }])
    expect(await tracesOf(dennis.family)).toEqual([])
  })

  it('goes by itself where the business switched it on, in the name of who did', async () => {
    const dennis = await kraft()

    await admin.query(
      `begin; set local app.user_id = 'lena';
       insert into erasure_automations (tenant_id, kind, created_by) values ('${north}', 'sickness', 'lena');
       commit;`,
    )
    // What a deadline does waits for the morning of its day: the pass runs at noon.
    await runDeadlinesOf({ database }, north, new Date(`${berlinClock(new Date()).day}T10:00:00Z`))

    expect(
      await count(`select count(*) as n from absences where id = $1`, [dennis.dueSickness]),
    ).toBe(0)
    expect(
      await count(`select count(*) as n from absences where id = $1`, [dennis.freshSickness]),
    ).toBe(1)
    expect(
      (
        await admin.query<{ automatic: boolean; created_by: string }>(
          `select automatic, created_by from erasures where kind::text = 'sickness' order by created_at`,
        )
      ).rows,
    ).toEqual([
      { automatic: true, created_by: 'lena' },
      { automatic: true, created_by: 'lena' },
    ])
  })
})

function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}
