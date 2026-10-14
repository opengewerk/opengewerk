import { legalTextKinds, type LegalTexts } from '@opengewerk/platform-domain'
import clsx from 'clsx'
import { Lock, LockOpen } from 'lucide-react'
import { createContext, useContext, useId } from 'react'
import type { ReactNode } from 'react'

import { useApplication } from '../application.js'
import { BrandMark } from '../components/brand-mark.js'
import { GateProvider } from '../components/gate.js'
import { legalAddress } from '../session/session.js'

/**
 * The frame of every step before working, as the boards of the page "Vor der
 * Anmeldung" draw it (#219): at a desk the brand on slate at the left and the
 * form at the right, under the address this instance answers at; on a phone
 * the brand as a slate head over the form. One card, one heading, one action.
 *
 * `<main>` and an `<h1>`, because this is the first thing a screen reader
 * meets, and an application that starts with an unlabelled div starts badly.
 * Fields and buttons inside take the sizes of the gate (`GateProvider`),
 * which are neither those of the office nor those of the site: the gate comes
 * before either and serves both.
 */
export function Gate({
  title,
  width = 560,
  before,
  children,
}: {
  readonly title: string
  /** The width of the card: 560, or wider for a choice side by side or a code to scan. */
  readonly width?: 560 | 600 | 640
  /**
   * A line above the card, as the board "Nach dem Scan im Browser, nicht
   * angemeldet" draws it: what happens once this is done (#308).
   */
  readonly before?: ReactNode
  readonly children: ReactNode
}) {
  const headingId = useId()
  const application = useApplication()

  return (
    <GateProvider value={true}>
      <div className="flex min-h-dvh flex-col bg-ground text-ink lg:flex-row">
        <Brand />

        <header className="bg-gate px-5 pt-[22px] pb-[18px] text-top-ink lg:hidden">
          <div className="flex items-center gap-[11px]">
            <BrandMark size={32} />
            <span className="text-[22px] font-semibold">{application.name}</span>
          </div>
          <Connected onSlate className="mt-3" />
        </header>

        <main className="flex min-w-0 grow flex-col gap-4 px-4 py-[18px] lg:gap-[22px] lg:px-14 lg:py-11">
          <Connected className="hidden lg:flex" />
          {before}
          <section
            aria-labelledby={headingId}
            className={clsx(
              'w-full rounded-[6px] border border-line bg-surface px-[18px] py-[22px] lg:px-7 lg:py-[26px]',
              width === 640 ? 'max-w-[640px]' : width === 600 ? 'max-w-[600px]' : 'max-w-[560px]',
            )}
          >
            <h1 id={headingId} className="text-[24px] leading-[1.25] font-semibold">
              {title}
            </h1>
            <div className="mt-5 flex flex-col gap-[15px]">{children}</div>
          </section>
        </main>

        <GateFoot className="justify-center px-4 pt-3 pb-4 text-[14px] text-ink-faint lg:hidden" />
      </div>
    </GateProvider>
  )
}

/**
 * The version this installation runs, for the foot of the brand (#259). Handed
 * in by `Boot`, which asks the server once; a gate without it, a checkout or
 * a server that did not answer, shows the licence alone.
 */
export const InstanceVersion = createContext<string | null>(null)

/**
 * The legal texts of the instance (opengewerk-haustechnik#129), for the links
 * in the foot. Handed in by `Boot`, which asks the server once, as for the
 * version; a gate without them shows no link, as for a text nobody keeps.
 */
export const InstanceLegalTexts = createContext<LegalTexts | null>(null)

/**
 * The brand at a desk: the mark, what the application is in one sentence,
 * where it runs in another, and under a line the foot. The
 * words are the application's (ADR 0010); the foundation has no product to
 * name and no claim to make for one.
 */
function Brand() {
  const application = useApplication()

  return (
    <aside className="hidden w-[470px] shrink-0 flex-col bg-gate px-10 py-11 text-top-ink lg:flex">
      <div className="flex items-center gap-[13px]">
        <BrandMark size={42} />
        <span className="text-[27px] font-semibold tracking-[0.2px]">{application.name}</span>
      </div>
      <div className="flex grow flex-col justify-center">
        <p className="text-[24px] leading-[1.4] font-medium">{application.claim}</p>
        <p className="mt-5 text-[16px] leading-[1.55] text-gate-text">{application.hosting}</p>
      </div>
      {/* The board drew a way to the help as well. There is none before
          phase 2, and a link into nothing would be worse than none (#259). */}
      <GateFoot onSlate className="border-t border-gate-line pt-5 text-[13px] text-gate-faint" />
    </aside>
  )
}

/** The names of the legal texts in the foot, shorter than the headings of their page. */
const footLabels = { imprint: 'Impressum', privacy: 'Datenschutz' } as const

/**
 * The foot of every step before working: the licence and the version, and the
 * legal texts of the instance (opengewerk-haustechnik#129). A link only for a
 * text that is kept: one into an empty page would be worse than none. They
 * lead to the page of the texts, which `Boot` shows by its address, before
 * anybody is asked who they are.
 *
 * At a desk under the brand on slate, on a phone under the card.
 */
export function GateFoot({
  onSlate = false,
  className,
}: {
  readonly onSlate?: boolean
  readonly className?: string
}) {
  const version = useContext(InstanceVersion)
  const texts = useContext(InstanceLegalTexts)
  const application = useApplication()

  return (
    <footer className={clsx('flex flex-wrap gap-x-3.5 gap-y-1', className)}>
      <span>{version ? `${application.licence} · Version ${version}` : application.licence}</span>
      {legalTextKinds.map((kind) =>
        texts?.[kind] ? (
          <a
            key={kind}
            href={legalAddress(kind)}
            className={clsx(
              'underline underline-offset-2',
              // On slate in the grey of its text, on the ground in copper, as
              // the boards of the page "Vor der Anmeldung" draw both.
              onSlate ? 'text-gate-text' : 'text-copper-text',
            )}
          >
            {footLabels[kind]}
          </a>
        ) : null,
      )}
    </footer>
  )
}

/**
 * The address this page came from, which is the server that gets the
 * password. With the lock only where the connection is encrypted: a lock over
 * a plain connection, on a test machine, would be the one false statement on
 * a screen that asks for a password.
 */
function Connected({
  onSlate = false,
  className,
}: {
  readonly onSlate?: boolean
  readonly className?: string
}) {
  const secure = globalThis.location.protocol === 'https:'
  const Icon = secure ? Lock : LockOpen

  return (
    <p
      className={clsx(
        'flex flex-wrap items-center gap-x-2',
        onSlate ? 'text-[14px] text-gate-text' : 'text-[13px] text-ink-muted',
        className,
      )}
    >
      <Icon
        size={15}
        strokeWidth={2.2}
        aria-hidden="true"
        className={clsx(
          'shrink-0',
          secure
            ? onSlate
              ? 'text-gate-lock'
              : 'text-done'
            : onSlate
              ? 'text-gate-faint'
              : 'text-ink-faint',
        )}
      />
      <span>{secure ? 'Verbunden mit' : 'Unverschlüsselt verbunden mit'}</span>
      <code
        className={clsx(
          'font-semibold [overflow-wrap:anywhere]',
          onSlate ? 'text-top-ink' : 'text-[13px] text-ink',
        )}
      >
        {globalThis.location.host}
      </code>
    </p>
  )
}

/** A sentence in the card, `para()` of the boards: muted, unless it is what the card says. */
export function GateText({
  muted = true,
  children,
}: {
  readonly muted?: boolean
  readonly children: ReactNode
}) {
  return (
    <p
      className={clsx(
        'text-[15px] leading-[1.5] lg:text-[14px]',
        muted ? 'text-ink-muted' : 'text-ink',
      )}
    >
      {children}
    </p>
  )
}

/** "Einen Moment", the board "Tor-Moment": the circle that turns and what is being waited for. */
export function GateWaiting({ children }: { readonly children: ReactNode }) {
  return (
    <Gate title="Einen Moment">
      <div role="status" className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="size-[34px] shrink-0 rounded-full border-4 border-surface-sunken border-t-copper motion-safe:animate-spin"
        />
        <p className="text-[16px] leading-[1.5] text-ink lg:text-[15px]">{children}</p>
      </div>
    </Gate>
  )
}
