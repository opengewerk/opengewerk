import { useNavigate, useParams } from '@tanstack/react-router'

import { date } from '../../app/format.js'
import {
  definitionOf,
  isSigned,
  ProtocolPdfLink,
  ProtocolSheet,
  ProtocolsList,
} from '../../app/protocols.js'
import { text } from '../../sync/fields.js'
import { useRecord } from '../../sync/provider.js'
import { Crumb, Nothing, Page, Section } from '../layout.js'

/**
 * The test protocols in the office (#79): found at the installation, read and
 * printed here. They are filled in on site, and signed there by whoever did
 * the test; a draft can be completed here, a name corrected, a remark added.
 */

function protocolPath(recordId: string): string {
  return `/pruefprotokolle/${recordId}`
}

/** The protocols of an installation, on its screen. */
export function ProtocolsSection({ installationId }: { readonly installationId: string }) {
  const navigate = useNavigate()

  return (
    <Section title="Prüfprotokolle">
      <ProtocolsList
        installationId={installationId}
        jobId={null}
        pathOf={protocolPath}
        onStarted={(recordId) => {
          void navigate({ to: protocolPath(recordId) })
        }}
      />
    </Section>
  )
}

export function ProtocolScreen() {
  const { recordId } = useParams({ strict: false }) as { recordId?: string }
  const record = useRecord('form_records', recordId)
  const installation = useRecord(
    'installations',
    record ? text(record, 'installationId') : undefined,
  )
  const site = useRecord('sites', installation ? text(installation, 'siteId') : undefined)
  const customer = useRecord('customers', site ? text(site, 'customerId') : undefined)

  if (!record || !recordId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>Dieses Protokoll gibt es nicht, oder dieses Gerät kennt es noch nicht.</Nothing>
      </Page>
    )
  }

  return (
    <Page
      crumbs={
        <>
          <Crumb to="/">Kunden</Crumb>
          {customer ? (
            <Crumb to={`/kunden/${String(customer['id'])}`}>{text(customer, 'name')}</Crumb>
          ) : null}
          {site ? (
            <Crumb to={`/objekte/${String(site['id'])}`}>{text(site, 'designation')}</Crumb>
          ) : null}
          {installation ? (
            <Crumb to={`/anlagen/${String(installation['id'])}`}>
              {text(installation, 'designation')}
            </Crumb>
          ) : null}
        </>
      }
      title={definitionOf(record)?.title ?? 'Prüfprotokoll'}
      meta={`${date(record['performedOn'])}, ${isSigned(record) ? 'unterschrieben' : 'Entwurf'}`}
      actions={<ProtocolPdfLink recordId={recordId} />}
    >
      {isSigned(record) ? null : (
        <p className="mb-4 text-body text-ink-muted">
          Unterschrieben wird auf der Baustelle, von der Person, die geprüft hat. Danach ändert sich
          an diesem Protokoll nichts mehr.
        </p>
      )}
      <ProtocolSheet key={recordId} record={record} />
    </Page>
  )
}
