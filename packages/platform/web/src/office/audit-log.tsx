import {
  type AuditChainReport,
  type AuditChange,
  type AuditPage,
  auditRights,
} from '@opengewerk/platform-domain'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, History, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, useId, useMemo, useState } from 'react'

import { useAuditSentences } from '../application.js'
import { useBand } from '../components/band.js'
import { Button, useButtonLook } from '../components/button.js'
import { Panel, TablePanel } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { clockTime, moment } from '../format.js'
import { auditChain, auditChanges, type AuditFilterView, auditPeople } from '../session/audit.js'
import { useRight } from '../session/queries.js'
import { RequestRefused } from '../sync/transport.js'
import { type AuditNames, useAuditWords } from './audit-words.js'
import { Empty, NoteBox } from './kit.js'
import { SettingsPage, SettingsText } from './settings.js'

/**
 * Where the change log of a tenant is opened: under the settings, at an
 * address of its own, which the button at a record and the links of the
 * screen itself lead to. An application lists it among its settings under
 * the key `protokoll`.
 */
export const auditLogPath = '/einstellungen/protokoll'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const deviceDay = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

/**
 * "am 27.09.2026 um 14:40", day and time in the time zone of the device, as
 * `moment()` writes them in the list: taking the day from Berlin and the time
 * from the device would put a change at 23:30 on the wrong day abroad.
 */
export function when(iso: string): string {
  const at = new Date(iso)

  return `am ${deviceDay.format(at)} um ${clockTime(at)}`
}

/** The pages read so far as one: the changes in order and every name any page brought. */
function merged(pages: readonly AuditPage[]): AuditPage {
  return {
    changes: pages.flatMap((page) => page.changes),
    next: pages.at(-1)?.next ?? null,
    titles: Object.assign({}, ...pages.map((page) => page.titles)) as AuditPage['titles'],
    people: Object.assign({}, ...pages.map((page) => page.people)) as AuditPage['people'],
    devices: Object.assign({}, ...pages.map((page) => page.devices)) as AuditPage['devices'],
  }
}

/** Whether the chain stops fitting inside this change. */
function breaksHere(change: AuditChange, report: AuditChainReport | undefined): boolean {
  const at = report?.brokenAt

  return typeof at === 'number' && change.firstSequence <= at && at <= change.lastSequence
}

/**
 * The change log of a tenant for whoever may read it (ADR 0010; `protokoll()`
 * of the canvas of the trades application): the check of the chain, the
 * filters, one change opened with its fields before and after, and the list,
 * newest first, fifty at a time. What its records, fields and values are
 * called the application says in its value (`audit`), what the log holds and
 * who reads it in its sentences (`sentences.audit`).
 *
 * Opened from a record, with `?art=` and `?datensatz=`, it shows that record
 * and its parts only, the chip above the filters says which and leads back.
 */
export function AuditLogScreen() {
  const words = useAuditWords()

  const reads = useRight(auditRights.read)
  const sentences = useAuditSentences()
  const band = useBand()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as {
    readonly art?: string
    readonly datensatz?: string
  }
  const narrowed =
    typeof search.art === 'string' &&
    typeof search.datensatz === 'string' &&
    words.language.records.includes(search.art)
      ? { table: search.art, record: search.datensatz }
      : null
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [person, setPerson] = useState('')
  const [table, setTable] = useState('')
  const [opened, setOpened] = useState<string | null>(null)

  const filter: AuditFilterView = narrowed
    ? { since, until, person, table: narrowed.table, record: narrowed.record }
    : { since, until, person, table, record: '' }

  const changes = useInfiniteQuery({
    queryKey: ['audit', 'changes', filter],
    queryFn: ({ pageParam }) => auditChanges(filter, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next,
    enabled: reads,
  })
  const people = useQuery({
    queryKey: ['audit', 'people'],
    queryFn: auditPeople,
    enabled: reads,
    staleTime: 5 * 60_000,
  })
  // The walk over the chain reads every entry, so it runs when asked and not on every visit.
  const chain = useQuery({
    queryKey: ['audit', 'chain'],
    queryFn: auditChain,
    enabled: false,
    retry: false,
  })

  const page = useMemo(() => merged(changes.data?.pages ?? []), [changes.data])
  const open = page.changes.find((change) => change.changeId === opened) ?? null
  const kinds = useMemo(
    () =>
      Object.keys(words.language.tables)
        .map((key) => ({ value: key, label: words.language.tableLabel(key) }))
        .sort((one, other) => one.label.localeCompare(other.label, 'de')),
    [words],
  )

  const leaveRecord = () => {
    setOpened(null)
    void navigate({ to: auditLogPath })
  }

  return (
    <SettingsPage active="protokoll" title="Änderungsprotokoll" sub={sentences.what}>
      {!reads ? (
        <Panel>
          <SettingsText muted>{sentences.onlyFor}</SettingsText>
        </Panel>
      ) : (
        <>
          <ChainPanel
            report={chain.data}
            checking={chain.isFetching}
            failed={chain.isError ? saidWhy(chain.error, 'Die Prüfung kam nicht zurück.') : null}
            onCheck={() => {
              void chain.refetch()
            }}
          />

          <div className="flex flex-col gap-[9px]">
            {narrowed ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex h-8 items-center gap-1.5 rounded-control bg-ink pr-1 pl-[11px] text-[13px] font-semibold text-ground max-lg:h-10">
                  <History size={14} strokeWidth={2.3} aria-hidden="true" />
                  {`${words.recordKind(narrowed.table, narrowed.record, page)} ${
                    page.titles[narrowed.record]
                      ? words.recordTitle(narrowed.table, narrowed.record, page)
                      : ''
                  }`.trim()}
                  <button
                    type="button"
                    aria-label="Alle Datensätze zeigen"
                    onClick={leaveRecord}
                    className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-[3px] text-inherit hover:opacity-75"
                  >
                    <X size={14} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                </span>
                <span className="text-[13px] text-ink-faint">
                  {words.screen.partsWords?.[narrowed.table]}
                </span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-[9px] max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5">
              {/* Two columns on a phone, and part of the row from 600 pixels on. */}
              <div className="grid grid-cols-2 gap-2.5 sm:contents">
                <DayFilter label="Von" value={since} onChange={setSince} />
                <DayFilter label="Bis" value={until} onChange={setUntil} />
              </div>
              <div className="grow max-lg:hidden" />
              <FilterSelect
                label="Person"
                value={person}
                onChange={(value) => {
                  setPerson(value)
                  setOpened(null)
                }}
                options={[
                  { value: '', label: 'Alle Personen' },
                  ...(Array.isArray(people.data) ? people.data : []).map((entry) => ({
                    value: entry.userId,
                    label: entry.name,
                  })),
                ]}
              />
              {narrowed ? null : (
                <FilterSelect
                  label="Art"
                  value={table}
                  onChange={(value) => {
                    setTable(value)
                    setOpened(null)
                  }}
                  options={[{ value: '', label: 'Alle Arten' }, ...kinds]}
                />
              )}
            </div>
          </div>

          {changes.isPending ? (
            <SettingsText muted>Wird geladen.</SettingsText>
          ) : changes.isError ? (
            <SettingsText muted>
              {saidWhy(changes.error, 'Das Änderungsprotokoll kam nicht an.')}
            </SettingsText>
          ) : page.changes.length === 0 ? (
            <Panel>
              <Empty>
                {since || until || person || table || narrowed
                  ? 'Keine Änderung passt zu diesen Filtern.'
                  : 'Hier steht noch keine Änderung.'}
              </Empty>
            </Panel>
          ) : band === 'S' ? (
            <PhoneList
              page={page}
              report={chain.data}
              opened={opened}
              onOpen={setOpened}
              narrowedTo={narrowed?.record ?? null}
            />
          ) : (
            <>
              {open ? (
                <ChangePanel
                  key={open.changeId}
                  change={open}
                  page={page}
                  narrowedTo={narrowed?.record ?? null}
                  onClose={() => {
                    setOpened(null)
                  }}
                />
              ) : null}
              <ChangeTable
                page={page}
                report={chain.data}
                opened={opened}
                onOpen={setOpened}
                footer={
                  <>
                    <span>Neueste zuerst, 50 je Abruf</span>
                    <div className="grow" />
                    {changes.hasNextPage ? (
                      <Button
                        size="small"
                        icon={ChevronDown}
                        disabled={changes.isFetchingNextPage}
                        onClick={() => {
                          void changes.fetchNextPage()
                        }}
                      >
                        {changes.isFetchingNextPage ? 'Wird geladen' : 'Ältere Änderungen laden'}
                      </Button>
                    ) : (
                      <span>Das sind alle.</span>
                    )}
                  </>
                }
              />
            </>
          )}

          {band === 'S' && page.changes.length > 0 && changes.hasNextPage ? (
            <Button
              wide
              icon={ChevronDown}
              disabled={changes.isFetchingNextPage}
              onClick={() => {
                void changes.fetchNextPage()
              }}
            >
              {changes.isFetchingNextPage ? 'Wird geladen' : 'Ältere Änderungen laden'}
            </Button>
          ) : null}
        </>
      )}
    </SettingsPage>
  )
}

/** "Prüfung": what the chain is, the button, and what the last check found. */
function ChainPanel({
  report,
  checking,
  failed,
  onCheck,
}: {
  readonly report: AuditChainReport | undefined
  readonly checking: boolean
  readonly failed: string | null
  readonly onCheck: () => void
}) {
  return (
    <Panel title="Prüfung">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-4 max-sm:flex-col max-sm:items-stretch">
          <p className="min-w-0 grow text-[13px] leading-[1.5] text-ink-muted max-sm:text-[14px]">
            Jeder Eintrag trägt den Fingerabdruck des vorigen. Wurde einer nachträglich verändert
            oder entfernt, passt die Kette ab dort nicht mehr.
          </p>
          <Button icon={ShieldCheck} disabled={checking} onClick={onCheck} className="shrink-0">
            {checking ? 'Wird geprüft' : 'Protokoll prüfen'}
          </Button>
        </div>
        {failed ? (
          <SettingsText muted>{failed}</SettingsText>
        ) : report ? (
          <ChainResult report={report} />
        ) : null}
      </div>
    </Panel>
  )
}

function ChainResult({ report }: { readonly report: AuditChainReport }) {
  const checked = report.checked.toLocaleString('de-DE')

  if (report.brokenAt === null) {
    return (
      <p role="status" className="flex items-start gap-2 text-[14px] text-done max-sm:text-[15px]">
        <ShieldCheck size={18} strokeWidth={2.1} aria-hidden="true" className="mt-px shrink-0" />
        <span>
          <strong>Vollständig und unverändert.</strong>{' '}
          <span className="text-ink-muted">{`${checked} Einträge geprüft ${when(report.checkedAt)}.`}</span>
        </span>
      </p>
    )
  }

  const before = Math.max(report.brokenAt - 1, 0).toLocaleString('de-DE')
  const where = report.brokenAtTime
    ? `Ab dem Eintrag vom ${moment(report.brokenAtTime)} passt die Kette nicht mehr.`
    : 'Am Ende der Kette fehlt etwas.'
  const since = report.brokenAtTime ? ' von vor diesem Tag' : ''

  return (
    <div role="status">
      <NoteBox tone="conflict" icon={TriangleAlert}>
        <strong>{where}</strong> {report.problem ?? ''} Das geht nur an der Anwendung vorbei, direkt
        in der Datenbank.{' '}
        {`Die ${before} Einträge davor sind unverändert; eine Sicherung${since} hält den Stand davor fest.`}
      </NoteBox>
    </div>
  )
}

/** A day in the row of filters, as low as the selects beside it. */
function DayFilter({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const id = useId()

  return (
    <div className="flex items-center gap-[7px] max-lg:grow max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <label
        htmlFor={id}
        className="text-[13px] text-ink-muted max-lg:text-[14px] max-sm:font-medium max-sm:text-ink"
      >
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="numeric h-8 w-[140px] rounded-control border border-line-strong bg-surface px-2.5 text-[14px] text-ink max-lg:h-10 max-lg:w-auto max-lg:grow max-sm:h-12 max-sm:w-full max-sm:bg-input max-sm:px-3 max-sm:text-[16px]"
      />
    </div>
  )
}

/** A choice in the row of filters, `select_filter()` of the canvas. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly onChange: (value: string) => void
}) {
  const id = useId()

  return (
    <div className="relative w-[170px] max-lg:w-full max-sm:flex max-sm:flex-col max-sm:gap-1">
      <label htmlFor={id} className="text-[14px] font-medium text-ink sm:sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="h-8 w-full cursor-pointer appearance-none rounded-control border border-line-strong bg-surface pr-7 pl-2.5 text-[13px] text-ink max-lg:h-10 max-lg:text-[15px] max-sm:h-12 max-sm:bg-input max-sm:pl-3 max-sm:text-[16px]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={2.2}
        aria-hidden="true"
        className="pointer-events-none absolute right-2 bottom-[9px] text-ink-muted max-lg:bottom-[13px] max-sm:right-3 max-sm:bottom-[17px]"
      />
    </div>
  )
}

/** The value of a field, or "leer". */
function Value({ text }: { readonly text: string | null }) {
  return text === null ? <span className="text-ink-faint">leer</span> : <>{text}</>
}

/**
 * The fields of an opened change before and after, the table of the board.
 * The log of the instance (#188) shows its changes the same way.
 */
export function FieldsTable({
  change,
  page,
}: {
  readonly change: AuditChange
  readonly page: AuditNames
}) {
  const words = useAuditWords()

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] table-fixed border-collapse text-[13px] text-ink">
        <caption className="sr-only">Felder vorher und nachher</caption>
        <thead>
          <tr className="text-left font-condensed text-[12px] font-semibold tracking-[0.8px] text-ink-faint uppercase">
            <th scope="col" className="w-[150px] pr-2.5 pb-1.5">
              Feld
            </th>
            <th scope="col" className="px-2.5 pb-1.5">
              Vorher
            </th>
            <th scope="col" className="pb-1.5 pl-2.5">
              Nachher
            </th>
          </tr>
        </thead>
        <tbody>
          {words.shownFields(change).map((field) => (
            <tr key={field.field} className="border-t border-row align-top">
              <th scope="row" className="py-[7px] pr-2.5 text-left font-medium">
                {words.fieldWords(change.table, field.field)}
              </th>
              <td className="px-2.5 py-[7px] break-words text-ink-muted">
                <Value text={words.auditValue(change.table, field.field, field.before, page)} />
              </td>
              <td className="py-[7px] pl-2.5 break-words">
                <Value text={words.auditValue(change.table, field.field, field.after, page)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The same fields on a phone, one under the other, in the opened box. */
export function FieldList({
  change,
  page,
}: {
  readonly change: AuditChange
  readonly page: AuditNames
}) {
  const words = useAuditWords()

  return (
    <dl className="mt-2">
      {words.shownFields(change).map((field) => (
        <div key={field.field} className="border-t border-row py-2">
          <dt className="text-[13px] font-semibold">
            {words.fieldWords(change.table, field.field)}
          </dt>
          <dd className="text-[14px] text-ink-muted">
            <span className="text-[12px] text-ink-faint">Vorher </span>
            <Value text={words.auditValue(change.table, field.field, field.before, page)} />
          </dd>
          <dd className="text-[14px]">
            <span className="text-[12px] text-ink-faint">Nachher </span>
            <Value text={words.auditValue(change.table, field.field, field.after, page)} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The line over an opened change: when, by whom, on which device and way,
 * the moment in bold as the boards set it. The log of the instance (#188)
 * opens its changes with the same line.
 */
export function ChangeFacts({
  change,
  page,
}: {
  readonly change: AuditChange
  readonly page: AuditNames
}) {
  const words = useAuditWords()

  const said = words.wayWords(change, page)
  const at = new Date(change.changedAt)
  const verb =
    change.operation === 'insert'
      ? 'Angelegt'
      : change.operation === 'delete'
        ? 'Entfernt'
        : 'Geändert'

  return (
    <p className="mb-2.5 flex flex-wrap gap-x-[18px] gap-y-1 text-[13px] text-ink-muted">
      <span>
        {`${verb} am `}
        <strong className="font-semibold text-ink">{`${deviceDay.format(at)} um ${clockTime(at)}`}</strong>
        {said.person ? ` von ${said.person}` : ''}
      </span>
      {said.device ? <span>{`Gerät: ${said.device}`}</span> : null}
      <span>{`Weg: ${said.way}`}</span>
    </p>
  )
}

/** The buttons under an opened change: the log of this record only, and the record itself. */
function ChangeLinks({
  change,
  narrowedTo,
  wide,
}: {
  readonly change: AuditChange
  readonly narrowedTo: string | null
  readonly wide: boolean
}) {
  const words = useAuditWords()

  const look = useButtonLook()
  const navigate = useNavigate()
  const href = words.recordHref(change.table, change.recordId)
  const own = words.language.records.includes(change.table) && narrowedTo !== change.recordId

  return (
    <>
      {own ? (
        <Button
          icon={History}
          wide={wide}
          className={wide ? 'only:col-span-2' : undefined}
          onClick={() => {
            void navigate({
              to: auditLogPath,
              search: { art: change.table, datensatz: change.recordId },
            })
          }}
        >
          Nur dieser Datensatz
        </Button>
      ) : null}
      {href ? (
        <Link to={href} className={clsx(look, wide && 'w-full only:col-span-2')}>
          <ChevronRight size={15} strokeWidth={2.3} aria-hidden="true" className="shrink-0" />
          {words.recordLinkWords(change.table)}
        </Link>
      ) : null}
    </>
  )
}

/** One change opened above the list: its facts and its fields before and after. */
function ChangePanel({
  change,
  page,
  narrowedTo,
  onClose,
}: {
  readonly change: AuditChange
  readonly page: AuditPage
  readonly narrowedTo: string | null
  readonly onClose: () => void
}) {
  const words = useAuditWords()

  return (
    <Panel
      title={`${words.recordKind(change.table, change.recordId, page)} ${words.recordTitle(change.table, change.recordId, page)}`}
    >
      <ChangeFacts change={change} page={page} />
      <FieldsTable change={change} page={page} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ChangeLinks change={change} narrowedTo={narrowedTo} wide={false} />
        <div className="grow" />
        <Button onClick={onClose}>Schließen</Button>
      </div>
    </Panel>
  )
}

/** The person, and under it the device and the way; a change past the application stands out. */
export function PersonCell({
  change,
  page,
}: {
  readonly change: AuditChange
  readonly page: AuditNames
}) {
  const words = useAuditWords()

  const said = words.wayWords(change, page)

  return (
    <>
      {said.person ?? <span className="text-ink-faint">Niemand</span>}
      <span className="block text-[12px] text-ink-faint">
        {said.device ? `${said.device} · ` : ''}
        <span className={said.direct ? 'font-semibold text-waiting' : undefined}>{said.way}</span>
      </span>
    </>
  )
}

function BreakMark() {
  return (
    <span className="flex items-center gap-1 text-[12px] font-semibold text-conflict">
      <TriangleAlert size={12} strokeWidth={2.4} aria-hidden="true" />
      Kette bricht hier
    </span>
  )
}

function ChangeTable({
  page,
  report,
  opened,
  onOpen,
  footer,
}: {
  readonly page: AuditPage
  readonly report: AuditChainReport | undefined
  readonly opened: string | null
  readonly onOpen: (changeId: string) => void
  readonly footer: ReactNode
}) {
  const words = useAuditWords()

  return (
    <TablePanel caption="Änderungen" footer={footer}>
      <thead>
        <tr>
          <Column className="w-[120px] min-w-[112px]">Zeitpunkt</Column>
          <Column className="min-w-[170px]">Datensatz</Column>
          <Column className="w-[190px] min-w-[150px]">Änderung</Column>
          <Column className="w-[214px] min-w-[180px]">Person, Gerät, Weg</Column>
        </tr>
      </thead>
      <tbody>
        {page.changes.map((change) => (
          <tr
            key={change.changeId}
            className={change.changeId === opened ? 'bg-selected' : undefined}
          >
            <Cell className="numeric">
              {moment(change.changedAt)}
              {breaksHere(change, report) ? <BreakMark /> : null}
            </Cell>
            <Cell>
              <button
                type="button"
                aria-expanded={change.changeId === opened}
                onClick={() => {
                  onOpen(change.changeId)
                }}
                className="cursor-pointer text-left text-ink hover:underline"
              >
                {words.recordTitle(change.table, change.recordId, page)}
              </button>
              <span className="block text-[12px] text-ink-faint">
                {words.recordKind(change.table, change.recordId, page)}
              </span>
            </Cell>
            <Cell className="text-ink-muted">{words.changeSummary(change)}</Cell>
            <Cell>
              <PersonCell change={change} page={page} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** On a phone, one box per change; the opened one shows its fields in place. */
function PhoneList({
  page,
  report,
  opened,
  onOpen,
  narrowedTo,
}: {
  readonly page: AuditPage
  readonly report: AuditChainReport | undefined
  readonly opened: string | null
  readonly onOpen: (changeId: string | null) => void
  readonly narrowedTo: string | null
}) {
  const words = useAuditWords()

  return (
    <ul aria-label="Änderungen" className="flex flex-col gap-2">
      {page.changes.map((change) => {
        const isOpen = change.changeId === opened
        const said = words.wayWords(change, page)

        return (
          <li
            key={change.changeId}
            className={clsx(
              'rounded-[6px] border px-3 py-2.5',
              isOpen ? 'border-line-strong bg-selected' : 'border-line bg-surface',
            )}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                onOpen(isOpen ? null : change.changeId)
              }}
              className="flex w-full cursor-pointer flex-col gap-0.5 text-left text-ink"
            >
              <span className="flex items-baseline gap-2 text-[13px] text-ink-faint">
                <span>{words.recordKind(change.table, change.recordId, page)}</span>
                <span className="grow" />
                <span className="numeric">{moment(change.changedAt)}</span>
              </span>
              <span className="text-[16px] font-semibold [overflow-wrap:anywhere]">
                {words.recordTitle(change.table, change.recordId, page)}
              </span>
              <span className="text-[14px] text-ink-muted">{words.changeSummary(change)}</span>
              <span className="text-[13px] text-ink-faint">
                {[said.person ?? 'Niemand', said.device, said.way].filter(Boolean).join(' · ')}
              </span>
              {breaksHere(change, report) ? <BreakMark /> : null}
            </button>
            {isOpen ? (
              <>
                <FieldList change={change} page={page} />
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <ChangeLinks change={change} narrowedTo={narrowedTo} wide />
                </div>
              </>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * "Änderungen" at the head of a record: the log of this record and its parts,
 * for whoever may read the log and nobody else. Placed before the other
 * actions, as the board "Knopf „Änderungen“ an den Datensätzen" of the canvas
 * of the trades application has it.
 */
export function ChangesButton({ table, id }: { readonly table: string; readonly id: string }) {
  const reads = useRight(auditRights.read)
  const look = useButtonLook()

  if (!reads) {
    return null
  }

  return (
    <Link to={auditLogPath} search={{ art: table, datensatz: id }} className={look}>
      <History size={15} strokeWidth={2.3} aria-hidden="true" className="shrink-0" />
      Änderungen
    </Link>
  )
}
