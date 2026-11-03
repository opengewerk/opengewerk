import { acceptanceResults, yearsText } from '@opengewerk/domain'
import { Button, Field, Panel, Status } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { text, useSync, useSyncStatus } from '@opengewerk/platform-web/sync'
import { Link, useNavigate } from '@tanstack/react-router'
import { Eye, Plus, Signature } from 'lucide-react'
import { useState } from 'react'

import {
  startAcceptance,
  useAcceptances,
  useJobStructure,
  warrantyOf,
} from '../../app/acceptance.js'
import { valuesOf } from '../../app/protocols.js'
import { useMay } from '../../app/queries.js'

/** How the card names what came of an acceptance. */
const resultLabel: Readonly<Record<(typeof acceptanceResults)[number], string>> = {
  accepted: 'Abgenommen',
  accepted_with_reservations: 'Abgenommen mit Vorbehalten',
  refused: 'Abnahme verweigert',
}

const link =
  'inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap'

/** "Gewährleistung bis 05.11.2031: fünf Jahre ab der Abnahme (§ 634a Abs. 1 Nr. 2 BGB)." */
export function warrantySentence(warranty: ReturnType<typeof warrantyOf>): string | null {
  if (warranty === null) {
    return null
  }

  if (warranty.acceptance.result === 'refused') {
    return 'Die Abnahme ist verweigert, die Gewährleistung beginnt nicht.'
  }

  if (warranty.terms === null) {
    return null
  }

  const { whole, parts } = warranty.terms

  return `Gewährleistung bis ${date(whole.endsOn)}: ${yearsText(whole.years)} ab der Abnahme (${whole.source}).${
    parts
      ? ` Für wartungsbedürftige Teile ohne übertragene Wartung bis ${date(parts.endsOn)} (${parts.source}).`
      : ''
  } Die Frist dazu steht unter „Fristen“.`
}

/** Where the request to accept a job is printed (#310). */
export function acceptanceRequestAddress(jobId: string, until: string): string {
  return `/jobs/${encodeURIComponent(jobId)}/acceptance-request?until=${encodeURIComponent(until)}`
}

/**
 * The card "Abnahme" of a job (#310), as the board "Auftrag mit Abnahme"
 * draws it: its acceptances, the warranty that runs from the last signed one,
 * a new protocol, and the request to accept within a deadline.
 */
export function AcceptanceSection({ jobId }: { readonly jobId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const { online } = useSyncStatus()
  const writes = useMay('installation.write')
  const acceptances = useAcceptances(jobId)
  const structure = useJobStructure(jobId)
  const warranty = warrantySentence(warrantyOf(acceptances))
  const [until, setUntil] = useState('')

  return (
    <Panel title="Abnahme">
      <div className="flex flex-col gap-2.5">
        {acceptances.length > 0 ? (
          <ul className="flex flex-col">
            {acceptances.map((record) => {
              const result = valuesOf(record)['result']
              const signed = text(record, 'status') === 'signed'

              return (
                <li
                  key={String(record['id'])}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-row py-2 last:border-b-0"
                >
                  <Link
                    to={`/pruefprotokolle/${String(record['id'])}`}
                    className="text-body font-medium text-copper-text underline underline-offset-2"
                  >
                    Abnahmeprotokoll
                  </Link>
                  {typeof result === 'string' && result in resultLabel ? (
                    <span className="text-[13px] text-ink-muted">
                      {resultLabel[result as keyof typeof resultLabel]}
                    </span>
                  ) : null}
                  <span className="flex-grow" />
                  <span className="text-[13px] text-ink-faint">
                    {date(text(record, 'performedOn'))}
                  </span>
                  {signed ? (
                    <Status tone="done" icon={Signature}>
                      Unterschrieben
                    </Status>
                  ) : (
                    <Status tone="draft">Entwurf</Status>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Noch keine Abnahme. Mit ihrem Tag beginnt die Gewährleistung (§ 634a Abs. 2 BGB).
          </p>
        )}
        {warranty ? <p className="text-[13px] leading-[1.4] text-ink-muted">{warranty}</p> : null}
        {writes ? (
          <div>
            <Button
              icon={Plus}
              onClick={() => {
                void startAcceptance(client, { jobId, structure }).then((made) => {
                  if (made.outcome === 'queued') {
                    void navigate({ to: `/pruefprotokolle/${made.id}` })
                  }
                })
              }}
            >
              Abnahmeprotokoll anlegen
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-[180px]">
            <Field
              label="Abnehmen bis"
              type="date"
              min={today()}
              value={until}
              onChange={(event) => {
                setUntil(event.target.value)
              }}
            />
          </div>
          {online && until !== '' && until >= today() ? (
            <a
              href={acceptanceRequestAddress(jobId, until)}
              target="_blank"
              rel="noopener noreferrer"
              className={link}
            >
              <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
              Aufforderung zur Abnahme
            </a>
          ) : (
            <span className={`${link} text-ink-faint`} aria-disabled="true">
              <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
              Aufforderung zur Abnahme
            </span>
          )}
        </div>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Die Aufforderung setzt eine Frist (§ 640 Abs. 2 BGB). Einer privaten Kundin sagt sie, dass
          die Abnahme als erklärt gilt, wenn sie nicht bis dahin unter Angabe eines Mangels
          verweigert wird.
        </p>
      </div>
    </Panel>
  )
}
