import {
  type CustomerId,
  type DocumentId,
  type DocumentKind,
  type DocumentStatus,
  type IsoDate,
  type JobId,
  type JobStatus,
  type PipelineDeal,
  type PipelineDocument,
  type PipelineJob,
  pipelineOf,
  pipelineDoneDays,
  pipelineStageLabel,
  prospectSourceLabel,
  type RecordState,
  type SiteId,
} from '@opengewerk/domain'
import { Button, useButtonLook } from '@opengewerk/platform-web'
import { date, euros, today } from '@opengewerk/platform-web/format'
import { deadlinePage, PageHead, Screen } from '@opengewerk/platform-web/office'
import { maybeText, text, useRecords, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { CalendarClock, List, Plus } from 'lucide-react'
import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { documentKindOf, documentStatusOf, jobStatusOf } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import type { DeadlineView } from '../../session/deadlines.js'
import { maintenanceContracts } from '../../session/maintenance-contracts.js'
import { useOfferDeclines } from './offer-decline.js'
import type { ProspectEntry } from '../../session/prospects.js'
import { useGrossByDocument } from './document-gross.js'
import { ProspectStatus, prospectsOffline, useProspects } from './prospects.js'

function documentOf(record: RecordState): PipelineDocument {
  return {
    id: text(record, 'id') as DocumentId,
    kind: documentKindOf(record) as DocumentKind,
    status: documentStatusOf(record) as DocumentStatus,
    customerId: text(record, 'customerId') as CustomerId,
    siteId: (maybeText(record, 'siteId') ?? null) as SiteId | null,
    jobId: (maybeText(record, 'jobId') ?? null) as JobId | null,
    predecessorDocumentId: (maybeText(record, 'predecessorDocumentId') ??
      null) as DocumentId | null,
    issuedAt: maybeText(record, 'issuedAt') ?? null,
  }
}

function jobOf(record: RecordState): PipelineJob {
  return {
    id: text(record, 'id') as JobId,
    status: jobStatusOf(record) as JobStatus,
    closedAt: maybeText(record, 'closedAt') ?? null,
  }
}

/** The follow-ups of the open quotes (`quote.follow_up`), by quote: the day each is due. */
function useFollowUps(): ReadonlyMap<string, IsoDate> {
  const { online } = useSyncStatus()
  const reads = useMay('deadline.read')
  const open = useQuery({
    queryKey: ['deadlines', 'quote.follow_up', 'open'],
    queryFn: () =>
      deadlinePage<DeadlineView>({ status: 'open', kind: 'quote.follow_up', limit: 200 }),
    enabled: online && reads,
  })

  return useMemo(
    () =>
      new Map(
        (open.data?.rows ?? []).flatMap((deadline) =>
          deadline.source.documentId === null ? [] : [[deadline.source.documentId, deadline.dueOn]],
        ),
      ),
    [open.data],
  )
}

/** The maintenance contracts made out of an offer (#294), by quote: they close its deal. */
function useContracts() {
  const { online } = useSyncStatus()
  const reads = useMay('document.read')
  const list = useQuery({
    queryKey: ['maintenance-contracts'],
    queryFn: () => maintenanceContracts(),
    enabled: online && reads,
  })

  return useMemo(
    () => new Map((list.data ?? []).map((contract) => [contract.quoteId as string, contract])),
    [list.data],
  )
}

function Column({
  title,
  sub,
  children,
}: {
  readonly title: string
  readonly sub: string
  readonly children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-[9px] rounded-[6px] border border-line bg-surface-sunken p-2.5"
    >
      <div className="flex items-baseline gap-2 px-0.5 pt-0.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[13px] tabular-nums text-ink-faint">{sub}</span>
      </div>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

function Card({
  to,
  name,
  what,
  facts,
  after,
}: {
  readonly to: string
  readonly name: string
  readonly what: string
  readonly facts: string
  readonly after?: ReactNode
}) {
  return (
    <li className="flex flex-col gap-1 rounded-[5px] border border-line bg-surface px-3 py-2.5">
      <Link to={to} className="font-semibold text-copper-text underline">
        {name}
      </Link>
      {what ? <span className="text-[14px] leading-[1.4]">{what}</span> : null}
      <span className="text-[13px] tabular-nums text-ink-faint">{facts}</span>
      {after}
    </li>
  )
}

function Nothing({ children }: { readonly children: ReactNode }) {
  return <li className="px-0.5 text-[13px] leading-[1.4] text-ink-muted">{children}</li>
}

/**
 * The sales pipeline (#312, section 3.3), the board "Vertrieb": a lead, an
 * offer, an order and what is done, read off the records wherever they say
 * it (`pipelineOf`). Only the stage of a lead is set by hand; an open offer
 * shows its follow-up from the deadline engine.
 */
export function SalesScreen() {
  const { online } = useSyncStatus()
  const writes = useMay('prospect.write')
  const navigate = useNavigate()
  const look = useButtonLook()
  const leads = useProspects()
  const documents = useRecords('documents')
  const jobs = useRecords('jobs')
  const customers = useRecords('customers')
  const gross = useGrossByDocument()
  const followUps = useFollowUps()
  const contracts = useContracts()
  const declines = useOfferDeclines()
  const on = today() as IsoDate

  const byId = useMemo(() => {
    const map = new Map<string, RecordState>()

    for (const record of [...documents, ...jobs, ...customers]) {
      map.set(text(record, 'id'), record)
    }

    return map
  }, [documents, jobs, customers])
  const prospectsById = useMemo(
    () => new Map((leads.data ?? []).map((entry) => [entry.id as string, entry])),
    [leads.data],
  )
  const pipeline = useMemo(
    () =>
      pipelineOf({
        prospects: leads.data ?? [],
        documents: documents.map(documentOf),
        jobs: jobs.map(jobOf),
        contracts: [...contracts.values()].map((contract) => ({
          quoteId: contract.quoteId as DocumentId,
          since: contract.createdAt.slice(0, 10) as IsoDate,
        })),
        declined: (declines.data ?? []).map((decline) => decline.documentId),
        today: on,
      }),
    [leads.data, documents, jobs, contracts, declines.data, on],
  )

  const nameOf = (customerId: string) => maybeText(byId.get(customerId), 'name') ?? ''
  const amountOf = (deal: PipelineDeal) => gross.get(deal.shownId) ?? null
  const sum = (deals: readonly PipelineDeal[]) => {
    const total = deals.reduce((all, deal) => all + (amountOf(deal) ?? 0), 0)

    return `${String(deals.length)} · ${euros(total)}`
  }
  const headline = (deal: PipelineDeal) => {
    const shown = byId.get(deal.shownId)

    return [maybeText(shown, 'number'), maybeText(shown, 'subject')].filter(Boolean).join(' ')
  }
  const amount = (deal: PipelineDeal) => {
    const value = amountOf(deal)

    return value === null ? '' : `${euros(value)} · `
  }

  const leadCard = (entry: ProspectEntry) => (
    <Card
      key={entry.id}
      to={`/leads/${entry.id}`}
      name={entry.name}
      what={entry.concern ?? ''}
      facts={
        entry.customerId !== null && entry.convertedAt !== null
          ? `Kunde seit ${date(entry.convertedAt.slice(0, 10))}, noch ohne Angebot`
          : `${prospectSourceLabel[entry.source]} · letzter Kontakt ${date(entry.lastContactOn)}`
      }
      after={
        <div className="mt-0.5">
          <ProspectStatus entry={entry} />
        </div>
      }
    />
  )
  const offerCard = (deal: PipelineDeal) => {
    const due = followUps.get(deal.headId)

    return (
      <Card
        key={deal.headId}
        to={`/belege/${deal.shownId}`}
        name={nameOf(deal.customerId)}
        what={headline(deal)}
        facts={`${amount(deal)}festgeschrieben am ${date(deal.since)}`}
        after={
          due ? (
            <span
              className={`flex items-center gap-[5px] text-[13px] ${due <= on ? 'text-waiting' : 'text-ink-faint'}`}
            >
              <CalendarClock size={13} strokeWidth={2.2} aria-hidden="true" />
              {due === on ? 'Wiedervorlage heute' : `Wiedervorlage am ${date(due)}`}
            </span>
          ) : null
        }
      />
    )
  }
  const orderCard = (deal: PipelineDeal) => {
    const job = deal.jobId === null ? undefined : byId.get(deal.jobId)
    const running = job !== undefined && jobStatusOf(job) === 'active'

    return (
      <Card
        key={deal.headId}
        to={`/belege/${deal.shownId}`}
        name={nameOf(deal.customerId)}
        what={headline(deal)}
        facts={`${amount(deal)}${
          running && maybeText(job, 'number')
            ? `Auftrag ${text(job, 'number')} läuft`
            : `bestätigt am ${date(deal.since)}`
        }`}
      />
    )
  }
  const doneCard = (deal: PipelineDeal) => (
    <Card
      key={deal.headId}
      to={`/belege/${deal.shownId}`}
      name={nameOf(deal.customerId)}
      what={headline(deal)}
      facts={(() => {
        const contract = contracts.get(deal.headId)

        return contract
          ? `${amount(deal)}Wartungsvertrag ${contract.number} am ${date(deal.since)}`
          : `${amount(deal)}am ${date(deal.since)}`
      })()}
    />
  )
  const openLeads = pipeline.lead.flatMap((entry) => {
    const found = prospectsById.get(entry.prospectId)

    return found === undefined ? [] : [found]
  })
  const hint =
    'Der Stand folgt aus den Belegen. Ein festgeschriebenes Angebot oder ein Kostenvoranschlag steht unter „Angebot“, bis ihm ein festgeschriebener Beleg folgt, dann unter „Auftrag“; mit der Schlussrechnung oder dem abgeschlossenen Auftrag unter „Abgeschlossen“, dort die letzten ' +
    `${String(pipelineDoneDays)} Tage. Von Hand gesetzt werden nur der Stand eines Leads und dass ein Angebot abgelehnt ist; ein abgelehntes steht in keiner Spalte. Beträge brutto.`

  return (
    <Screen>
      <PageHead
        title="Vertrieb"
        sub="Von der ersten Anfrage bis zum abgeschlossenen Auftrag."
        actions={
          <>
            <Link to="/leads" className={look}>
              <List size={16} strokeWidth={2.2} aria-hidden="true" />
              Alle Leads
            </Link>
            {writes ? (
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  void navigate({ to: '/leads/neu' })
                }}
              >
                Lead erfassen
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid items-start gap-3 sm:grid-cols-2 min-[75rem]:grid-cols-4">
        <Column title={pipelineStageLabel.lead} sub={String(openLeads.length)}>
          {!online ? (
            <Nothing>{prospectsOffline}</Nothing>
          ) : openLeads.length === 0 ? (
            <Nothing>Kein offener Lead.</Nothing>
          ) : (
            openLeads.map(leadCard)
          )}
        </Column>
        <Column title={pipelineStageLabel.offer} sub={sum(pipeline.offer)}>
          {pipeline.offer.length === 0 ? (
            <Nothing>Kein offenes Angebot.</Nothing>
          ) : (
            pipeline.offer.map(offerCard)
          )}
        </Column>
        <Column title={pipelineStageLabel.order} sub={sum(pipeline.order)}>
          {pipeline.order.length === 0 ? (
            <Nothing>Kein laufender Auftrag.</Nothing>
          ) : (
            pipeline.order.map(orderCard)
          )}
        </Column>
        <Column title={pipelineStageLabel.done} sub={sum(pipeline.done)}>
          {pipeline.done.length === 0 ? (
            <Nothing>{`In den letzten ${String(pipelineDoneDays)} Tagen nichts abgeschlossen.`}</Nothing>
          ) : (
            pipeline.done.map(doneCard)
          )}
        </Column>
      </div>

      <p className="text-[13px] leading-[1.45] text-ink-faint">{hint}</p>
    </Screen>
  )
}
