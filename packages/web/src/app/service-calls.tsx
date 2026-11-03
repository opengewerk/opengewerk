import { instructionBlocks, type RecordState, urgentRepairNote } from '@opengewerk/domain'
import { maybeText, text, useRecord, useRelated } from '@opengewerk/platform-web/sync'
import clsx from 'clsx'
import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'

import { jobKindOf } from './labels.js'

/**
 * What the office and the site share about a service call (#292): the mark
 * of an urgent repair, whether a job gets instructions, the requests for an
 * early start signed at its door, and the words of an instruction.
 */

/** The heading of the mark, the same in the office and on site. */
export const urgentRepairTitle = 'Dringende Reparatur, vom Kunden ausdrücklich angefordert'

/**
 * Whether a job gets the instructions of a service call: a service call for
 * a customer who is not a business, as `jobInstructionsRefusal` has it on the
 * server. Undefined while the customer is not on this device.
 */
export function useConsumerCall(job: RecordState | null): {
  readonly applies: boolean | undefined
  readonly customer: RecordState | null
} {
  const customer = useRecord('customers', job ? String(job['customerId']) : undefined)

  if (!job) {
    return { applies: false, customer: null }
  }

  if (jobKindOf(job) !== 'service') {
    return { applies: false, customer }
  }

  return { applies: customer ? customer['isBusiness'] !== true : undefined, customer }
}

/** The requests for an early start signed at the door of a job, the oldest first. */
export function useEarlyStarts(jobId: string): readonly RecordState[] {
  const records = useRelated('early_start_requests', 'jobId', jobId)

  return useMemo(
    () =>
      records
        .filter((record) => !record['deletedAt'])
        .sort((left, right) =>
          (maybeText(left, 'signedAt') ?? '').localeCompare(maybeText(right, 'signedAt') ?? ''),
        ),
    [records],
  )
}

/** Who signed a request, as a line says it. */
export function signerOf(request: RecordState): string {
  return text(request, 'signerName')
}

/** The mark of an urgent repair with what it means, a box at the size of where it stands. */
export function UrgentRepairNote({ site = false }: { readonly site?: boolean }) {
  return (
    <div
      className={clsx(
        'flex gap-2.5 rounded-[6px] border border-l-4 border-waiting-edge border-l-waiting bg-waiting-fill',
        site ? 'px-3.5 py-3 text-[16px] leading-[1.45]' : 'px-3 py-2.5 text-body leading-[1.45]',
      )}
    >
      <TriangleAlert
        size={site ? 20 : 18}
        strokeWidth={2.2}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-waiting"
      />
      <p>
        <b className="font-semibold">{`${urgentRepairTitle}.`}</b> {urgentRepairNote}
      </p>
    </div>
  )
}

/**
 * The words of an instruction the way they are printed: headings, paragraphs,
 * points and lines to write on. In the office and on site, each at its size.
 */
export function InstructionText({
  text: words,
  className,
}: {
  readonly text: string
  readonly className?: string
}) {
  return (
    <div className={clsx('flex flex-col gap-2', className ?? 'text-body')}>
      {instructionBlocks(words).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h3 key={index} className="mt-2 font-semibold">
                {block.text}
              </h3>
            )
          case 'item':
            return (
              <p key={index} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span className="whitespace-pre-line">{block.text}</span>
              </p>
            )
          case 'line':
            return <div key={index} className="h-5 border-b border-line-strong" />
          case 'paragraph':
            return (
              <p key={index} className="whitespace-pre-line [overflow-wrap:anywhere]">
                {block.text}
              </p>
            )
        }
      })}
    </div>
  )
}
