import { type LegalTextKind, legalTextKinds } from '@opengewerk/platform-domain'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'

import { useApplication } from '../application.js'
import { BrandMark } from '../components/brand-mark.js'
import { Markdown } from '../components/markdown.js'
import { legalTextsQuery } from '../session/queries.js'
import { legalAddress } from '../session/session.js'
import { GateFoot } from './frame.js'

/** The names of the legal texts over their text. */
const tabLabels = { imprint: 'Impressum', privacy: 'Datenschutzhinweise' } as const

/**
 * The legal texts of the instance (opengewerk-haustechnik#129), the board
 * "Rechtstexte der Instanz" of the page "Vor der Anmeldung": its legal notice
 * and its notice on data protection, as whoever runs the instance keeps them,
 * for anybody and before signing in.
 *
 * Shown by `Boot` at its address and before anybody is asked who they are,
 * as the screen of an invitation is: whoever wants to know who runs an
 * instance should not have to sign in to it first. Nothing of the instance
 * comes with it but the two texts.
 *
 * A text is read into elements and never into HTML, with the lines of a
 * paragraph as they were typed (`Markdown`). A tab only for a text that is
 * kept, as in the foot.
 */
export function LegalScreen({ page }: { readonly page: LegalTextKind }) {
  const application = useApplication()
  const sentences = application.sentences.legal
  const texts = useQuery(legalTextsQuery)
  const kept = legalTextKinds.filter((kind) => texts.data?.[kind])
  const text = texts.data?.[page] ?? null

  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink">
      <header className="flex h-[52px] shrink-0 items-center gap-[9px] bg-gate px-4 text-top-ink lg:px-5">
        <BrandMark size={22} />
        <span className="text-[16px] font-semibold">{application.name}</span>
        <div className="grow" />
        <a href="/" className="text-[13px] text-top-muted underline underline-offset-2">
          Zur Anmeldung
        </a>
      </header>

      <main className="flex grow justify-center px-4 py-6 lg:py-8">
        <div className="flex w-full max-w-[720px] min-w-0 flex-col gap-[18px]">
          <h1 className="text-[26px] leading-[1.25] font-semibold">Rechtliches</h1>
          {kept.length > 0 ? (
            <nav aria-label="Rechtstexte" className="flex gap-[22px] border-b border-line">
              {kept.map((kind) => (
                <a
                  key={kind}
                  href={legalAddress(kind)}
                  aria-current={kind === page ? 'page' : undefined}
                  className={clsx(
                    'border-b-2 px-0.5 py-2 text-[14px] no-underline',
                    kind === page
                      ? 'border-copper font-semibold text-ink'
                      : 'border-transparent text-ink-muted',
                  )}
                >
                  {tabLabels[kind]}
                </a>
              ))}
            </nav>
          ) : null}
          {texts.isPending ? (
            <p className="text-[15px] text-ink-muted">Wird geladen.</p>
          ) : texts.isError ? (
            <p className="text-[15px] text-ink-muted">
              Die Rechtstexte kamen nicht an. Ohne Verbindung zum Server sind sie nicht zu lesen.
            </p>
          ) : text === null ? (
            <p className="text-[15px] text-ink-muted">{sentences.missing}</p>
          ) : (
            <article className="[overflow-wrap:anywhere]">
              <Markdown source={text} reading breaks level={2} />
            </article>
          )}
          <p className="rounded-[5px] border border-line bg-surface-sunken px-3.5 py-2.5 text-[13px] text-ink-muted">
            {sentences.keptBy}
          </p>
        </div>
      </main>

      <GateFoot className="border-t border-line px-4 py-3 text-[13px] text-ink-faint lg:px-5" />
    </div>
  )
}
