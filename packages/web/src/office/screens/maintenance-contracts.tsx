import {
  type ContractPriceKind,
  type ContractTerms,
  consumerTermsNotice,
  contractStanding,
  endAfterNotice,
  intervalLabel,
  type IsoDate,
  isInvoice,
  lastNoticeDay,
  lastServiceDay,
  maintenanceContractProblems,
  monthsLabel,
  nextPeriod,
  type PaymentRhythm,
  periodText,
  priceUnitLabel,
  type RecordState,
  type RenewalKind,
  renewalLabel,
  rhythmLabel,
  shippedRules,
  termEndOn,
} from '@opengewerk/domain'
import {
  Button,
  Cell,
  Choice,
  Column,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  Status,
  type StatusTone,
  TablePanel,
  TextArea,
  useButtonLook,
} from '@opengewerk/platform-web'
import { date, euros, parseEuros, today } from '@opengewerk/platform-web/format'
import {
  Empty,
  FactList,
  ListCard,
  ListScreen,
  PageHead,
  RecordColumns,
  Screen,
} from '@opengewerk/platform-web/office'
import type { ListColumn } from '@opengewerk/platform-web/office'
import {
  maybeText,
  RequestRefused,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, FileClock, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import {
  documentKindOf,
  documentStatusOf,
  installationKindLabel,
  installationKindOf,
  jobStatusLabel,
  jobStatusOf,
} from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import {
  createMaintenanceContract,
  giveNotice,
  maintenanceContract,
  type MaintenanceContractEntry,
  maintenanceContracts,
  type MaintenanceContractValues,
  removeMaintenanceContract,
  updateMaintenanceContract,
  withdrawNotice,
} from '../../session/maintenance-contracts.js'
import { nextMaintenanceOf } from './contract-card.js'

const toneOf: Readonly<Record<'running' | 'ending' | 'over', StatusTone>> = {
  running: 'done',
  ending: 'waiting',
  over: 'neutral',
}

function asRow(entry: MaintenanceContractEntry): RecordState {
  return entry as unknown as RecordState
}

function entryOf(row: RecordState): MaintenanceContractEntry {
  return row as unknown as MaintenanceContractEntry
}

/** The names of the records a contract names, from the device: customers and sites by id. */
function useNames(table: 'customers' | 'sites', field: 'name' | 'designation') {
  const records = useRecords(table)

  return useMemo(
    () => new Map(records.map((record) => [text(record, 'id'), text(record, field)])),
    [records, field],
  )
}

/** Where the contracts live, said wherever the network is missing. */
const offline = 'Die Wartungsverträge liegen auf dem Server, dafür braucht es Verbindung.'

/**
 * The maintenance contracts of the business (#294), the board
 * "Wartungsverträge": number, name, customer, site, interval, the next
 * maintenance and where the contract stands. A contract comes out of an
 * issued quote, so the list has no button of its own for a new one.
 */
export function MaintenanceContractList() {
  const { online } = useSyncStatus()
  const reads = useMay('document.read')
  const customers = useNames('customers', 'name')
  const sites = useNames('sites', 'designation')
  const on = today() as IsoDate
  const list = useQuery({
    queryKey: ['maintenance-contracts'],
    queryFn: () => maintenanceContracts(),
    enabled: online && reads,
  })
  const columns: readonly ListColumn[] = [
    {
      id: 'number',
      header: 'Nummer',
      value: (row) => entryOf(row).number,
      width: 'w-[118px]',
    },
    { id: 'designation', header: 'Bezeichnung', value: (row) => entryOf(row).designation },
    {
      id: 'customer',
      header: 'Kunde',
      value: (row) => customers.get(entryOf(row).customerId) ?? '',
      width: 'w-[178px]',
    },
    {
      id: 'site',
      header: 'Objekt',
      value: (row) => {
        const siteId = entryOf(row).siteId

        return siteId === null ? '' : (sites.get(siteId) ?? '')
      },
      width: 'w-[128px]',
    },
    {
      id: 'interval',
      header: 'Intervall',
      value: (row) => intervalLabel(entryOf(row).intervalMonths),
      width: 'w-[116px]',
    },
    {
      id: 'next',
      header: 'Nächste Wartung',
      value: (row) => nextMaintenanceOf(entryOf(row), on) ?? '',
      cell: (row) => {
        const next = nextMaintenanceOf(entryOf(row), on)

        return next === null ? <span className="text-ink-faint">keine mehr</span> : date(next)
      },
      width: 'w-[126px]',
    },
    {
      id: 'standing',
      header: 'Stand',
      value: (row) => contractStanding(entryOf(row), on).text,
      cell: (row) => {
        const standing = contractStanding(entryOf(row), on)

        return <Status tone={toneOf[standing.tone]}>{standing.text}</Status>
      },
      width: 'w-[196px]',
    },
  ]

  return (
    <ListScreen
      title="Wartungsverträge"
      caption="Alle Wartungsverträge des Betriebs"
      rows={(list.data ?? []).map(asRow)}
      columns={columns}
      hrefFor={(row) => `/wartungsvertraege/${entryOf(row).id}`}
      searchLabel="Wartungsverträge durchsuchen"
      searchPlaceholder="Nummer, Kunde, Objekt …"
      alsoSearched={(row) => {
        const entry = entryOf(row)

        return [
          entry.number,
          customers.get(entry.customerId) ?? '',
          entry.siteId === null ? '' : (sites.get(entry.siteId) ?? ''),
        ].join(' ')
      }}
      sorts={[
        {
          id: 'number',
          label: 'Nummer',
          compare: (left, right) => entryOf(left).number.localeCompare(entryOf(right).number, 'de'),
        },
      ]}
      card={(row) => {
        const entry = entryOf(row)

        return (
          <ListCard
            to={`/wartungsvertraege/${entry.id}`}
            title={`${entry.number} ${entry.designation}`}
            sub={[customers.get(entry.customerId), contractStanding(entry, on).text]
              .filter(Boolean)
              .join(', ')}
          />
        )
      }}
      note={
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {online
            ? 'Ein Wartungsvertrag entsteht aus einem festgeschriebenen Angebot mit den Wartungsleistungen, dort unter „Wartungsvertrag anlegen“. Rechtzeitig vor einer Wartung legt die Frist „Wartung fällig“ den Serviceauftrag an.'
            : offline}
        </p>
      }
      empty={{
        icon: FileClock,
        title: 'Noch kein Wartungsvertrag',
        text: 'Ein Wartungsvertrag entsteht aus einem festgeschriebenen Angebot mit den Wartungsleistungen, dort unter „Wartungsvertrag anlegen“.',
      }}
    />
  )
}

function Frame({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Screen>
      <PageHead title={title} crumbs={[{ to: '/wartungsvertraege', label: 'Wartungsverträge' }]} />
      <Empty>{children}</Empty>
    </Screen>
  )
}

function useContract(contractId: string | undefined) {
  const { online } = useSyncStatus()

  return useQuery({
    queryKey: ['maintenance-contract', contractId],
    queryFn: () => maintenanceContract(contractId ?? ''),
    enabled: online && contractId !== undefined,
    retry: false,
  })
}

/** "24 Monate, bis 31.12.2027", or the months alone once the first term is over. */
function termText(contract: MaintenanceContractEntry, on: IsoDate): string {
  const end = termEndOn(contract, on)

  return end === null
    ? monthsLabel(contract.termMonths)
    : `${monthsLabel(contract.termMonths)}, bis ${date(end)}`
}

/** "480,00 € netto je Wartung, Pauschale", or "nach Aufwand laut Regiebericht". */
function priceText(
  contract: Pick<MaintenanceContractEntry, 'priceKind' | 'flatCents' | 'paymentRhythm'>,
): string {
  return contract.priceKind === 'flat' && contract.flatCents !== null
    ? `${euros(contract.flatCents)} netto ${priceUnitLabel[contract.paymentRhythm]}, Pauschale`
    : 'nach Aufwand laut Regiebericht'
}

/**
 * One maintenance contract, the board "Wartungsvertrag": the services it
 * includes, its maintenances with their service jobs and invoices, its
 * installations, and beside them the contract and its term with the last day
 * for a notice. "Kündigen" asks for the day the notice came in.
 */
export function MaintenanceContractScreen() {
  const { contractId } = useParams({ strict: false }) as { contractId?: string }
  const { online } = useSyncStatus()
  const one = useContract(contractId)

  if (!online) {
    return <Frame title="Wartungsverträge">{offline}</Frame>
  }

  if (one.isError) {
    return <Frame title="Nicht gefunden">Diesen Wartungsvertrag gibt es nicht mehr.</Frame>
  }

  if (!one.data) {
    return null
  }

  return <ContractView key={one.data.id} contract={one.data} />
}

function ContractView({ contract }: { readonly contract: MaintenanceContractEntry }) {
  const writes = useMay('document.issue')
  const navigate = useNavigate()
  const queries = useQueryClient()
  const look = useButtonLook()
  const on = today() as IsoDate
  const customer = useRecord('customers', contract.customerId)
  const site = useRecord('sites', contract.siteId ?? undefined)
  const quote = useRecord('documents', contract.quoteId)
  const installations = useRecords('installations')
  const visits = useRelated('jobs', 'maintenanceContractId', contract.id)
  const documents = useRecords('documents')
  // The recurring invoices of a contract paid per period (#295), newest first.
  const billed = useRelated('documents', 'maintenanceContractId', contract.id)
    .filter((document) => document['deletedAt'] == null)
    .sort((left, right) => String(right['serviceFrom']).localeCompare(String(left['serviceFrom'])))
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const standing = contractStanding(contract, on)
  const next = nextMaintenanceOf(contract, on)
  const made = [...visits].sort((left, right) =>
    String(right['maintenanceDueOn']).localeCompare(String(left['maintenanceDueOn'])),
  )
  const covered = contract.installationIds.map((id) =>
    installations.find((installation) => text(installation, 'id') === id),
  )
  const services = (contract.services ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const end = contract.cancelledOn === null ? termEndOn(contract, on) : null
  const lastBilledFrom = (maybeText(billed[0], 'serviceFrom') ?? null) as IsoDate | null
  const nextBilled = nextPeriod(contract, {
    lastBilledFrom,
    notBefore:
      lastBilledFrom === null ? (contract.createdAt.slice(0, 10) as IsoDate) : lastBilledFrom,
    lastDay: lastServiceDay(contract),
  })
  // The next maintenance whose service job is not made yet, the first line of the table.
  const upcoming =
    next !== null && !made.some((job) => job['maintenanceDueOn'] === next) ? next : null
  const refresh = async () => {
    await queries.invalidateQueries({ queryKey: ['maintenance-contracts'] })
    await queries.invalidateQueries({ queryKey: ['maintenance-contract', contract.id] })
  }

  async function act(step: () => Promise<unknown>, after?: () => Promise<void>) {
    setTrouble(null)

    try {
      await step()
      await refresh()
      await after?.()
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : 'Das hat nicht geklappt.')
    }
  }

  const invoiceOf = (jobId: string) =>
    documents.find(
      (document) => maybeText(document, 'jobId') === jobId && isInvoice(documentKindOf(document)),
    )

  const contractFacts = [
    {
      label: 'Kunde',
      value: customer ? (
        <Link to={`/kunden/${contract.customerId}`} className="text-copper-text">
          {text(customer, 'name')}
        </Link>
      ) : (
        ''
      ),
    },
    {
      label: 'Objekt',
      value: site ? (
        <Link to={`/objekte/${text(site, 'id')}`} className="text-copper-text">
          {text(site, 'designation')}
        </Link>
      ) : (
        ''
      ),
    },
    {
      label: 'Angebot',
      value: quote ? (
        <Link to={`/belege/${contract.quoteId}`} className="text-copper-text">
          {`${maybeText(quote, 'number') ?? 'Angebot'} vom ${date(text(quote, 'documentDate'))}`}
        </Link>
      ) : (
        ''
      ),
    },
    {
      label: 'Intervall',
      value: `${intervalLabel(contract.intervalMonths)}, die erste am ${date(contract.firstVisitOn)}`,
    },
    { label: 'Preis', value: priceText(contract) },
    {
      label: 'Abrechnung',
      value: `${rhythmLabel[contract.paymentRhythm]}${contract.issueByItself ? '; ab der zweiten Rechnung ohne Zutun' : ''}`,
    },
  ]
  const termFacts = [
    { label: 'Beginn', value: date(contract.startsOn) },
    { label: 'Laufzeit', value: termText(contract, on) },
    { label: 'Danach', value: renewalLabel(contract) },
    {
      label: 'Kündigungsfrist',
      value: `${monthsLabel(contract.noticeMonths)} vor dem Ende der Laufzeit`,
    },
    ...(contract.cancelledOn !== null && contract.endsOn !== null
      ? [
          { label: 'Gekündigt am', value: date(contract.cancelledOn) },
          { label: 'Endet am', value: date(contract.endsOn) },
        ]
      : contract.renewal !== 'none' && end !== null
        ? [{ label: 'Kündigen bis', value: date(lastNoticeDay(end, contract.noticeMonths)) }]
        : []),
  ]

  return (
    <Screen>
      <PageHead
        title={contract.designation}
        crumbs={[{ to: '/wartungsvertraege', label: 'Wartungsverträge' }]}
        badges={
          <>
            <Status tone={toneOf[standing.tone]}>{standing.text}</Status>
            <span className="text-[13px] text-ink-faint">
              {contract.number}
              {customer ? (
                <>
                  {' · '}
                  <Link to={`/kunden/${contract.customerId}`} className="text-copper-text">
                    {text(customer, 'name')}
                  </Link>
                </>
              ) : null}
            </span>
          </>
        }
        actions={
          writes ? (
            <>
              {visits.length === 0 ? (
                <Button
                  icon={Trash2}
                  onClick={() => {
                    setAsking(true)
                  }}
                >
                  Entfernen
                </Button>
              ) : null}
              {contract.cancelledOn === null ? (
                <Button
                  onClick={() => {
                    setNoticeOpen(true)
                  }}
                >
                  Kündigen
                </Button>
              ) : (
                <Button onClick={() => void act(() => withdrawNotice(contract.id))}>
                  Kündigung zurücknehmen
                </Button>
              )}
              <Link to={`/wartungsvertraege/${contract.id}/bearbeiten`} className={look}>
                <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
                Bearbeiten
              </Link>
            </>
          ) : null
        }
      />

      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <RecordColumns
        sideWidth={340}
        main={
          <div className="flex flex-col gap-3">
            <Panel title="Enthaltene Leistungen">
              {services.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Keine Leistungen eingetragen.</p>
              ) : (
                <ul className="list-disc pl-[18px] text-[14px] leading-[1.45]">
                  {services.map((line, index) => (
                    <li key={index} className="py-[3px]">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {contract.paymentRhythm !== 'visit' ? (
              <TablePanel
                title="Rechnungen"
                caption="Die Rechnungen der Zeiträume"
                grow={false}
                cards={[
                  ...(nextBilled
                    ? [{ key: 'next', title: periodText(nextBilled), sub: 'noch nicht angelegt' }]
                    : []),
                  ...billed.map((document) => ({
                    key: text(document, 'id'),
                    title: periodText({
                      from: text(document, 'serviceFrom') as IsoDate,
                      until: text(document, 'serviceUntil') as IsoDate,
                    }),
                    sub: maybeText(document, 'number') ?? 'Entwurf',
                  })),
                ]}
                note={
                  <p className="text-[13px] leading-[1.4] text-ink-muted">
                    {`Zu Beginn jedes Zeitraums entsteht eine Dauerrechnung über ihn, mit der Pauschale als einer Position. Die erste eines Vertrags wartet als Entwurf${contract.issueByItself ? '; danach schreibt OpenGewerk jede selbst fest und schickt sie per E-Mail.' : '.'}`}
                  </p>
                }
              >
                <thead>
                  <tr>
                    <Column className="w-[220px]">Leistungszeitraum</Column>
                    <Column>Rechnung</Column>
                    <Column className="w-[170px]">Stand</Column>
                  </tr>
                </thead>
                <tbody>
                  {nextBilled ? (
                    <tr>
                      <Cell>{periodText(nextBilled)}</Cell>
                      <Cell className="text-ink-faint">noch nicht angelegt</Cell>
                      <Cell>{null}</Cell>
                    </tr>
                  ) : null}
                  {billed.map((document) => (
                    <tr key={text(document, 'id')}>
                      <Cell>
                        {periodText({
                          from: text(document, 'serviceFrom') as IsoDate,
                          until: text(document, 'serviceUntil') as IsoDate,
                        })}
                      </Cell>
                      <Cell>
                        <Link to={`/belege/${text(document, 'id')}`} className="text-copper-text">
                          {maybeText(document, 'number') ?? 'Dauerrechnung'}
                        </Link>
                      </Cell>
                      <Cell>
                        {documentStatusOf(document) === 'draft' ? (
                          <Status tone="draft">Entwurf</Status>
                        ) : (
                          <Status tone="locked">Festgeschrieben</Status>
                        )}
                      </Cell>
                    </tr>
                  ))}
                </tbody>
              </TablePanel>
            ) : null}
            <TablePanel
              title="Wartungen"
              caption="Die Wartungen des Vertrags"
              grow={false}
              cards={[
                ...(upcoming
                  ? [{ key: 'next', title: date(upcoming), sub: 'noch nicht angelegt' }]
                  : []),
                ...made.map((job) => ({
                  key: text(job, 'id'),
                  title: date(text(job, 'maintenanceDueOn')),
                  sub: [maybeText(job, 'number'), jobStatusLabel[jobStatusOf(job)]]
                    .filter(Boolean)
                    .join(', '),
                })),
              ]}
              note={
                <p className="text-[13px] leading-[1.4] text-ink-muted">
                  Rechtzeitig vor einer Wartung entsteht ein Serviceauftrag mit den Anlagen des
                  Vertrags. Er steht auf der Plantafel unter „Ohne Termin“, mit dem Tag der Wartung
                  als Vorschlag.{' '}
                  {contract.paymentRhythm !== 'visit'
                    ? 'Die Wartung selbst stellt keine Rechnung, sie ist in der Pauschale enthalten.'
                    : contract.priceKind === 'flat'
                      ? 'Die Rechnung aus seinem Regiebericht trägt die Pauschale.'
                      : 'Die Rechnung kommt aus seinem Regiebericht.'}
                </p>
              }
            >
              <thead>
                <tr>
                  <Column className="w-[120px]">Fällig am</Column>
                  <Column>Serviceauftrag</Column>
                  <Column className="w-[150px]">Stand</Column>
                  <Column className="w-[150px]">Rechnung</Column>
                </tr>
              </thead>
              <tbody>
                {upcoming ? (
                  <tr>
                    <Cell>{date(upcoming)}</Cell>
                    <Cell className="text-ink-faint">noch nicht angelegt</Cell>
                    <Cell>{null}</Cell>
                    <Cell>{null}</Cell>
                  </tr>
                ) : null}
                {made.map((job) => {
                  const jobId = text(job, 'id')
                  const invoice = invoiceOf(jobId)

                  return (
                    <tr key={jobId}>
                      <Cell>{date(text(job, 'maintenanceDueOn'))}</Cell>
                      <Cell>
                        <Link to={`/auftraege/${jobId}`} className="text-copper-text">
                          {maybeText(job, 'number') ?? 'Serviceauftrag'}
                        </Link>
                      </Cell>
                      <Cell>
                        <Status tone={jobStatusOf(job) === 'completed' ? 'done' : 'waiting'}>
                          {jobStatusLabel[jobStatusOf(job)]}
                        </Status>
                      </Cell>
                      <Cell>
                        {invoice ? (
                          <Link to={`/belege/${text(invoice, 'id')}`} className="text-copper-text">
                            {documentStatusOf(invoice) === 'draft'
                              ? 'Entwurf'
                              : (maybeText(invoice, 'number') ?? 'Rechnung')}
                          </Link>
                        ) : null}
                      </Cell>
                    </tr>
                  )
                })}
              </tbody>
            </TablePanel>
            <Panel title="Anlagen">
              {covered.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Der Vertrag nennt keine Anlage.</p>
              ) : (
                <ul className="flex flex-col">
                  {covered.map((installation, index) =>
                    installation ? (
                      <li
                        key={text(installation, 'id')}
                        className="flex items-center gap-2.5 border-b border-row py-[7px] last:border-b-0"
                      >
                        <Link
                          to={`/anlagen/${text(installation, 'id')}`}
                          className="text-copper-text"
                        >
                          {text(installation, 'designation')}
                        </Link>
                        <span className="grow" />
                        <span className="text-[13px] text-ink-faint">
                          {installationKindLabel[installationKindOf(installation)]}
                        </span>
                      </li>
                    ) : (
                      <li key={index} className="py-[7px] text-[13px] text-ink-faint">
                        Eine Anlage, die es nicht mehr gibt
                      </li>
                    ),
                  )}
                </ul>
              )}
            </Panel>
          </div>
        }
        side={
          <div className="flex flex-col gap-3">
            <Panel title="Vertrag">
              <FactList facts={contractFacts} />
            </Panel>
            <Panel title="Laufzeit und Kündigung">
              <div className="flex flex-col gap-2">
                <FactList facts={termFacts} />
                {contract.cancelledOn === null && contract.renewal !== 'none' && end !== null ? (
                  <p className="text-[13px] leading-[1.4] text-ink-muted">
                    Vor diesem Tag erinnert die Frist „Kündigungsfrist eines Wartungsvertrags“.
                  </p>
                ) : null}
              </div>
            </Panel>
          </div>
        }
      />

      {noticeOpen ? (
        <NoticeDialog
          contract={contract}
          onClose={() => {
            setNoticeOpen(false)
          }}
          onGiven={async (receivedOn) => {
            setNoticeOpen(false)
            await act(() => giveNotice(contract.id, receivedOn))
          }}
        />
      ) : null}

      <Confirm
        open={asking}
        title={`${contract.number} entfernen?`}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          setAsking(false)
          void act(
            () => removeMaintenanceContract(contract.id),
            async () => {
              await navigate({ to: '/wartungsvertraege' })
            },
          )
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        Der Vertrag geht. Das Angebot bleibt, aus ihm lässt sich ein neuer anlegen.
      </Confirm>
    </Screen>
  )
}

/**
 * "Wartungsvertrag kündigen", the board of that name: the day the notice came
 * in, and under it the day the contract ends because of it, worked out as the
 * server will.
 */
function NoticeDialog({
  contract,
  onClose,
  onGiven,
}: {
  readonly contract: MaintenanceContractEntry
  readonly onClose: () => void
  readonly onGiven: (receivedOn: string) => Promise<void>
}) {
  const [receivedOn, setReceivedOn] = useState(today())
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(receivedOn)
  const ends = valid ? endAfterNotice(contract, receivedOn as IsoDate) : null

  return (
    <Dialog title="Wartungsvertrag kündigen" width={520} onClose={onClose}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()

          if (valid) {
            void onGiven(receivedOn)
          }
        }}
      >
        <p className="text-[14px] leading-[1.55]">
          Wann kam die Kündigung an? Der Vertrag endet dann mit der Laufzeit, in der sie noch
          rechtzeitig war.
        </p>
        <Field
          label="Kündigung eingegangen am"
          type="date"
          required
          starred
          value={receivedOn}
          onChange={(event) => {
            setReceivedOn(event.target.value)
          }}
        />
        {ends !== null ? (
          <p className="text-[14px] leading-[1.55]">
            <strong>Endet am {date(ends)}.</strong> Wartungen nach diesem Tag entstehen nicht mehr;
            schon angelegte Serviceaufträge bleiben.
          </p>
        ) : null}
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" disabled={!valid}>
            Kündigen
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

interface Draft {
  readonly designation: string
  readonly services: string
  readonly installationIds: readonly string[]
  readonly startsOn: string
  readonly firstVisitOn: string
  readonly intervalMonths: string
  readonly termMonths: string
  readonly renewal: RenewalKind
  readonly renewalMonths: string
  readonly noticeMonths: string
  readonly priceKind: ContractPriceKind
  readonly flat: string
  readonly paymentRhythm: PaymentRhythm
  readonly issueByItself: boolean
}

function draftOf(entry: MaintenanceContractEntry): Draft {
  return {
    designation: entry.designation,
    services: entry.services ?? '',
    installationIds: entry.installationIds,
    startsOn: entry.startsOn,
    firstVisitOn: entry.firstVisitOn,
    intervalMonths: String(entry.intervalMonths),
    termMonths: String(entry.termMonths),
    renewal: entry.renewal,
    renewalMonths: entry.renewalMonths === null ? '12' : String(entry.renewalMonths),
    noticeMonths: String(entry.noticeMonths),
    priceKind: entry.priceKind,
    flat: entry.flatCents === null ? '' : euros(entry.flatCents).replace(/\s*€$/, ''),
    paymentRhythm: entry.paymentRhythm,
    issueByItself: entry.issueByItself,
  }
}

/** A whole number as typed, or the text itself so that the check names it. */
function whole(value: string): number | string {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : value
}

function valuesOf(draft: Draft): MaintenanceContractValues {
  const flat = parseEuros(draft.flat)

  return {
    designation: draft.designation.trim(),
    services: draft.services.trim() === '' ? null : draft.services,
    installationIds: draft.installationIds,
    startsOn: draft.startsOn as IsoDate,
    firstVisitOn: draft.firstVisitOn as IsoDate,
    intervalMonths: whole(draft.intervalMonths) as number,
    termMonths: whole(draft.termMonths) as number,
    renewal: draft.renewal,
    renewalMonths: draft.renewal === 'fixed' ? (whole(draft.renewalMonths) as number) : null,
    noticeMonths: whole(draft.noticeMonths) as number,
    priceKind: draft.priceKind,
    flatCents: draft.priceKind === 'flat' ? flat : null,
    paymentRhythm: draft.paymentRhythm,
    issueByItself: draft.paymentRhythm !== 'visit' && draft.issueByItself,
  }
}

/**
 * A new contract out of an issued quote, the board "Neuer Wartungsvertrag aus
 * einem Angebot": customer and site from the quote, its lines as the services,
 * its total as the flat price.
 */
export function NewMaintenanceContractScreen() {
  const { quoteId } = useParams({ strict: false }) as { quoteId?: string }
  const writes = useMay('document.issue')
  const { online } = useSyncStatus()
  const quote = useRecord('documents', quoteId)
  const lines = useRelated('document_lines', 'documentId', quoteId)
  const taken = useQuery({
    queryKey: ['maintenance-contracts', { quoteId }],
    queryFn: () => maintenanceContracts({ quoteId: quoteId ?? '' }),
    enabled: online && writes && quoteId !== undefined,
  })

  if (!writes) {
    return (
      <Frame title="Wartungsverträge">Wartungsverträge anlegen darf dieser Zugang nicht.</Frame>
    )
  }

  if (!online) {
    return <Frame title="Wartungsverträge">{offline}</Frame>
  }

  if (!quote || documentKindOf(quote) !== 'quote' || documentStatusOf(quote) !== 'issued') {
    return (
      <Frame title="Neuer Wartungsvertrag">
        Ein Wartungsvertrag entsteht aus einem festgeschriebenen Angebot.
      </Frame>
    )
  }

  const existing = taken.data?.[0]

  if (existing) {
    return (
      <Frame title="Neuer Wartungsvertrag">
        Aus diesem Angebot ist schon der Wartungsvertrag{' '}
        <Link to={`/wartungsvertraege/${existing.id}`} className="text-copper-text">
          {existing.number}
        </Link>{' '}
        entstanden.
      </Frame>
    )
  }

  if (!taken.data) {
    return null
  }

  const items = [...lines]
    .filter((line) => maybeText(line, 'kind') === 'item' && line['deletedAt'] == null)
    .sort((left, right) => Number(left['position']) - Number(right['position']))
  const total = items.reduce((sum, line) => sum + Number(line['netCents'] ?? 0), 0)
  const start = today()

  return (
    <ContractForm
      quote={quote}
      entry={undefined}
      initial={{
        designation: maybeText(quote, 'subject') ?? '',
        services: items.map((line) => text(line, 'designation')).join('\n'),
        installationIds: [],
        startsOn: start,
        firstVisitOn: start,
        intervalMonths: '12',
        termMonths: '12',
        renewal: 'indefinite',
        renewalMonths: '12',
        noticeMonths: '1',
        priceKind: 'flat',
        flat: total > 0 ? euros(total).replace(/\s*€$/, '') : '',
        paymentRhythm: 'visit',
        issueByItself: false,
      }}
    />
  )
}

/** A contract as its form, the same as for a new one without the quote to choose. */
export function EditMaintenanceContractScreen() {
  const { contractId } = useParams({ strict: false }) as { contractId?: string }
  const writes = useMay('document.issue')
  const { online } = useSyncStatus()
  const one = useContract(contractId)
  const quote = useRecord('documents', one.data?.quoteId)

  if (!writes) {
    return <Frame title="Wartungsverträge">Wartungsverträge ändern darf dieser Zugang nicht.</Frame>
  }

  if (!online) {
    return <Frame title="Wartungsverträge">{offline}</Frame>
  }

  if (one.isError) {
    return <Frame title="Nicht gefunden">Diesen Wartungsvertrag gibt es nicht mehr.</Frame>
  }

  if (!one.data) {
    return null
  }

  return (
    <ContractForm
      key={one.data.id}
      quote={quote ?? undefined}
      entry={one.data}
      initial={draftOf(one.data)}
    />
  )
}

function ContractForm({
  quote,
  entry,
  initial,
}: {
  readonly quote: RecordState | undefined
  readonly entry: MaintenanceContractEntry | undefined
  readonly initial: Draft
}) {
  const navigate = useNavigate()
  const queries = useQueryClient()
  const customerId = entry?.customerId ?? (quote ? text(quote, 'customerId') : undefined)
  const siteId = entry ? (entry.siteId ?? undefined) : quote ? maybeText(quote, 'siteId') : null
  const customer = useRecord('customers', customerId)
  const site = useRecord('sites', siteId ?? undefined)
  const atSite = useRelated('installations', 'siteId', siteId ?? undefined).filter(
    (installation) => installation['deletedAt'] == null,
  )
  const [draft, setDraft] = useState<Draft>(initial)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const back = entry ? `/wartungsvertraege/${entry.id}` : '/wartungsvertraege'
  const consumer = customer ? customer['isBusiness'] !== true : false
  const values = valuesOf(draft)
  const termsComplete =
    typeof values.termMonths === 'number' &&
    typeof values.noticeMonths === 'number' &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.startsOn)
  const notice =
    consumer && termsComplete ? consumerTermsNotice(shippedRules, values as ContractTerms) : null

  const set = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const found = maintenanceContractProblems(values)

    setProblems(
      draft.priceKind === 'flat' && parseEuros(draft.flat) === null && draft.flat.trim() !== ''
        ? { ...found, flatCents: 'Die Pauschale ist ein Betrag in Euro.' }
        : found,
    )

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const saved = entry
        ? await updateMaintenanceContract(entry.id, values)
        : await createMaintenanceContract(text(quote as RecordState, 'id'), values)

      await queries.invalidateQueries({ queryKey: ['maintenance-contracts'] })
      await queries.invalidateQueries({ queryKey: ['maintenance-contract', saved.id] })
      await navigate({ to: `/wartungsvertraege/${saved.id}` })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Wartungsverträge werden mit Verbindung gespeichert.',
      )
    } finally {
      setWorking(false)
    }
  }

  const months = (key: 'intervalMonths' | 'termMonths' | 'renewalMonths' | 'noticeMonths') => ({
    value: draft[key],
    problem: problems[key],
    inputMode: 'numeric' as const,
    onChange: (event: { readonly target: { readonly value: string } }) => {
      set(key, event.target.value)
    },
  })

  return (
    <Screen>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <PageHead
          title={entry ? entry.designation : 'Neuer Wartungsvertrag'}
          crumbs={[{ to: '/wartungsvertraege', label: 'Wartungsverträge' }]}
          actions={
            <>
              <Button
                disabled={working}
                onClick={() => {
                  void navigate({ to: back })
                }}
              >
                Abbrechen
              </Button>
              <Button type="submit" tone="primary" icon={Check} disabled={working}>
                {working ? 'Wird gespeichert' : 'Speichern'}
              </Button>
            </>
          }
        />

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <div className="flex max-w-[820px] flex-col gap-3">
          <Panel title="Aus dem Angebot" roomy>
            <div className="flex flex-col gap-2">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Angebot"
                  readOnly
                  value={
                    quote
                      ? `${maybeText(quote, 'number') ?? ''} vom ${date(text(quote, 'documentDate'))}`
                      : ''
                  }
                />
                <Field
                  label="Kunde"
                  readOnly
                  value={
                    customer ? `${text(customer, 'name')}${consumer ? ', Verbraucher' : ''}` : ''
                  }
                />
                <Field
                  label="Objekt"
                  readOnly
                  value={site ? text(site, 'designation') : 'kein Objekt'}
                />
              </div>
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                Kunde und Objekt kommen aus dem Angebot. Die Belehrungen gingen mit dem Angebot
                hinaus.
              </p>
            </div>
          </Panel>

          <Panel title="Vertrag" roomy>
            <div className="flex flex-col gap-3">
              <Field
                label="Bezeichnung"
                required
                starred
                value={draft.designation}
                problem={problems['designation']}
                onChange={(event) => {
                  set('designation', event.target.value)
                }}
              />
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-[13px] font-semibold">Anlagen</legend>
                {atSite.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">
                    {siteId
                      ? 'Am Objekt ist keine Anlage.'
                      : 'Ohne Objekt nennt der Vertrag keine Anlage.'}
                  </p>
                ) : (
                  atSite.map((installation) => {
                    const id = text(installation, 'id')

                    return (
                      <label key={id} className="flex items-start gap-2 text-[14px]">
                        <input
                          type="checkbox"
                          className="mt-[3px] size-4 accent-ink"
                          checked={draft.installationIds.includes(id)}
                          onChange={(event) => {
                            const checked = event.target.checked

                            setDraft((current) => ({
                              ...current,
                              installationIds: checked
                                ? [...current.installationIds, id]
                                : current.installationIds.filter((other) => other !== id),
                            }))
                          }}
                        />
                        <span>
                          {text(installation, 'designation')}
                          <span className="block text-[13px] text-ink-muted">
                            {installationKindLabel[installationKindOf(installation)]}
                          </span>
                        </span>
                      </label>
                    )
                  })
                )}
                {problems['installationIds'] ? (
                  <p className="text-[13px] text-conflict">{problems['installationIds']}</p>
                ) : null}
              </fieldset>
              <TextArea
                label="Enthaltene Leistungen"
                hint="Aus den Positionen des Angebots, eine je Zeile."
                value={draft.services}
                problem={problems['services']}
                onChange={(event) => {
                  set('services', event.target.value)
                }}
              />
            </div>
          </Panel>

          <Panel title="Wartungen" roomy>
            <div className="flex flex-col gap-2">
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                Rechtzeitig vor jeder Wartung entsteht ein Serviceauftrag mit den Anlagen.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Beginn"
                  type="date"
                  required
                  starred
                  value={draft.startsOn}
                  problem={problems['startsOn']}
                  onChange={(event) => {
                    set('startsOn', event.target.value)
                  }}
                />
                <Field
                  label="Erste Wartung"
                  type="date"
                  required
                  starred
                  value={draft.firstVisitOn}
                  problem={problems['firstVisitOn']}
                  onChange={(event) => {
                    set('firstVisitOn', event.target.value)
                  }}
                />
                <Field
                  label="Intervall in Monaten"
                  required
                  starred
                  {...months('intervalMonths')}
                />
              </div>
            </div>
          </Panel>

          <Panel title="Laufzeit und Kündigung" roomy>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Laufzeit in Monaten" required starred {...months('termMonths')} />
                <Field
                  label="Kündigungsfrist in Monaten"
                  hint="Vor dem Ende der Laufzeit."
                  {...months('noticeMonths')}
                />
              </div>
              <Choice<RenewalKind>
                label="Danach"
                value={draft.renewal}
                options={[
                  { value: 'none', label: 'Endet mit der Laufzeit' },
                  {
                    value: 'fixed',
                    label: 'Verlängert sich um eine feste Zeit',
                    note: 'wenn niemand kündigt',
                  },
                  {
                    value: 'indefinite',
                    label: 'Verlängert sich auf unbestimmte Zeit',
                    note: 'danach jederzeit kündbar mit der Kündigungsfrist',
                  },
                ]}
                onChange={(value) => {
                  set('renewal', value)
                }}
              />
              {draft.renewal === 'fixed' ? (
                <div className="sm:w-[220px]">
                  <Field label="Verlängert sich um Monate" {...months('renewalMonths')} />
                </div>
              ) : null}
              {notice ? (
                <p
                  role="note"
                  className="rounded-[4px] border border-waiting-edge bg-waiting-fill px-3 py-2.5 text-[13px] leading-[1.45] text-waiting"
                >
                  {notice} Gespeichert wird trotzdem.
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel title="Preis" roomy>
            <div className="flex flex-col gap-3">
              <div className="sm:w-[360px]">
                <SelectField
                  label="Abrechnung"
                  value={draft.paymentRhythm}
                  hint="Je Zeitraum braucht es eine Pauschale."
                  problem={problems['paymentRhythm']}
                  options={(['visit', 'monthly', 'quarterly', 'yearly'] as const).map((rhythm) => ({
                    value: rhythm,
                    label: rhythmLabel[rhythm].replace(/^./, (first) => first.toUpperCase()),
                  }))}
                  onChange={(value) => {
                    setDraft((current) => ({
                      ...current,
                      paymentRhythm: value as PaymentRhythm,
                      ...(value === 'visit' ? {} : { priceKind: 'flat' as const }),
                    }))
                  }}
                />
              </div>
              {draft.paymentRhythm === 'visit' ? (
                <Choice<ContractPriceKind>
                  label="Preis"
                  value={draft.priceKind}
                  options={[
                    {
                      value: 'flat',
                      label: 'Pauschale je Wartung',
                      note: 'Die Rechnung nach der Wartung trägt sie als eine Position.',
                    },
                    {
                      value: 'effort',
                      label: 'Nach Aufwand',
                      note: 'Die Rechnung kommt aus dem Regiebericht der Wartung.',
                    },
                  ]}
                  onChange={(value) => {
                    set('priceKind', value)
                  }}
                />
              ) : null}
              {draft.priceKind === 'flat' ? (
                <div className="sm:w-[260px]">
                  <Field
                    label={`Pauschale netto ${priceUnitLabel[draft.paymentRhythm]} in Euro`}
                    inputMode="decimal"
                    value={draft.flat}
                    problem={problems['flatCents']}
                    onChange={(event) => {
                      set('flat', event.target.value)
                    }}
                  />
                </div>
              ) : null}
              {draft.paymentRhythm !== 'visit' ? (
                <label className="flex items-start gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    className="mt-[3px] size-4 accent-ink"
                    checked={draft.issueByItself}
                    onChange={(event) => {
                      set('issueByItself', event.target.checked)
                    }}
                  />
                  <span>
                    Ab der zweiten Rechnung ohne Zutun festschreiben und per E-Mail verschicken
                    <span className="block text-[13px] text-ink-muted">
                      Die erste Rechnung eines Vertrags wartet immer als Entwurf. Ohne
                      E-Mail-Adresse beim Kunden bleibt jede festgeschrieben im Büro liegen.
                    </span>
                  </span>
                </label>
              ) : null}
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                {draft.paymentRhythm === 'visit'
                  ? 'Abgerechnet wird je Wartung, nach der Ausführung.'
                  : 'Zu Beginn jedes Zeitraums entsteht eine Dauerrechnung über ihn, mit dem Steuersatz, der dann gilt.'}
              </p>
            </div>
          </Panel>
        </div>
      </form>
    </Screen>
  )
}
