import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronLeft, History, House, Menu, Server, Settings, Shield, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { BrandMark, Shell } from '../../components/index.js'
import { UpdateBar } from '../../app/sync-bar.js'
import { useWho } from '../../app/who.js'
import { PageHead, Screen } from '../kit.js'
import { SettingsText } from '../settings-frame.js'
import { instanceAccessQuery, PersonMenu } from '../top-bar.js'

interface Entry {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
}

/** The screens of the area, `INSTANCE_NAV` of the canvas. */
const entries: readonly Entry[] = [
  { to: '/instanz', label: 'Betriebe', icon: House },
  { to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings },
  { to: '/instanz/betreiber', label: 'Betreiber', icon: Shield },
  { to: '/instanz/protokoll', label: 'Protokoll', icon: History },
]

const groupLabel = 'font-condensed font-semibold uppercase tracking-[1.1px] text-ink-faint'

function EntryLink({
  entry,
  large = false,
  onFollow,
}: {
  readonly entry: Entry
  readonly large?: boolean
  readonly onFollow?: () => void
}) {
  const Icon = entry.icon
  const path = useRouterState({ select: (state) => state.location.pathname })
  // "Betriebe" is the area itself and lights on its own path only.
  const isActive =
    entry.to === '/instanz'
      ? path === '/instanz' || path === '/instanz/'
      : path === entry.to || path.startsWith(`${entry.to}/`)
  const base = clsx(
    'flex items-center no-underline',
    large
      ? 'gap-3 min-h-12 px-3.5 rounded-[5px] text-[16px]'
      : 'gap-[9px] px-2.5 py-[7px] rounded-control text-[14px] leading-[1.2]',
  )

  return (
    <Link
      to={entry.to}
      aria-current={isActive ? 'page' : undefined}
      activeOptions={{ exact: true, includeSearch: false }}
      className={
        isActive
          ? clsx(base, 'bg-ink text-ground', large ? 'font-semibold' : 'font-medium')
          : clsx(base, 'text-ink')
      }
      onClick={onFollow}
    >
      <Icon size={large ? 20 : 16} strokeWidth={1.9} aria-hidden="true" />
      {entry.label}
    </Link>
  )
}

/** The way back into the business this session works in, with its name under it. */
function BackToOffice({ large = false }: { readonly large?: boolean }) {
  const who = useWho()

  return (
    <>
      <Link
        to="/"
        className={clsx(
          'flex items-center no-underline text-ink-muted',
          large
            ? 'gap-3 min-h-12 px-3.5 rounded-[5px] text-[16px]'
            : 'gap-[9px] px-2.5 py-[7px] rounded-control text-[14px] leading-[1.2]',
        )}
      >
        <ChevronLeft size={large ? 20 : 16} strokeWidth={1.9} aria-hidden="true" />
        Zurück zum Büro
      </Link>
      {who.business ? (
        <div
          className={clsx(
            '-mt-[3px] pr-2.5 pb-1.5 text-[12px] text-ink-faint',
            large ? 'pl-[46px]' : 'pl-[35px]',
          )}
        >
          {who.business}
        </div>
      ) : null}
    </>
  )
}

function Sidebar() {
  return (
    <nav
      aria-label="Instanz"
      className="hidden lg:flex sticky top-[52px] h-[calc(100dvh-52px)] w-[208px] shrink-0 flex-col gap-0.5 overflow-y-auto px-2.5 py-3.5 bg-nav border-r border-line"
    >
      <div className={clsx(groupLabel, 'px-2.5 pt-1.5 pb-1 text-label')}>Diese Instanz</div>
      {entries.map((entry) => (
        <EntryLink key={entry.to} entry={entry} />
      ))}
      <div className="grow" />
      <BackToOffice />
    </nav>
  )
}

function Drawer({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
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
        aria-label="Instanz"
        className="absolute inset-y-0 left-0 flex w-[min(320px,calc(100vw-48px))] flex-col bg-nav shadow-[4px_0_24px_rgb(15_20_27/0.25)]"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 pl-3.5 pr-1.5 bg-top text-top-ink">
          <BrandMark />
          <span className="grow text-[16px] font-semibold">Instanz</span>
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
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
          <div className={clsx(groupLabel, 'px-3.5 pt-1 pb-1.5 text-[13px]')}>Diese Instanz</div>
          {entries.map((entry) => (
            <EntryLink key={entry.to} entry={entry} large onFollow={onClose} />
          ))}
          <div aria-hidden="true" className="mx-3.5 my-3 h-px bg-line" />
          <BackToOffice large />
        </div>
      </nav>
    </div>
  )
}

/**
 * The header of the area, `instance_top()` of the canvas: the instance where
 * the office names the business, and no switch of business, because nothing
 * here belongs to one. On a phone "Menü" opens the navigation, as in the
 * office, and the title says where one is.
 */
function InstanceTop({
  menuOpen,
  onMenu,
}: {
  readonly menuOpen: boolean
  readonly onMenu: () => void
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 bg-top px-1.5 text-top-ink lg:h-[52px] lg:gap-5 lg:px-5">
      <button
        type="button"
        aria-expanded={menuOpen}
        onClick={onMenu}
        className="inline-flex h-11 items-center gap-[7px] rounded-control px-2.5 text-[15px] font-semibold text-top-ink cursor-pointer lg:hidden"
      >
        <Menu size={22} strokeWidth={2.1} aria-hidden="true" />
        Menü
      </button>
      <div className="grow lg:hidden" />
      <Link to="/instanz" className="flex items-center gap-[9px] text-top-ink no-underline">
        <BrandMark />
        <span className="text-[16px] font-semibold tracking-[0.2px] max-lg:hidden">OpenGewerk</span>
        <span className="text-[16px] font-semibold lg:hidden">Instanz</span>
      </Link>
      <div aria-hidden="true" className="hidden h-[22px] w-px bg-top-line lg:block" />
      <span className="hidden items-center gap-2 text-[13px] text-top-muted lg:flex">
        <Server size={15} strokeWidth={1.9} aria-hidden="true" />
        Instanz {globalThis.location.host}
      </span>
      <div className="grow" />
      <PersonMenu />
    </header>
  )
}

/** A screen of the area: its head and its cards, `instance_page()` of the canvas. */
export function InstancePage({
  title,
  sub,
  actions,
  fill = false,
  children,
}: {
  readonly title: string
  readonly sub: string
  readonly actions?: ReactNode
  /** As tall as the window, for a list that runs to the foot of the page with its pages there. */
  readonly fill?: boolean
  readonly children: ReactNode
}) {
  return (
    <Screen className={fill ? 'grow lg:gap-[13px]' : 'lg:gap-[13px]'}>
      <PageHead title={title} sub={sub} wideActions {...(actions ? { actions } : {})} />
      {children}
    </Screen>
  )
}

/**
 * Who may not enter, said in the frame of the area rather than with a blank
 * page: somebody who is no operator, and an operator without the second
 * factor the area needs, which is set up under "Konto".
 */
function Door() {
  const access = useQuery(instanceAccessQuery)

  if (access.isPending) {
    return (
      <Screen>
        <SettingsText muted>Wird geladen.</SettingsText>
      </Screen>
    )
  }

  if (access.isError || !access.data.operator) {
    return (
      <InstancePage title="Instanz" sub="Was allen Betrieben auf dieser Instanz gemeinsam ist.">
        <SettingsText>
          {access.isError
            ? 'Ob du diese Instanz betreibst, ließ sich gerade nicht erfragen.'
            : 'Diesen Bereich erreicht nur, wer die Instanz betreibt.'}
        </SettingsText>
      </InstancePage>
    )
  }

  if (!access.data.secondFactor) {
    return (
      <InstancePage title="Instanz" sub="Was allen Betrieben auf dieser Instanz gemeinsam ist.">
        <SettingsText>
          Für diesen Bereich ist ein zweiter Faktor Pflicht, wie für die Rolle Inhaber. Eingerichtet
          wird er unter{' '}
          <Link to="/konto" className="text-copper-text underline underline-offset-2">
            Konto
          </Link>
          .
        </SettingsText>
      </InstancePage>
    )
  }

  return <Outlet />
}

/**
 * The area of the instance (#188), for the people who run it: the
 * businesses on it, what holds for all of them, who runs it, and its log.
 *
 * Not an office of a business, so it has a frame of its own: its own
 * navigation, the instance in the header instead of a business, and at the
 * foot of the navigation the way back into the business this session works
 * in. Nothing here reads what is in a business; the routes behind it could
 * not if they tried.
 */
export function InstanceShell() {
  const [drawer, setDrawer] = useState(false)
  const openDrawer = useCallback(() => {
    setDrawer(true)
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawer(false)
  }, [])

  return (
    <Shell entry="office">
      <div className="flex min-h-dvh flex-col [--sticky-top:3.5rem] lg:[--sticky-top:52px]">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:p-2 focus:bg-surface focus:border focus:border-line-strong focus:rounded-control"
        >
          Zum Inhalt springen
        </a>

        <InstanceTop menuOpen={drawer} onMenu={openDrawer} />
        <UpdateBar />

        <div className="flex flex-1">
          <Sidebar />
          <main id="inhalt" className="flex min-w-0 flex-1 flex-col">
            <Door />
          </main>
        </div>

        <Drawer open={drawer} onClose={closeDrawer} />
      </div>
    </Shell>
  )
}
