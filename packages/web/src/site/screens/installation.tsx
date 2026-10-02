import type { RecordState } from '@opengewerk/domain'
import { Panel } from '@opengewerk/platform-web'
import { useParams } from '@tanstack/react-router'
import { MapPin } from 'lucide-react'
import type { ReactNode } from 'react'

import { useBoards } from '../../app/electrical.js'
import { addressLine, date } from '../../app/format.js'
import {
  installationKindLabel,
  installationKindOf,
  jobStatusLabel,
  jobStatusOf,
} from '../../app/labels.js'
import { definitionOf, useProtocols } from '../../app/protocols.js'
import { maybeText, text } from '../../sync/fields.js'
import { useHoldsAll, useRecord, useRecords, useRelated } from '../../sync/provider.js'
import { SiteHeader } from '../header.js'
import {
  SiteAnchor,
  SiteFacts,
  SiteLabel,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
} from '../kit.js'
import { InstallationBoards } from './boards.js'
import { InstallationInverters, usePvSystemPeak } from './pv.js'

/**
 * The card "Anlage", `anlage_card()` of the canvas: what the installation is,
 * its PV structure or its boards, and its protocols. On the screen of a job,
 * and on the screen of the installation a QR label opened (#308); `base` is
 * where its structure hangs, and `protocols` what each screen offers of them.
 */
export function InstallationPanel({
  installation,
  base,
  protocols,
}: {
  readonly installation: RecordState
  readonly base: string
  readonly protocols: ReactNode
}) {
  const installationId = String(installation['id'])
  // A PV system shows its inverters where a cabinet shows its boards, and a
  // battery, meter or wallbox where it belongs (#300).
  const peak = usePvSystemPeak(installationId)
  const boards = useBoards(installationId)
  const pvSystem = useRecord('installations', maybeText(installation, 'pvSystemId') ?? undefined)
  const atInverter = useRecord('inverters', maybeText(installation, 'inverterId') ?? undefined)
  const pv = installationKindOf(installation) === 'pv_system'

  return (
    <Panel title="Anlage">
      <div className="flex flex-col gap-2.5">
        <SiteFacts
          facts={[
            {
              label: installationKindLabel[installationKindOf(installation)],
              value: <b className="font-semibold">{text(installation, 'designation')}</b>,
            },
            ...(maybeText(installation, 'serialNumber')
              ? [
                  {
                    label: 'Seriennummer',
                    value: <span className="numeric">{text(installation, 'serialNumber')}</span>,
                  },
                ]
              : []),
            ...(pv && peak ? [{ label: 'Leistung', value: peak }] : []),
            ...(pvSystem
              ? [
                  {
                    label: 'Gehört zu',
                    value: [
                      text(pvSystem, 'designation'),
                      atInverter ? `am ${text(atInverter, 'designation')}` : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(', '),
                  },
                ]
              : []),
            ...(maybeText(installation, 'commissionedOn')
              ? [{ label: 'In Betrieb seit', value: date(installation['commissionedOn']) }]
              : []),
          ]}
        />
        {pv ? <InstallationInverters base={base} installationId={installationId} /> : null}
        {/* A PV system written down with boards before #300 keeps them in sight. */}
        {!pv || boards.length > 0 ? (
          <InstallationBoards base={base} installationId={installationId} />
        ) : null}
        {protocols}
      </div>
    </Panel>
  )
}

/**
 * The protocols of an installation opened by its label: each opens on its
 * job, where its photos go, when the job is on this device; a new one is made
 * at a job, as the board says.
 */
function ProtocolLinks({ installationId }: { readonly installationId: string }) {
  const protocols = useProtocols(installationId)
  const jobs = useRecords('jobs')

  return (
    <section aria-label="Prüfprotokolle">
      <SiteLabel className="mt-1">Prüfprotokolle</SiteLabel>
      {protocols.length === 0 ? (
        <SiteText muted size={16}>
          An dieser Anlage gibt es noch kein Prüfprotokoll.
        </SiteText>
      ) : (
        <SiteRows>
          {protocols.map((record) => {
            const id = String(record['id'])
            const jobId = maybeText(record, 'jobId')
            const onDevice = jobId !== null && jobs.some((job) => String(job['id']) === jobId)
            const title = definitionOf(record)?.title ?? 'Prüfprotokoll'
            const meta = [
              maybeText(record, 'performedOn') ? date(record['performedOn']) : null,
              text(record, 'status') === 'signed' ? 'unterschrieben' : 'Entwurf',
            ]
              .filter((part): part is string => part !== null)
              .join(', ')

            return onDevice ? (
              <SiteRow
                key={id}
                to={`/auftraege/${jobId}/pruefprotokolle/${id}`}
                title={title}
                meta={meta}
              />
            ) : (
              <li key={id} className="border-b border-row py-2">
                <p className="text-[17px] font-semibold">{title}</p>
                <p className="text-[15px] leading-[1.35] text-ink-muted">{meta}</p>
              </li>
            )
          })}
        </SiteRows>
      )}
      <SiteText muted size={15}>
        Ein neues Prüfprotokoll entsteht am Auftrag.
      </SiteText>
    </section>
  )
}

/**
 * The installation a QR label opened (#308), the board "Die Anlage, die ein
 * Etikett öffnet": where it is, the card "Anlage" with its structure, and the
 * jobs at it that lie on this device.
 */
export function SiteInstallationScreen() {
  const { installationId } = useParams({ strict: false }) as { installationId?: string }
  const installation = useRecord('installations', installationId)
  const site = useRecord('sites', installation ? text(installation, 'siteId') : undefined)
  const customer = useRecord('customers', site ? text(site, 'customerId') : undefined)
  const jobs = useRelated('jobs', 'installationId', installationId)
  // Inhaber and office hold every job; only a share of the business needs saying so.
  const everyJob = useHoldsAll('jobs')

  if (!installation || !installationId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diese Anlage hat dieses Gerät nicht. Mit Verbindung holt der Abgleich sie.
        </SiteText>
      </SiteScreen>
    )
  }

  const address = addressLine(site)
  const open = jobs.filter((job) => ['draft', 'active'].includes(jobStatusOf(job)))
  const closed = jobs.filter((job) => !['draft', 'active'].includes(jobStatusOf(job)))

  return (
    <SiteScreen>
      <SiteHeader
        title={text(installation, 'designation')}
        sub={[
          installationKindLabel[installationKindOf(installation)],
          site ? text(site, 'designation') : '',
        ]
          .filter((part) => part !== '')
          .join(', ')}
      />
      <Panel title="Wo und für wen">
        <SiteFacts
          facts={[
            { label: 'Kunde', value: customer ? text(customer, 'name') : 'nicht angegeben' },
            { label: 'Objekt', value: site ? text(site, 'designation') : 'nicht angegeben' },
            ...(address
              ? [
                  {
                    label: 'Anschrift',
                    value: (
                      <SiteAnchor href={`geo:0,0?q=${encodeURIComponent(address)}`} icon={MapPin}>
                        {address}
                      </SiteAnchor>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>
      <InstallationPanel
        installation={installation}
        base={`/anlagen/${installationId}`}
        protocols={<ProtocolLinks installationId={installationId} />}
      />
      <Panel title="Aufträge an dieser Anlage">
        {jobs.length === 0 ? (
          <SiteText muted size={16}>
            Auf diesem Gerät liegt kein Auftrag an dieser Anlage.
          </SiteText>
        ) : (
          <SiteRows>
            {[...open, ...closed].map((job) => (
              <SiteRow
                key={String(job['id'])}
                to={`/auftraege/${String(job['id'])}`}
                title={text(job, 'designation')}
                meta={[maybeText(job, 'number'), jobStatusLabel[jobStatusOf(job)]]
                  .filter((part): part is string => part !== null)
                  .join(', ')}
              />
            ))}
          </SiteRows>
        )}
        {everyJob ? null : (
          <SiteText muted size={15}>
            Auf diesem Gerät liegen die Aufträge, denen du zugeordnet bist.
          </SiteText>
        )}
      </Panel>
    </SiteScreen>
  )
}
