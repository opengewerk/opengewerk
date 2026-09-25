import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import {
  Calendar,
  Clock,
  File,
  House,
  RefreshCw,
  Settings,
  SquareCheck,
  TextAlignStart,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useMemo, useReducer, useRef } from 'react'

import { BrandMark, ThemeSwitch } from '../components/index.js'
import { sinceThen } from '../app/format.js'
import { documentStatusOf, taskStatusOf } from '../app/labels.js'
import { accountQuery, useMay } from '../app/queries.js'
import { useTheme } from '../app/theme.js'
import { text } from '../sync/fields.js'
import { useRecords, useSyncStatus } from '../sync/provider.js'
import { useWho } from '../app/who.js'

interface Entry {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
  /** Abgleich and Einstellungen: there when needed, quieter than the work. */
  readonly quiet?: boolean
  /**
   * Further paths that light the entry: the record of a customer lights
   * "Kunden", a board or a circuit "Anlagen", as the boards draw it.
   */
  readonly also?: readonly string[]
  readonly badge?: Badge
}

/**
 * A number beside an entry. Shown as the bare figure, as on the canvas, and
 * read out in words: a figure straight after the label makes the name of the
 * link "Aufgaben3". The words go into the name of the link and start with the
 * label, so a spoken "Aufgaben" still finds it.
 */
interface Badge {
  readonly value: number
  readonly tone: 'waiting' | 'conflict'
  readonly spoken: string
}

interface Group {
  readonly title: string
  readonly entries: readonly Entry[]
}

/**
 * What the office offers, in the groups of the canvas: the records a business
 * keeps, the work it does, and at the foot the two places that are visited
 * rather than worked in.
 *
 * An entry that somebody may not use is left out. A courtesy and not the gate:
 * the routes behind every screen ask the membership on every request.
 */
function useEntries(): { readonly groups: readonly Group[]; readonly foot: readonly Entry[] } {
  const { conflicts } = useSyncStatus()
  const administers = useMay('membership.read')
  const readsSettings = useMay('settings.read')
  // Whoever reads documents reads the texts they are written from.
  const readsDocuments = useMay('document.read')
  const readsTasks = useMay('task.read')
  const readsTime = useMay('time.read')
  const mine = useOpenTasksOfMine()
  const drafts = useRecords('documents').filter(
    (document) => documentStatusOf(document) === 'draft',
  ).length

  const groups: Group[] = [
    {
      title: 'Stammdaten',
      entries: [
        { to: '/', label: 'Kunden', icon: Users, also: ['/kunden'] },
        { to: '/objekte', label: 'Objekte', icon: House },
        {
          to: '/anlagen',
          label: 'Anlagen',
          icon: Zap,
          also: ['/verteiler', '/stromkreise', '/pruefprotokolle'],
        },
        ...(readsDocuments
          ? [{ to: '/textbausteine', label: 'Textbausteine', icon: TextAlignStart }]
          : []),
      ],
    },
    {
      title: 'Arbeit',
      entries: [
        { to: '/auftraege', label: 'Aufträge', icon: Calendar },
        ...(readsDocuments
          ? [
              {
                to: '/belege',
                label: 'Belege',
                icon: File,
                // The drafts, what is written and not yet out, as the canvas
                // counts beside "Belege" in the colour of what waits.
                ...(drafts > 0
                  ? {
                      badge: {
                        value: drafts,
                        tone: 'waiting' as const,
                        spoken: drafts === 1 ? 'ein Entwurf' : `${String(drafts)} Entwürfe`,
                      },
                    }
                  : {}),
              },
            ]
          : []),
        ...(readsTasks
          ? [
              {
                to: '/aufgaben',
                label: 'Aufgaben',
                icon: SquareCheck,
                ...(mine > 0
                  ? {
                      badge: {
                        value: mine,
                        tone: 'waiting' as const,
                        spoken:
                          mine === 1 ? 'eine für dich offen' : `${String(mine)} für dich offen`,
                      },
                    }
                  : {}),
              },
            ]
          : []),
        ...(readsTime ? [{ to: '/zeiten', label: 'Zeiterfassung', icon: Clock }] : []),
      ],
    },
  ]

  const foot: Entry[] = [
    {
      to: '/konflikte',
      label: 'Abgleich',
      icon: RefreshCw,
      quiet: true,
      ...(conflicts.length > 0
        ? {
            badge: {
              value: conflicts.length,
              tone: 'conflict' as const,
              spoken:
                conflicts.length === 1 ? 'ein Konflikt' : `${String(conflicts.length)} Konflikte`,
            },
          }
        : {}),
    },
    ...(readsSettings || administers
      ? [{ to: '/einstellungen', label: 'Einstellungen', icon: Settings, quiet: true }]
      : []),
  ]

  return { groups, foot }
}

/**
 * What waits for the person signed in, as "Deine Aufgaben" on the task screen
 * counts it: open, and theirs. Read from the local store, so the figure is
 * there without a network and moves as soon as a task is done.
 */
function useOpenTasksOfMine(): number {
  const account = useQuery(accountQuery)
  const tasks = useRecords('tasks')
  const me = account.data?.userId

  return useMemo(
    () =>
      me
        ? tasks.filter(
            (task) => taskStatusOf(task) === 'open' && text(task, 'assigneeUserId') === me,
          ).length
        : 0,
    [tasks, me],
  )
}

// Size and indent differ beside the screen and in the drawer, so they are
// left to the caller: two font sizes on one element are decided by the order
// of the stylesheet, not by the order of the classes.
const groupLabel = 'font-condensed font-semibold uppercase tracking-[1.1px] text-ink-faint'

/**
 * One entry, lit on its own path and on the paths below it, and on the paths
 * it names under `also`. `aria-current` goes with it, which is how a screen
 * reader says "you are here".
 */
function EntryLink({
  entry,
  large = false,
  onFollow,
}: {
  readonly entry: Entry
  /** The drawer on a phone: 48 px rows and 16 px type for a thumb. */
  readonly large?: boolean
  readonly onFollow?: () => void
}) {
  const Icon = entry.icon
  const path = useRouterState({ select: (state) => state.location.pathname })
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  // The customer list lives at `/`, and every path starts with that.
  const isActive =
    (entry.to === '/' ? path === '/' : under(entry.to)) || (entry.also ?? []).some(under)
  // The line height of the canvas, Barlow's own: at the 1.45 of running text a
  // row came out 34 px instead of 31, and the list 4 px longer per entry.
  const base = clsx(
    'flex items-center no-underline',
    large
      ? 'gap-3 min-h-12 px-3.5 rounded-[5px] text-[16px]'
      : 'gap-[9px] px-2.5 py-[7px] rounded-control text-[14px] leading-[1.2]',
  )
  // Quiet only beside the screen, where the foot sits apart from the work. In
  // the drawer every entry is a row for a thumb and reads the same.
  const idle = entry.quiet && !large ? 'text-ink-muted' : 'text-ink'

  return (
    <Link
      to={entry.to}
      aria-current={isActive ? 'page' : undefined}
      aria-label={entry.badge ? `${entry.label}, ${entry.badge.spoken}` : undefined}
      // Which entry is lit is worked out above, including the paths under
      // `also`; the router agrees on its own path and adds nothing else.
      activeOptions={{ exact: true, includeSearch: false }}
      className={
        isActive
          ? clsx(base, 'bg-ink text-ground', large ? 'font-semibold' : 'font-medium')
          : clsx(base, idle)
      }
      onClick={onFollow}
    >
      {() => (
        <>
          <Icon size={large ? 20 : 16} strokeWidth={1.9} aria-hidden="true" />
          {entry.label}
          {entry.badge ? (
            <span
              aria-hidden="true"
              className={clsx(
                'ml-auto numeric',
                large ? 'text-[14px] font-bold' : 'text-[12px] font-semibold',
                isActive
                  ? 'text-ground'
                  : entry.badge.tone === 'conflict'
                    ? 'text-conflict'
                    : 'text-waiting',
              )}
            >
              {entry.badge.value}
            </span>
          ) : null}
        </>
      )}
    </Link>
  )
}

/**
 * The state of the outbox, quietly, under "Abgleich". The loud strip above
 * the screen is for when something has to be done; "everything arrived" is
 * not that, and a green bar on every screen was the first thing that looked
 * wrong (#217).
 */
export function SyncNote() {
  const status = useSyncStatus()
  // "vor 2 Minuten" has to move on while nobody touches anything.
  const [, tick] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    const timer = globalThis.setInterval(tick, 60_000)

    return () => {
      globalThis.clearInterval(timer)
    }
  }, [])

  // A conflict has its number beside "Abgleich" and the strip over the page,
  // and the boards draw no line under the entry then.
  if (status.state === 'conflict') {
    return null
  }

  const text =
    status.state === 'refused'
      ? 'Eine Änderung abgelehnt'
      : status.state === 'offline'
        ? status.trouble === null
          ? 'Wird übertragen'
          : 'Keine Verbindung'
        : status.lastSyncedAt
          ? `Abgeglichen, ${sinceThen(status.lastSyncedAt)}`
          : 'Noch nicht abgeglichen'

  return (
    <div
      className={clsx(
        'pl-[35px] pr-2.5 pb-1.5 -mt-[3px] text-[12px] leading-snug',
        // Quiet while everything goes as it should, also while a change is on
        // its way; red only when something needs somebody.
        status.state === 'synced' || (status.state === 'offline' && status.trouble === null)
          ? 'text-ink-faint'
          : 'text-conflict font-semibold',
      )}
    >
      {text}
    </div>
  )
}

/** The navigation beside every office screen, from 1024 px on. */
export function Sidebar() {
  const { groups, foot } = useEntries()

  return (
    <nav
      aria-label="Hauptbereiche"
      className="hidden lg:flex sticky top-[52px] h-[calc(100dvh-52px)] w-[208px] shrink-0 flex-col gap-0.5 overflow-y-auto px-2.5 py-3.5 bg-nav border-r border-line"
    >
      {groups.map((group, index) => (
        <Fragment key={group.title}>
          <div
            className={clsx(
              groupLabel,
              'px-2.5 text-label',
              index === 0 ? 'pt-1.5 pb-1' : 'pt-3.5 pb-1',
            )}
          >
            {group.title}
          </div>
          {group.entries.map((entry) => (
            <EntryLink key={entry.to} entry={entry} />
          ))}
        </Fragment>
      ))}
      <div className="grow" />
      {foot.map((entry) => (
        <Fragment key={entry.to}>
          <EntryLink entry={entry} />
          {entry.to === '/konflikte' ? <SyncNote /> : null}
        </Fragment>
      ))}
    </nav>
  )
}

/**
 * The same navigation below 1024 px, opened from "Menü" in the header, over
 * the screen. It closes when an entry is followed, on Escape and on a tap
 * beside it. Light or dark sits at its foot, because on a phone this is the
 * one place a person looks for settings of the device.
 */
export function Drawer({
  open,
  onClose,
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const { groups, foot } = useEntries()
  const [theme, chooseTheme] = useTheme()
  const who = useWho()
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    close.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Menü" className="fixed inset-0 z-40 lg:hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[rgb(15_20_27/0.45)]"
        onClick={onClose}
      />
      <nav
        aria-label="Hauptbereiche"
        className="absolute inset-y-0 left-0 flex w-[min(320px,calc(100vw-48px))] flex-col bg-nav shadow-[4px_0_24px_rgb(15_20_27/0.25)]"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 pl-3.5 pr-1.5 bg-top text-top-ink">
          <BrandMark />
          <span className="grow text-[16px] font-semibold">OpenGewerk</span>
          <button
            ref={close}
            type="button"
            aria-label="Menü schließen"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-control text-top-ink cursor-pointer"
          >
            <X size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        {who.business ? (
          <div className="mx-3 mt-3 mb-1 flex min-h-12 items-center rounded-[5px] border border-line bg-surface px-3 text-[15px] font-semibold">
            {who.business}
          </div>
        ) : null}
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
          {groups.map((group, index) => (
            <Fragment key={group.title}>
              <div
                className={clsx(
                  groupLabel,
                  'px-3.5 text-[13px]',
                  index === 0 ? 'pt-1 pb-1.5' : 'pt-4 pb-1.5',
                )}
              >
                {group.title}
              </div>
              {group.entries.map((entry) => (
                <EntryLink key={entry.to} entry={entry} large onFollow={onClose} />
              ))}
            </Fragment>
          ))}
          <div aria-hidden="true" className="mx-3.5 my-3 h-px bg-line" />
          {foot.map((entry) => (
            <EntryLink key={entry.to} entry={entry} large onFollow={onClose} />
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-line p-3">
          <div className={clsx(groupLabel, 'text-label')}>Darstellung</div>
          <ThemeSwitch value={theme} onChoose={chooseTheme} large />
        </div>
      </nav>
    </div>
  )
}
