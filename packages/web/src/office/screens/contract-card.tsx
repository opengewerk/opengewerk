import { intervalLabel, type IsoDate, lastServiceDay, nextVisitOn } from '@opengewerk/domain'
import { Panel, useButtonLook } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

import { useMay } from '../../app/queries.js'
import {
  type ContractFilter,
  type MaintenanceContractEntry,
  maintenanceContracts,
} from '../../session/maintenance-contracts.js'

/** The next maintenance of a contract from today on, or null once there is none. */
export function nextMaintenanceOf(contract: MaintenanceContractEntry, on: IsoDate): IsoDate | null {
  return nextVisitOn(contract, {
    lastMadeOn: null,
    notBefore: on,
    lastDay: lastServiceDay(contract),
  })
}

/** "alle 6 Monate, nächste am 15.01.2027", or "keine Wartung mehr". */
export function contractRhythm(contract: MaintenanceContractEntry, on: IsoDate): string {
  const next = nextMaintenanceOf(contract, on)

  return next === null
    ? 'keine Wartung mehr'
    : `${intervalLabel(contract.intervalMonths)}, nächste am ${date(next)}`
}

/**
 * The card "Wartungsverträge" of a customer, a site and an installation
 * (#294), as the boards "Kundenakte mit Wartungsvertrag" and "Anlagenakte mit
 * Wartungsvertrag" draw it: each contract by number and name, with its
 * interval and the next maintenance. Nothing at all where there is none, or
 * where the person reads no documents.
 *
 * A module of its own and small on purpose: the list of customers is the
 * first page of the office, and the screen of a contract comes when somebody
 * opens it (#831).
 */
export function ContractsCard({
  filter,
  title = 'Wartungsverträge',
}: {
  readonly filter: ContractFilter
  readonly title?: string
}) {
  const reads = useMay('document.read')
  const { online } = useSyncStatus()
  const list = useQuery({
    queryKey: ['maintenance-contracts', filter],
    queryFn: () => maintenanceContracts(filter),
    enabled: reads && online,
  })
  const on = today() as IsoDate

  if (!reads || !list.data || list.data.length === 0) {
    return null
  }

  return (
    <Panel title={title}>
      <ul className="flex flex-col">
        {list.data.map((contract) => (
          <li key={contract.id} className="border-b border-row py-[7px] last:border-b-0">
            <Link
              to={`/wartungsvertraege/${contract.id}`}
              className="text-[14px] font-medium text-copper-text underline underline-offset-2"
            >
              {`${contract.number} ${contract.designation}`}
            </Link>
            <span className="mt-0.5 block text-[13px] text-ink-faint">
              {contractRhythm(contract, on)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * The card "Wartungsvertrag" beside an issued quote (#294): "Wartungsvertrag
 * anlegen", or the way to the contract that came out of it, one per quote.
 * For whoever issues documents, since a contract binds the business like
 * one. A card and not a button in the head: the head of an issued quote
 * already holds its successors, and a fifth button squeezed its title.
 */
export function QuoteContractCard({ quoteId }: { readonly quoteId: string }) {
  const issues = useMay('document.issue')
  const { online } = useSyncStatus()
  const look = useButtonLook()
  const taken = useQuery({
    queryKey: ['maintenance-contracts', { quoteId }],
    queryFn: () => maintenanceContracts({ quoteId }),
    enabled: issues && online,
  })

  if (!issues || !taken.data) {
    return null
  }

  const contract = taken.data[0]

  return (
    <Panel title="Wartungsvertrag">
      {contract ? (
        <Link
          to={`/wartungsvertraege/${contract.id}`}
          className="text-[14px] font-medium text-copper-text underline underline-offset-2"
        >
          {`${contract.number} ${contract.designation}`}
        </Link>
      ) : (
        <div className="flex flex-col items-start gap-2.5">
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Ein Angebot mit Wartungsleistungen wird zum Wartungsvertrag, mit Kunde, Objekt und den
            Positionen als Leistungen.
          </p>
          <Link to={`/wartungsvertraege/neu/${quoteId}`} className={look}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            Wartungsvertrag anlegen
          </Link>
        </div>
      )}
    </Panel>
  )
}
