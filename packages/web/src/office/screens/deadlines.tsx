import { defaultResponsibleLabel, leadProblem, sourceWords } from '@opengewerk/domain'
import {
  Button,
  Cell,
  Column,
  Field,
  Panel,
  SelectField,
  TablePanel,
} from '@opengewerk/platform-web'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import { usePeople } from '../../app/tasks.js'
import {
  changeDeadline,
  type DeadlineFilter,
  type DeadlineKindView,
  deadlineKinds,
  deadlineList,
  type DeadlineView,
  markDeadlineDone,
  reopenDeadline,
} from '../../session/deadlines.js'
import { RequestRefused } from '../../sync/transport.js'
import { Chip, Empty, FilterSelect, PageHead, Screen } from '../kit.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const filters: readonly { readonly value: DeadlineFilter; readonly label: string }[] = [
  { value: 'open', label: 'Offen' },
  { value: 'done', label: 'Erledigt' },
  { value: 'dropped', label: 'Entfallen' },
  { value: 'all', label: 'Alle' },
]

/** Where the source of a deadline is found in the office. */
function sourceHref(deadline: DeadlineView): string | null {
  if (deadline.source.documentId !== null) {
    return `/belege/${deadline.source.documentId}`
  }

  if (deadline.source.installationId !== null) {
    return `/anlagen/${deadline.source.installationId}`
  }

  return null
}

/** What the source is, in the list: "Angebot A-2026-0091". */
function sourceName(deadline: DeadlineView): string {
  return deadline.source.documentId !== null
    ? `Angebot ${deadline.source.label}`
    : deadline.source.label
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
 * Everything that falls due, the list "Fristen" of section 1.2 (#283),
 * `fristen()` of the canvas.
 *
 * Nothing is created here: a deadline follows from its source, and the
 * sentence under the table says so. What the office decides is on the card
 * that opens above the list: a lead of its own, another person, done. The
 * chips ask the server for a state, the kind, the person and the search
 * narrow what came back.
 */
export function DeadlineListScreen() {
  const readsDeadlines = useMay('deadline.read')
  const [status, setStatus] = useState<DeadlineFilter>('open')
  const [kind, setKind] = useState('')
  const [person, setPerson] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['deadlines', status],
    queryFn: () => deadlineList(status),
    enabled: readsDeadlines,
  })
  const kinds = useQuery({
    queryKey: ['deadlines', 'kinds'],
    queryFn: deadlineKinds,
    enabled: readsDeadlines,
    staleTime: 5 * 60_000,
  })

  const rows = useMemo(() => (Array.isArray(list.data) ? list.data : []), [list.data])
  const responsibles = useMemo(() => {
    const byId = new Map<string, string>()

    for (const row of rows) {
      if (row.responsible) {
        byId.set(row.responsible.userId, row.responsible.name)
      }
    }

    return [...byId.entries()].sort(([, left], [, right]) => left.localeCompare(right, 'de'))
  }, [rows])

  const wanted = search.trim().toLocaleLowerCase('de')
  const found = rows.filter(
    (row) =>
      (kind === '' || row.kind === kind) &&
      (person === '' || row.responsible?.userId === person) &&
      (wanted === '' ||
        [row.source.label, row.customer?.name ?? '', row.kindTitle].some((value) =>
          value.toLocaleLowerCase('de').includes(wanted),
        )),
  )
  const opened = rows.find((row) => row.id === editing) ?? null
  const openedKind =
    opened && Array.isArray(kinds.data)
      ? (kinds.data.find((candidate) => candidate.key === opened.kind) ?? null)
      : null

  return (
    <Screen>
      <PageHead
        title="Fristen"
        sub="Was fällig wird, nach Fälligkeit. Eine Frist folgt ihrer Quelle: folgt dem Angebot ein Beleg, entfällt sie."
        {...(status === 'open' && list.isSuccess
          ? { count: `${rows.length.toLocaleString('de-DE')} offen` }
          : {})}
      />
      {!readsDeadlines ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Fristen sehen darf dieser Zugang nicht.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-[9px]">
            <label className="sr-only" htmlFor="fristen-suche">
              Fristen durchsuchen
            </label>
            <input
              id="fristen-suche"
              type="search"
              value={search}
              placeholder="Kunde, Angebot, Anlage …"
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
              onChange={setKind}
              options={[
                { value: '', label: 'Alle Arten' },
                ...(Array.isArray(kinds.data) ? kinds.data : []).map((entry) => ({
                  value: entry.key,
                  label: entry.title,
                })),
              ]}
            />
            <FilterSelect
              label="Nach Person filtern"
              width="w-[190px]"
              value={person}
              onChange={setPerson}
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
              onClose={() => {
                setEditing(null)
              }}
            />
          ) : null}

          {list.isPending ? (
            <p className="text-[13px] text-ink-muted">Wird geladen.</p>
          ) : list.isError ? (
            <p className="text-[13px] text-ink-muted">
              {saidWhy(list.error, 'Die Fristen kamen nicht an.')}
            </p>
          ) : (
            <DeadlineTable
              rows={found}
              empty={rows.length === 0 ? status : null}
              selected={editing}
              onEdit={setEditing}
            />
          )}
        </>
      )}
    </Screen>
  )
}

/** The table of the list, with a box per deadline on a phone. */
function DeadlineTable({
  rows,
  empty,
  selected,
  onEdit,
}: {
  readonly rows: readonly DeadlineView[]
  /** The state asked for, when the server had nothing in it at all. */
  readonly empty: DeadlineFilter | null
  readonly selected: string | null
  readonly onEdit: (id: string) => void
}) {
  const writes = useMay('deadline.write')
  const now = today()
  const note =
    'Fristen entstehen von selbst aus ihrer Quelle, angelegt wird keine von Hand. Wie viele Tage vorher erinnert wird, gibt die Art vor, unter „Einstellungen“, „Fristen“.'

  if (empty !== null) {
    return (
      <Panel>
        <Empty>
          {empty === 'open'
            ? 'Gerade ist keine Frist offen. Sobald ein Angebot festgeschrieben ist, steht hier seine Wiedervorlage.'
            : 'Hier steht keine Frist.'}
        </Empty>
      </Panel>
    )
  }

  const actions = (deadline: DeadlineView) =>
    writes ? <RowActions deadline={deadline} onEdit={onEdit} /> : null

  return (
    <TablePanel
      caption="Fristen"
      note={note}
      cards={rows.map((deadline) => {
        const href = sourceHref(deadline)

        return {
          key: deadline.id,
          title: href ? (
            <Link to={href} className="text-inherit no-underline hover:underline">
              {sourceName(deadline)}
            </Link>
          ) : (
            sourceName(deadline)
          ),
          sub: [deadline.kindTitle, deadline.customer?.name, deadline.responsible?.name]
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
          <Column className="w-[190px] min-w-[150px]">Kunde</Column>
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
          const href = sourceHref(deadline)

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
                    {sourceName(deadline)}
                  </Link>
                ) : (
                  sourceName(deadline)
                )}
                <span className="block text-[12px] text-ink-faint">{deadline.kindTitle}</span>
              </Cell>
              <Cell>{deadline.customer?.name ?? ''}</Cell>
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
function RowActions({
  deadline,
  onEdit,
}: {
  readonly deadline: DeadlineView
  readonly onEdit: (id: string) => void
}) {
  const queries = useQueryClient()
  const [trouble, setTrouble] = useState<string | null>(null)
  const settle = useMutation({
    mutationFn: () =>
      deadline.status === 'done' ? reopenDeadline(deadline.id) : markDeadlineDone(deadline.id),
    onSuccess: () => {
      setTrouble(null)
      void queries.invalidateQueries({ queryKey: ['deadlines'] })
      void queries.invalidateQueries({ queryKey: ['tasks'] })
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
          aria-label={`Frist zu ${sourceName(deadline)} ändern`}
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

/** The card above the list for one deadline: its own lead, its own person, done. */
function DeadlineCard({
  deadline,
  kind,
  onClose,
}: {
  readonly deadline: DeadlineView
  readonly kind: DeadlineKindView
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const { me, people } = usePeople()
  const [lead, setLead] = useState(
    deadline.ownLeadDays === null ? '' : String(deadline.ownLeadDays),
  )
  const [responsible, setResponsible] = useState(deadline.ownResponsibleUserId ?? '')
  const [trouble, setTrouble] = useState<string | null>(null)

  const typed = lead.trim()
  const leadDays = typed === '' ? null : Number(typed)
  const problem = leadDays === null ? null : leadProblem(leadDays)
  const kindLead = kind.setting.leadDays ?? kind.leadDays
  const words = sourceWords[kind.source]
  const days = Math.round(
    (Date.parse(`${deadline.dueOn}T00:00:00Z`) - Date.parse(`${deadline.anchorOn}T00:00:00Z`)) /
      86_400_000,
  )

  const save = useMutation({
    mutationFn: () =>
      changeDeadline(deadline.id, { leadDays, responsibleUserId: responsible || null }),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['deadlines'] })
      void queries.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Frist ließ sich nicht speichern.'))
    },
  })
  const done = useMutation({
    mutationFn: () => markDeadlineDone(deadline.id),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['deadlines'] })
      void queries.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Frist ließ sich nicht als erledigt markieren.'))
    },
  })

  const options = [
    { value: '', label: `Wie die Art vorgibt: ${defaultResponsibleLabel(kind)}` },
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
          {kind.intervalDays !== null && days > 0
            ? `, ${String(days)} Tage nach ${words.anchor} am ${date(deadline.anchorOn)}`
            : ''}
        </span>
        {deadline.customer ? (
          <span>
            Kunde:{' '}
            <Link to={`/kunden/${deadline.customer.id}`} className="text-copper-text">
              {deadline.customer.name}
            </Link>
          </span>
        ) : null}
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
          hint={`Die Vorgabe der Art: ${defaultResponsibleLabel(kind).replace(/^\S/, (first) => first.toLocaleLowerCase('de'))}.`}
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
          disabled={problem !== null || save.isPending}
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
