import clsx from 'clsx'
import { Lock, Pencil } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useId } from 'react'
import type { ReactNode } from 'react'

/**
 * The frames a document stands in on its screen, as the boards "Angebot,
 * Entwurf" and "Schlussrechnung, festgeschrieben" draw them (#219): the
 * difference between a draft and a fixed document is the most consequential
 * fact on the page, and the frame says it before a single figure is read.
 */

/** Inside a frame: 14 by 16 pixels of room, the cards 12 apart. */
function FrameBody({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 sm:py-3.5">{children}</div>
}

/**
 * A draft: a dashed frame in the colour of waiting, and over its content the
 * kind and the sentence that it has no number yet, `doc_head_draft()` of the
 * canvas.
 */
export function DraftFrame({
  kind,
  children,
}: {
  /** "Angebot", "Schlussrechnung": the head says "Angebot, Entwurf". */
  readonly kind: string
  readonly children: ReactNode
}) {
  return (
    <section
      aria-label={`${kind}, Entwurf`}
      className="min-w-0 overflow-hidden rounded-[6px] border border-dashed border-waiting-edge bg-surface [--surface-here:var(--color-surface)]"
    >
      <div className="flex items-center gap-[11px] border-b border-dashed border-waiting-edge bg-waiting-fill px-4 py-[11px] text-waiting">
        <Pencil size={18} strokeWidth={2} aria-hidden="true" className="shrink-0" />
        <div className="min-w-0 grow">
          <p className="text-[16px] font-semibold">{`${kind}, Entwurf`}</p>
          <p className="text-[12px]">
            Noch keine Nummer vergeben. Festschreiben vergibt sie, danach ist der Beleg
            unveränderlich.
          </p>
        </div>
      </div>
      <FrameBody>{children}</FrameBody>
    </section>
  )
}

/**
 * A fixed document: a slate frame under a slate head with the number, when it
 * was fixed, and a copper chip, `doc_head_fixed()` of the canvas. The chip
 * says "FEST", or "STORNIERT" once a cancellation has taken it back.
 */
export function FixedFrame({
  number,
  sub,
  chip,
  children,
}: {
  readonly number: string
  readonly sub: string
  readonly chip: string
  readonly children: ReactNode
}) {
  return (
    <section
      aria-label={number}
      className="min-w-0 overflow-hidden rounded-[6px] border border-fixed-edge bg-surface [--surface-here:var(--color-surface)]"
    >
      <div className="flex items-center gap-[11px] bg-top px-4 py-[11px] text-top-ink">
        <Lock
          size={18}
          strokeWidth={2.2}
          aria-hidden="true"
          className="shrink-0 text-fixed-accent"
        />
        <div className="min-w-0 grow">
          <p className="numeric text-[16px] font-semibold [overflow-wrap:anywhere]">{number}</p>
          <p className="numeric text-[12px] text-top-muted">{sub}</p>
        </div>
        <span className="shrink-0 rounded-[3px] bg-fixed-accent px-2 py-[3px] font-condensed text-[13px] font-semibold tracking-[0.8px] text-on-fixed-accent">
          {chip}
        </span>
      </div>
      <FrameBody>{children}</FrameBody>
    </section>
  )
}

/**
 * The second step of something that cannot be undone, "Festschreiben" on its
 * board: a card with a strong edge, a heading with a symbol, the sentences
 * that say what follows, and the buttons under a line. Copper for issuing,
 * red for cancelling.
 */
export function StepPanel({
  title,
  icon: Icon,
  tone,
  actions,
  after,
  children,
}: {
  readonly title: string
  readonly icon: LucideIcon
  readonly tone: 'copper' | 'danger'
  /** Under a line: the action, then the way out. */
  readonly actions: ReactNode
  /** Under the buttons, where the board puts what is still missing. */
  readonly after?: ReactNode
  readonly children: ReactNode
}) {
  const heading = useId()

  return (
    <section
      aria-labelledby={heading}
      className={clsx(
        'flex min-w-0 flex-col gap-3 rounded-[6px] border-2 bg-surface px-4 py-3.5 sm:px-[18px] sm:py-4',
        '[--surface-here:var(--color-surface)]',
        tone === 'copper' ? 'border-copper-solid' : 'border-conflict',
      )}
    >
      <h2 id={heading} className="flex items-center gap-[9px] text-[17px] font-semibold">
        <Icon
          size={18}
          strokeWidth={2.2}
          aria-hidden="true"
          className={clsx('shrink-0', tone === 'copper' ? 'text-copper-solid' : 'text-conflict')}
        />
        {title}
      </h2>
      {children}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">{actions}</div>
      {after}
    </section>
  )
}

/** A sentence in a step, at the size the board sets them. */
export function StepText({
  muted = false,
  children,
}: {
  readonly muted?: boolean
  readonly children: ReactNode
}) {
  return (
    <p className={clsx('text-[14px] leading-[1.5]', muted ? 'text-ink-muted' : 'text-ink')}>
      {children}
    </p>
  )
}
