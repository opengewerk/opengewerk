import { Link } from '@tanstack/react-router'
import { ChevronDown, Menu, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { BrandMark, ThemeSwitch } from '../components/index.js'
import { SignOutButton } from '../app/sign-out.js'
import { useTheme } from '../app/theme.js'
import { useSync } from '../sync/provider.js'
import { useWho } from './who.js'

/**
 * The header of every office screen, in slate, as on the canvas: the mark,
 * the business this session works in, and the person with their menu.
 *
 * Below 1024 px it becomes the header of a phone: "Menü" on the left opens the
 * navigation as a drawer, the mark sits in the middle, the person on the
 * right. Sticky, so the way to everything else stays where it is while a long
 * list scrolls.
 */
export function TopBar({
  menuOpen,
  onMenu,
}: {
  readonly menuOpen: boolean
  readonly onMenu: () => void
}) {
  const who = useWho()

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
      <Link to="/" className="flex items-center gap-[9px] text-top-ink no-underline">
        <BrandMark />
        <span className="text-[16px] font-semibold tracking-[0.2px]">OpenGewerk</span>
      </Link>
      <div aria-hidden="true" className="hidden h-[22px] w-px bg-top-line lg:block" />
      {who.business ? (
        <span className="hidden px-2 text-[13px] text-top-muted lg:inline">{who.business}</span>
      ) : null}
      <div className="grow" />
      <PersonMenu />
    </header>
  )
}

/**
 * The person, and behind them what belongs to them rather than to the
 * business: light or dark on this device, the account, signing out.
 *
 * A button that opens a panel, not an ARIA menu: the panel holds a switch and
 * links, and a menu role would promise arrow keys over them that a plain list
 * of controls does not need. It closes on Escape, on a click outside and when
 * one of its links is followed.
 */
function PersonMenu() {
  const who = useWho()
  const client = useSync()
  const [theme, chooseTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointer = (event: PointerEvent) => {
      if (frame.current && !frame.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={frame} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={who.name ? `${who.name}, Konto und Darstellung` : 'Konto und Darstellung'}
        onClick={() => {
          setOpen((was) => !was)
        }}
        className="flex h-11 items-center gap-2 rounded-control px-1.5 text-[13px] text-top-muted cursor-pointer"
      >
        <span
          aria-hidden="true"
          className="flex size-[26px] items-center justify-center rounded-full bg-copper-solid text-[12px] font-semibold text-on-copper"
        >
          {who.initials}
        </span>
        <span className="hidden lg:inline">{who.name}</span>
        <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" className="hidden lg:block" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 flex w-[264px] flex-col gap-1.5 rounded-[6px] border border-line bg-surface p-2.5 text-ink shadow-[0_8px_24px_rgb(20_26_35/0.18)]">
          <div className="border-b border-line px-1.5 pt-1 pb-2">
            <div className="text-[14px] font-semibold">{who.name}</div>
            <div className="text-[13px] text-ink-faint">
              {who.roles ? `${who.email} · ${who.roles}` : who.email}
            </div>
          </div>
          <div className="px-1.5 pt-1 font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint">
            Darstellung
          </div>
          <div className="px-1 pb-1">
            <ThemeSwitch value={theme} onChoose={chooseTheme} />
          </div>
          <div aria-hidden="true" className="my-0.5 h-px bg-line" />
          <Link
            to="/konto"
            onClick={() => {
              setOpen(false)
            }}
            className="flex items-center gap-[9px] rounded-control px-3 py-2 text-[14px] leading-[1.2] text-ink no-underline hover:bg-surface-sunken"
          >
            <User size={16} strokeWidth={1.9} aria-hidden="true" />
            Konto
          </Link>
          <SignOutButton
            client={client}
            row
            onSignedOut={() => {
              // As under "Konto": signing out ends with the sync client stopped
              // and the local store gone, and reloading is the shortest honest
              // way to be sure of that.
              globalThis.location.assign('/')
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
