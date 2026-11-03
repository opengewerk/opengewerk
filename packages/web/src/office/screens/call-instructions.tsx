import { Button, Panel } from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import {
  maybeText,
  RequestRefused,
  text,
  useRecord,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Eye, Mail, Signature, X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { useMay } from '../../app/queries.js'
import { UrgentRepairNote, useConsumerCall, useEarlyStarts } from '../../app/service-calls.js'
import {
  type CallMail,
  callInstructions,
  callInstructionsAddress,
  callInstructionsKey,
  sendCallInstructions,
} from '../../session/service-calls.js'

/**
 * The instructions of a service call in the office (#292), the card
 * "Belehrungen" of the board "Serviceeinsatz mit Belehrungen": for a consumer
 * without a quote, by mail for a call taken on the phone and to print, with
 * what went out and what was signed at the door. The mark of an urgent repair
 * stands in it, with what it means.
 */

const link =
  'inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap'

function Entry({
  icon,
  tone,
  title,
  meta,
  action,
}: {
  readonly icon: ReactNode
  readonly tone: string
  readonly title: string
  readonly meta: string
  readonly action?: ReactNode
}) {
  return (
    <li className="flex items-start gap-2.5 border-b border-row py-2 last:border-b-0">
      <span className={`mt-0.5 ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">{meta}</p>
      </div>
      {action}
    </li>
  )
}

function mailTitle(mail: CallMail): string {
  const what = mail.withRequest ? 'Mit dem Verlangen von der Tür per E-Mail' : 'Per E-Mail'

  return mail.status === 'sent'
    ? `${what} verschickt`
    : mail.status === 'pending'
      ? `${what}, wartet auf den Versand`
      : `${what}, nicht zugestellt`
}

function mailMeta(mail: CallMail): string {
  const when = moment(mail.sentAt ?? mail.createdAt)

  return [
    `an ${mail.to}, ${when}`,
    mail.requestedBy ? `von ${mail.requestedBy}` : null,
    mail.status === 'failed' && mail.lastError ? mail.lastError : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
}

export function CallInstructionsSection({ jobId }: { readonly jobId: string }) {
  const job = useRecord('jobs', jobId)
  const { applies, customer } = useConsumerCall(job)
  const sends = useMay('job.write')
  const { online } = useSyncStatus()
  const queries = useQueryClient()
  const requests = useEarlyStarts(jobId)
  const facts = useQuery({
    queryKey: callInstructionsKey(jobId),
    queryFn: () => callInstructions(jobId),
    enabled: applies === true && online,
    retry: false,
  })
  const [sending, setSending] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (applies !== true || !job) {
    return null
  }

  async function send() {
    setSending(true)
    setTrouble(null)

    try {
      await sendCallInstructions(jobId, null)
      await queries.invalidateQueries({ queryKey: callInstructionsKey(jobId) })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Das ging nicht. Die Belehrungen sind nicht verschickt.',
      )
    } finally {
      setSending(false)
    }
  }

  const gaps = facts.data?.gaps ?? []
  const mails = facts.data?.mails ?? []
  const name = customer ? text(customer, 'name') : 'Der Kunde'

  return (
    <Panel
      title="Belehrungen"
      action={
        <div className="flex flex-wrap gap-1.5">
          {online ? (
            <a
              href={callInstructionsAddress(jobId)}
              target="_blank"
              rel="noopener noreferrer"
              className={link}
            >
              <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
              Ansehen
            </a>
          ) : (
            <span className={`${link} text-ink-faint`} aria-disabled="true">
              <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
              Ansehen
            </span>
          )}
          {sends ? (
            <Button
              icon={Mail}
              disabled={!online || sending || gaps.length > 0}
              onClick={() => {
                void send()
              }}
            >
              Per E-Mail senden
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-[1.45] text-ink-muted">
          {`${name} ist Verbraucher. Widerrufsbelehrung, Hinweise zum Erlöschen, Muster-Widerrufsformular und der Vordruck für den vorzeitigen Beginn, in der Fassung des Betriebs.`}
        </p>

        {job['urgentRepair'] === true ? <UrgentRepairNote /> : null}

        {gaps.length > 0 ? (
          <p role="status" className="text-[13px] leading-[1.45] text-conflict">
            {gaps.join(' ')}
          </p>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {mails.length === 0 && requests.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            {customer && !maybeText(customer, 'email')
              ? 'Noch nichts verschickt. Für den Kunden ist keine E-Mail-Adresse hinterlegt; dann die Belehrungen ausdrucken und übergeben.'
              : 'Noch nichts verschickt und an der Tür nichts unterschrieben.'}
          </p>
        ) : (
          <ul aria-label="Verlauf" className="flex flex-col">
            {mails.map((mail) => (
              <Entry
                key={mail.id}
                icon={
                  mail.status === 'sent' ? (
                    <Check size={16} strokeWidth={2.2} aria-hidden="true" />
                  ) : mail.status === 'pending' ? (
                    <Clock size={16} strokeWidth={2.2} aria-hidden="true" />
                  ) : (
                    <X size={16} strokeWidth={2.2} aria-hidden="true" />
                  )
                }
                tone={
                  mail.status === 'sent'
                    ? 'text-done'
                    : mail.status === 'pending'
                      ? 'text-waiting'
                      : 'text-conflict'
                }
                title={mailTitle(mail)}
                meta={mailMeta(mail)}
              />
            ))}
            {requests.map((request) => (
              <Entry
                key={String(request['id'])}
                icon={<Signature size={16} strokeWidth={2.2} aria-hidden="true" />}
                tone="text-done"
                title="Vorzeitigen Beginn verlangt, an der Tür unterschrieben"
                meta={`${text(request, 'signerName')}, ${moment(maybeText(request, 'signedAt'))} Uhr`}
                action={
                  online ? (
                    <a
                      href={callInstructionsAddress(jobId, String(request['id']))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-copper-text underline underline-offset-2"
                    >
                      PDF
                    </a>
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
