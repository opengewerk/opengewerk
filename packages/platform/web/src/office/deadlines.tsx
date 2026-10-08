import { leadProblem } from '@opengewerk/platform-domain'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, RotateCcw, TriangleAlert } from 'lucide-react'
import { type ReactNode, useDeferredValue, useMemo, useState } from 'react'

import { Button } from '../components/button.js'
import { Field, SelectField } from '../components/field.js'
import { Panel, TablePanel } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { date, moment, today } from '../format.js'
import { useRight } from '../session/queries.js'
import { RequestRefused } from '../sync/transport.js'
import {
  changeDeadline,
  type DeadlineFilter,
  type DeadlineKindView,
  deadlineKinds,
  deadlinePage,
  deadlineRun,
  type DeadlineView,
  markDeadlineDone,
  reopenDeadline,
} from './deadline-requests.js'
import { Chip, Empty, FilterSelect, NoteBox, PageHead, Screen } from './kit.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const filters: readonly { readonly value: DeadlineFilter; readonly label: string }[] = [
  { value: 'open', label: 'Offen' },
  { value: 'done', label: 'Erledigt' },
  { value: 'dropped', label: 'Entfallen' },
  { value: 'all', label: 'Alle' },
]

/** Somebody a deadline can be given to, as the application lists the people of the tenant. */
export interface DeadlineCandidate {
  readonly userId: string
  readonly name: string
  /** Whether the person can still sign in; somebody blocked is offered only where already chosen. */
  readonly active: boolean
}

/** The people of the tenant and who is looking, from a hook of the application. */
export interface DeadlinePeople {
  readonly me: string | null
  readonly people: readonly DeadlineCandidate[]
}

/** A column the application adds to the list, between what is due and who answers for it. */
export interface DeadlineColumn<View extends DeadlineView> {
  readonly header: string
  /** The width and the floor of the column, as the other columns have them. */
  readonly className: string
  /** What stands in the cell, and in the line under the title of a card on a phone. */
  readonly text: (deadline: View) => string | null | undefined
  /** What stands in the cell instead of the text: two lines with a link, for one. The card keeps the text. */
  readonly cell?: (deadline: View) => ReactNode
}

/** A filter the application adds to the list, between the kind and the person. */
export interface DeadlineListFilter {
  /** Its name in the address the list asks the server: "house". */
  readonly key: string
  /** What it says to a screen reader: "Nach Haus filtern". */
  readonly label: string
  /** The choice that narrows nothing: "Alle Häuser". */
  readonly all: string
  /** The width of the choice, as the other filters have one. */
  readonly width: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
}

/** What the list says in the words of the application. */
export interface DeadlineListWords {
  /** The sentence under the title: what the list is and how a deadline comes about. */
  readonly sub: string
  /** What the search looks in, as its placeholder says it. */
  readonly searchPlaceholder: string
  /** What the list says when nothing at all is open, and how the first deadline comes. */
  readonly emptyOpen: string
}

/** What the application hands the list of deadlines. */
export interface DeadlineListProps<View extends DeadlineView, Kind extends DeadlineKindView> {
  /** The rights of the application that read the deadlines and decide about them. */
  readonly rights: { readonly read: string; readonly write: string }
  readonly words: DeadlineListWords
  /** The people of the tenant, as a hook of the application. */
  readonly usePeople: () => DeadlinePeople
  /** Where the source of a deadline is found, and what it is called in the list. */
  readonly source: {
    readonly href: (deadline: View) => string | null
    readonly name: (deadline: View) => string
  }
  readonly columns?: readonly DeadlineColumn<View>[]
  /**
   * The filters of the application beside the kind and the person, asked of
   * the server by their key; what the search looks in beside the source and
   * the kind is the server's (`searchIn` of the rules).
   */
  readonly filters?: readonly DeadlineListFilter[]
  /** What the card of a deadline says beside the day it is due: the record it hangs on, for one. */
  readonly cardFacts?: (deadline: View) => ReactNode
  /** Who answers for a deadline of a kind when nobody has said otherwise, in words. */
  readonly responsibleLabel: (kind: Kind) => string
  /** The day an interval counts from, after "nach": "dem Festschreiben". */
  readonly anchorWords: (kind: Kind) => string
  /**
   * What the application does once a deadline here has changed, after the
   * deadlines are asked for anew: fetch what the server changed along with
   * it, whatever a deadline opened and closes again, for one.
   */
  readonly afterChange?: () => void
}

/** Asks for the deadlines anew, then lets the application follow up. */
function useRefresh(afterChange: (() => void) | undefined): () => void {
  const queries = useQueryClient()

  return () => {
    void queries.invalidateQueries({ queryKey: ['deadlines'] })
    afterChange?.()
  }
}

/** The column "Erinnerung": when it reminded, or when it will, or why it is closed. */
function reminding(deadline: DeadlineView): string {
  if (deadline.status === 'done') {
    return deadline.closedAt ? `erledigt am ${date(deadline.closedAt.slice(0, 10))}` : 'erledigt'
  }

  if (deadline.status === 'dropped') {
    return deadline.closedAt ? `entfallen am ${date(deadline.closedAt.slice(0, 10))}` : 'entfallen'
  }

  if (deadline.remindedFor === deadline.dueOn && deadline.remindedAt) {
    return `erinnert am ${date(deadline.remindedAt.slice(0, 10))}`
  }

  return `am ${date(deadline.remindOn)}`
}

/** Whether an open deadline is past its day. */
function late(deadline: DeadlineView, now: string): boolean {
  return deadline.status === 'open' && deadline.dueOn < now
}

/**
 * Everything that falls due, the list of deadlines (opengewerk-haustechnik#24).
 *
 * Nothing is created here: a deadline follows from its source, and the
 * sentence under the table says so. What a person decides is on the card that
 * opens above the list: a lead of its own, another person, done. A pass of the
 * engine that did not happen is said above the list.
 *
 * A tenant has a few thousand open deadlines, so the list asks the server for
 * a page at a time (opengewerk-haustechnik#104), narrowed there by the state,
 * the kind, the person, the search and the filters of the application.
 * Narrowed to one person it names no number, neither above the list nor under
 * it: no evaluation by person.
 */
export function DeadlineListScreen<View extends DeadlineView, Kind extends DeadlineKindView>(
  props: DeadlineListProps<View, Kind>,
) {
  const readsDeadlines = useRight(props.rights.read)
  const [status, setStatus] = useState<DeadlineFilter>('open')
  const [kind, setKind] = useState('')
  const [person, setPerson] = useState('')
  const [search, setSearch] = useState('')
  const [narrowing, setNarrowing] = useState<Readonly<Record<string, string>>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const wanted = useDeferredValue(search.trim())
  const { people } = props.usePeople()

  const question = { status, kind, person, search: wanted, filters: narrowing }
  const pages = useInfiniteQuery({
    queryKey: ['deadlines', 'list', question],
    queryFn: ({ pageParam }) => deadlinePage<View>({ ...question, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.more ? all.reduce((sum, page) => sum + page.rows.length, 0) : undefined,
    enabled: readsDeadlines,
    placeholderData: keepPreviousData,
    // A refusal is an answer: asking again brings the same one.
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const kinds = useQuery({
    queryKey: ['deadlines', 'kinds'],
    queryFn: () => deadlineKinds<Kind>(),
    enabled: readsDeadlines,
    staleTime: 5 * 60_000,
  })

  const first = pages.data?.pages[0]
  const rows = useMemo(() => pages.data?.pages.flatMap((page) => page.rows) ?? [], [pages.data])
  // Who can answer for a deadline: whoever works for the tenant and can sign
  // in; a deadline never waits with somebody blocked.
  const responsibles = useMemo(
    () =>
      people
        .filter((candidate) => candidate.active)
        .map((candidate) => [candidate.userId, candidate.name] as const)
        .sort(([, left], [, right]) => left.localeCompare(right, 'de')),
    [people],
  )
  const narrowed =
    kind !== '' ||
    person !== '' ||
    wanted !== '' ||
    Object.values(narrowing).some((value) => value !== '')
  /** A filter set anew, with the card of a deadline that may no longer be in the list closed. */
  const narrow = (change: () => void) => {
    change()
    setEditing(null)
  }

  const opened = rows.find((row) => row.id === editing) ?? null
  const openedKind =
    opened && Array.isArray(kinds.data)
      ? (kinds.data.find((candidate) => candidate.key === opened.kind) ?? null)
      : null

  return (
    <Screen>
      <PageHead
        title="Fristen"
        sub={props.words.sub}
        {...(status === 'open' && first && first.total !== null
          ? { count: `${first.total.toLocaleString('de-DE')} offen` }
          : {})}
      />
      {!readsDeadlines ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Fristen sehen darf dieser Zugang nicht.
        </p>
      ) : (
        <>
          <DeadlineRunNote />
          <div className="flex flex-wrap items-center gap-[9px]">
            <label className="sr-only" htmlFor="fristen-suche">
              Fristen durchsuchen
            </label>
            <input
              id="fristen-suche"
              type="search"
              value={search}
              placeholder={props.words.searchPlaceholder}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
              className="h-8 w-[260px] rounded-control border border-line-strong bg-surface px-2.5 text-[14px] text-ink max-lg:h-10 max-lg:w-full"
            />
            {filters.map((filter) => (
              <Chip
                key={filter.value}
                pressed={status === filter.value}
                onPress={() => {
                  setStatus(filter.value)
                  setEditing(null)
                }}
              >
                {filter.label}
              </Chip>
            ))}
            <div className="grow max-lg:hidden" />
            <FilterSelect
              label="Nach Art filtern"
              width="w-[230px]"
              value={kind}
              onChange={(value) => {
                narrow(() => {
                  setKind(value)
                })
              }}
              options={[
                { value: '', label: 'Alle Arten' },
                ...(Array.isArray(kinds.data) ? kinds.data : []).map((entry) => ({
                  value: entry.key,
                  label: entry.title,
                })),
              ]}
            />
            {(props.filters ?? []).map((filter) => (
              <FilterSelect
                key={filter.key}
                label={filter.label}
                width={filter.width}
                value={narrowing[filter.key] ?? ''}
                onChange={(value) => {
                  narrow(() => {
                    setNarrowing((before) => ({ ...before, [filter.key]: value }))
                  })
                }}
                options={[{ value: '', label: filter.all }, ...filter.options]}
              />
            ))}
            <FilterSelect
              label="Nach Person filtern"
              width="w-[190px]"
              value={person}
              onChange={(value) => {
                narrow(() => {
                  setPerson(value)
                })
              }}
              options={[
                { value: '', label: 'Alle Personen' },
                ...responsibles.map(([userId, name]) => ({ value: userId, label: name })),
              ]}
            />
          </div>

          {opened && openedKind ? (
            <DeadlineCard
              key={opened.id}
              deadline={opened}
              kind={openedKind}
              props={props}
              onClose={() => {
                setEditing(null)
              }}
            />
          ) : null}

          {pages.isPending ? (
            <p className="text-[13px] text-ink-muted">Wird geladen.</p>
          ) : pages.isError ? (
            <p className="text-[13px] text-ink-muted">
              {saidWhy(pages.error, 'Die Fristen kamen nicht an.')}
            </p>
          ) : (
            <DeadlineTable
              rows={rows}
              empty={rows.length === 0 && !narrowed ? status : null}
              selected={editing}
              onEdit={setEditing}
              props={props}
              footer={
                first?.total === null && !pages.hasNextPage ? null : (
                  <>
                    <span className="numeric">
                      {first?.total === null || first?.total === undefined
                        ? ''
                        : `${rows.length.toLocaleString('de-DE')} von ${first.total.toLocaleString('de-DE')}`}
                    </span>
                    <span className="grow" />
                    {pages.hasNextPage ? (
                      <Button
                        size="small"
                        disabled={pages.isFetchingNextPage}
                        onClick={() => {
                          void pages.fetchNextPage()
                        }}
                      >
                        Weitere laden
                      </Button>
                    ) : null}
                  </>
                )
              }
            />
          )}
        </>
      )}
    </Screen>
  )
}

/**
 * Said above the list when the engine has not gone through the deadlines of
 * the tenant for too long, or failed the last time: a reminder that never came
 * looks exactly like one that was not due, and this is where it shows. Nothing
 * while all is well, nothing while the answer is on its way.
 *
 * It says what may be missing and not that nothing happened: a pass that
 * fails over one reminder has written the deadlines before it and made every
 * other reminder.
 */
function DeadlineRunNote() {
  const run = useQuery({
    queryKey: ['deadlines', 'run'],
    queryFn: deadlineRun,
    staleTime: 60_000,
    retry: false,
  })

  if (!run.data?.behind) {
    return null
  }

  const { succeededAt, failedAt } = run.data
  const said =
    failedAt !== null && (succeededAt === null || failedAt > succeededAt)
      ? `Der letzte Abgleich der Fristen am ${moment(failedAt)} ist gescheitert.`
      : succeededAt === null
        ? 'Die Fristen wurden noch nie abgeglichen.'
        : `Die Fristen wurden zuletzt am ${moment(succeededAt)} abgeglichen.`

  return (
    <div role="alert">
      <NoteBox tone="conflict" icon={TriangleAlert}>
        {said} Bis der Abgleich wieder durchläuft, können neue Fristen fehlen und Erinnerungen
        ausbleiben. Wer die Instanz betreibt, findet den Grund im Protokoll der Anwendung.
      </NoteBox>
    </div>
  )
}

/** The table of the list, with a box per deadline on a phone. */
function DeadlineTable<View extends DeadlineView, Kind extends DeadlineKindView>({
  rows,
  empty,
  selected,
  onEdit,
  props,
  footer,
}: {
  readonly rows: readonly View[]
  /** The state asked for, when the server had nothing in it at all. */
  readonly empty: DeadlineFilter | null
  readonly selected: string | null
  readonly onEdit: (id: string) => void
  readonly props: DeadlineListProps<View, Kind>
  /** How many of how many are shown, and the way to the next page; null for none. */
  readonly footer: ReactNode
}) {
  const writes = useRight(props.rights.write)
  const now = today()
  const columns = props.columns ?? []
  const note =
    'Fristen entstehen von selbst aus ihrer Quelle, angelegt wird keine von Hand. Wie viele Tage vorher erinnert wird, gibt die Art vor, unter „Einstellungen“, „Fristen“.'

  if (empty !== null) {
    return (
      <Panel>
        <Empty>{empty === 'open' ? props.words.emptyOpen : 'Hier steht keine Frist.'}</Empty>
      </Panel>
    )
  }

  const actions = (deadline: View) =>
    writes ? <RowActions deadline={deadline} onEdit={onEdit} props={props} /> : null

  return (
    <TablePanel
      caption="Fristen"
      note={note}
      footer={footer}
      cards={rows.map((deadline) => {
        const href = props.source.href(deadline)

        return {
          key: deadline.id,
          title: href ? (
            <Link to={href} className="text-inherit no-underline hover:underline">
              {props.source.name(deadline)}
            </Link>
          ) : (
            props.source.name(deadline)
          ),
          sub: [
            deadline.kindTitle,
            ...columns.map((column) => column.text(deadline)),
            deadline.responsible?.name,
          ]
            .filter(Boolean)
            .join(' · '),
          right: (
            <span className={late(deadline, now) ? 'font-semibold text-conflict' : undefined}>
              {date(deadline.dueOn)}
            </span>
          ),
          actions: actions(deadline),
        }
      })}
      cardsEmpty="Keine Frist passt zur Suche."
    >
      <thead>
        <tr>
          {/* Each column has a floor as well as its width. Without one a
              table next to the navigation, 770 pixels at 1024, squeezed the
              one column without a width, the one that says what is due, to
              92 pixels; with them it keeps its columns and the frame scrolls,
              as the board "Breiten und Auflösungen" has it. */}
          <Column className="w-[110px] min-w-[88px]">Fällig am</Column>
          <Column className="min-w-[180px]">Betrifft</Column>
          {columns.map((column) => (
            <Column key={column.header} className={column.className}>
              {column.header}
            </Column>
          ))}
          <Column className="w-[130px] min-w-[110px]">Verantwortlich</Column>
          <Column className="w-[150px] min-w-[130px]">Erinnerung</Column>
          {writes ? (
            <Column numeric className="w-[160px] min-w-[150px]">
              <span className="sr-only">Ändern</span>
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((deadline) => {
          const href = props.source.href(deadline)

          return (
            <tr key={deadline.id} className={deadline.id === selected ? 'bg-selected' : undefined}>
              <Cell>
                {late(deadline, now) ? (
                  <>
                    <span className="font-semibold text-conflict">{date(deadline.dueOn)}</span>
                    <span className="block text-[12px] text-conflict">überfällig</span>
                  </>
                ) : (
                  date(deadline.dueOn)
                )}
              </Cell>
              <Cell>
                {href ? (
                  <Link to={href} className="text-inherit no-underline hover:underline">
                    {props.source.name(deadline)}
                  </Link>
                ) : (
                  props.source.name(deadline)
                )}
                <span className="block text-[12px] text-ink-faint">{deadline.kindTitle}</span>
              </Cell>
              {columns.map((column) => (
                <Cell key={column.header}>
                  {column.cell ? column.cell(deadline) : (column.text(deadline) ?? '')}
                </Cell>
              ))}
              <Cell>{deadline.responsible?.name ?? ''}</Cell>
              <Cell
                className={deadline.remindedFor === deadline.dueOn ? 'text-ink-muted' : undefined}
              >
                {reminding(deadline)}
              </Cell>
              {writes ? <Cell numeric>{actions(deadline)}</Cell> : null}
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}

/** The buttons of a row: open it for a change, and done or back again. */
function RowActions<View extends DeadlineView, Kind extends DeadlineKindView>({
  deadline,
  onEdit,
  props,
}: {
  readonly deadline: View
  readonly onEdit: (id: string) => void
  readonly props: DeadlineListProps<View, Kind>
}) {
  const refresh = useRefresh(props.afterChange)
  const [trouble, setTrouble] = useState<string | null>(null)
  const settle = useMutation({
    mutationFn: () =>
      deadline.status === 'done' ? reopenDeadline(deadline.id) : markDeadlineDone(deadline.id),
    onSuccess: () => {
      setTrouble(null)
      refresh()
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Das ließ sich nicht speichern.'))
    },
  })

  if (deadline.status === 'dropped') {
    return null
  }

  return (
    <span className="inline-flex items-center justify-end gap-1">
      {deadline.status === 'open' ? (
        <Button
          size="small"
          aria-label={`Frist zu ${props.source.name(deadline)} ändern`}
          onClick={() => {
            onEdit(deadline.id)
          }}
        >
          Ändern
        </Button>
      ) : null}
      <Button
        size="small"
        icon={deadline.status === 'done' ? RotateCcw : undefined}
        disabled={settle.isPending}
        onClick={() => {
          settle.mutate()
        }}
      >
        {deadline.status === 'done' ? 'Wieder öffnen' : 'Erledigt'}
      </Button>
      {trouble ? (
        <span role="alert" className="sr-only">
          {trouble}
        </span>
      ) : null}
    </span>
  )
}

/** How far the due day lies after the anchor, in the unit of the kind, for the card. */
function intervalSaid(deadline: DeadlineView, kind: DeadlineKindView, anchor: string): string {
  if (kind.intervalDays !== null) {
    const days = Math.round(
      (Date.parse(`${deadline.dueOn}T00:00:00Z`) - Date.parse(`${deadline.anchorOn}T00:00:00Z`)) /
        86_400_000,
    )

    return days > 0 ? `, ${String(days)} Tage nach ${anchor} am ${date(deadline.anchorOn)}` : ''
  }

  if (kind.intervalMonths !== undefined && kind.intervalMonths !== null) {
    const months =
      (Number(deadline.dueOn.slice(0, 4)) - Number(deadline.anchorOn.slice(0, 4))) * 12 +
      Number(deadline.dueOn.slice(5, 7)) -
      Number(deadline.anchorOn.slice(5, 7))

    return months > 0
      ? `, ${String(months)} ${months === 1 ? 'Monat' : 'Monate'} nach ${anchor} am ${date(deadline.anchorOn)}`
      : ''
  }

  return ''
}

/** The card above the list for one deadline: its own lead, its own person, done. */
function DeadlineCard<View extends DeadlineView, Kind extends DeadlineKindView>({
  deadline,
  kind,
  props,
  onClose,
}: {
  readonly deadline: View
  readonly kind: Kind
  readonly props: DeadlineListProps<View, Kind>
  readonly onClose: () => void
}) {
  const refresh = useRefresh(props.afterChange)
  const { me, people } = props.usePeople()
  const [lead, setLead] = useState(
    deadline.ownLeadDays === null ? '' : String(deadline.ownLeadDays),
  )
  const [responsible, setResponsible] = useState(deadline.ownResponsibleUserId ?? '')
  const [trouble, setTrouble] = useState<string | null>(null)

  const typed = lead.trim()
  const leadDays = typed === '' ? null : Number(typed)
  const problem = leadDays === null ? null : leadProblem(leadDays)
  const kindLead = kind.setting.leadDays ?? kind.leadDays
  const label = props.responsibleLabel(kind)
  const responsibleUserId = responsible || null
  // What changed and nothing else (opengewerk-haustechnik#31). Sent whole, a
  // new lead put back the person somebody else had chosen while the card was
  // open, and a new person hands the task of the day on.
  const change = {
    ...(leadDays !== deadline.ownLeadDays ? { leadDays } : {}),
    ...(responsibleUserId !== deadline.ownResponsibleUserId ? { responsibleUserId } : {}),
  }
  const changed = Object.keys(change).length > 0

  const save = useMutation({
    mutationFn: () => changeDeadline(deadline.id, change),
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Frist ließ sich nicht speichern.'))
    },
  })
  const done = useMutation({
    mutationFn: () => markDeadlineDone(deadline.id),
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Frist ließ sich nicht als erledigt markieren.'))
    },
  })

  const options = [
    { value: '', label: `Wie die Art vorgibt: ${label}` },
    ...people
      .filter((candidate) => candidate.active || candidate.userId === deadline.ownResponsibleUserId)
      .map((candidate) => ({
        value: candidate.userId,
        label: candidate.userId === me ? `${candidate.name} (du)` : candidate.name,
      })),
  ]

  return (
    <Panel title={`Frist: ${deadline.kindTitle}, ${deadline.source.label}`}>
      <div className="mb-3 flex flex-wrap gap-x-[22px] gap-y-1.5 text-[13px] text-ink-muted">
        <span>
          Fällig am <strong className="text-ink">{date(deadline.dueOn)}</strong>
          {intervalSaid(deadline, kind, props.anchorWords(kind))}
        </span>
        {props.cardFacts?.(deadline) ?? null}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field
          label="Vorlauf in Tagen"
          numeric
          inputMode="numeric"
          value={lead}
          placeholder={String(kindLead)}
          onChange={(event) => {
            setLead(event.target.value)
          }}
          hint={`Leer: die Vorgabe der Art, zurzeit ${String(kindLead)} Tage. Erinnert wird so viele Tage vor der Fälligkeit.`}
          {...(problem ? { problem } : {})}
        />
        <SelectField
          label="Verantwortlich"
          value={responsible}
          onChange={setResponsible}
          options={options}
          hint={`Die Vorgabe der Art: ${label.replace(/^\S/, (first) => first.toLocaleLowerCase('de'))}.`}
        />
      </div>
      {trouble ? (
        <p role="alert" className="mt-3 text-[13px] text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          icon={Check}
          disabled={done.isPending}
          onClick={() => {
            done.mutate()
          }}
        >
          Als erledigt markieren
        </Button>
        <div className="grow" />
        <Button onClick={onClose}>Abbrechen</Button>
        <Button
          tone="primary"
          icon={Check}
          disabled={!changed || problem !== null || save.isPending}
          onClick={() => {
            save.mutate()
          }}
        >
          Speichern
        </Button>
      </div>
    </Panel>
  )
}
