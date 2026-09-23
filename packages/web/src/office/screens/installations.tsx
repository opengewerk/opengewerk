import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Card } from '../../components/index.js'
import { date } from '../../app/format.js'
import { installationKindLabel, installationKindOf } from '../../app/labels.js'
import { RecordForm } from '../../app/record-form.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated, useSync } from '../../sync/provider.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'
import { AttachmentsSection } from './attachments.js'
import { BoardsSection } from './boards.js'
import { JobLine, NewJobForm } from './jobs.js'
import { asInstallation, installationFields } from './sites.js'

/**
 * One system in a building, and the boards below it.
 *
 * The boards are listed here and opened on a screen of their own, where the
 * sections, circuits and equipment are. The PV structure below a PV system,
 * inverters and strings, is not on this screen yet: it arrives with phase 2.
 */
export function InstallationScreen() {
  const { installationId } = useParams({ strict: false }) as { installationId?: string }
  const client = useSync()
  const installation = useRecord('installations', installationId)
  const site = useRecord('sites', installation ? String(installation['siteId']) : undefined)
  const customer = useRecord('customers', site ? String(site['customerId']) : undefined)
  const jobs = useRelated('jobs', 'installationId', installationId)
  const [editing, setEditing] = useState(false)
  const [addingJob, setAddingJob] = useState(false)

  if (!installation || !installationId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>Diese Anlage gibt es nicht mehr, oder dieses Gerät kennt sie noch nicht.</Nothing>
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
        </>
      }
      title={text(installation, 'designation')}
      meta={installationKindLabel[installationKindOf(installation)]}
      actions={
        <Button
          tone="secondary"
          onClick={() => {
            setEditing((open) => !open)
          }}
        >
          {editing ? 'Bearbeiten beenden' : 'Bearbeiten'}
        </Button>
      }
    >
      {editing ? (
        <Card label="Anlage bearbeiten">
          <RecordForm
            fields={installationFields}
            record={installation}
            submitLabel="Speichern"
            onCancel={() => {
              setEditing(false)
            }}
            onSubmit={async (values) => {
              const saved = await client.update(
                'installations',
                installationId,
                asInstallation(values),
              )

              if (saved.outcome === 'queued') {
                setEditing(false)
              }

              return saved
            }}
          />
        </Card>
      ) : (
        <Card label="Anlage">
          <Facts>
            <Fact label="Objekt">
              {site ? (
                <Link
                  to={`/objekte/${String(site['id'])}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(site, 'designation')}
                </Link>
              ) : null}
            </Fact>
            <Fact label="Hersteller">{maybeText(installation, 'manufacturer')}</Fact>
            <Fact label="Typ">{maybeText(installation, 'model')}</Fact>
            <Fact label="Seriennummer">{maybeText(installation, 'serialNumber')}</Fact>
            <Fact label="In Betrieb seit">{date(installation['commissionedOn'])}</Fact>
            <Fact label="Gewährleistung bis">{date(installation['warrantyEndsOn'])}</Fact>
            <Fact label="Notizen">{maybeText(installation, 'notes')}</Fact>
          </Facts>
        </Card>
      )}

      <BoardsSection installationId={installationId} />

      <Section
        title="Aufträge"
        actions={
          customer ? (
            <Button
              tone="secondary"
              onClick={() => {
                setAddingJob((open) => !open)
              }}
            >
              {addingJob ? 'Abbrechen' : 'Auftrag anlegen'}
            </Button>
          ) : null
        }
      >
        {addingJob && customer && site ? (
          <div className="mb-4">
            <NewJobForm
              customerId={String(customer['id'])}
              siteId={String(site['id'])}
              installationId={installationId}
              onDone={() => {
                setAddingJob(false)
              }}
            />
          </div>
        ) : null}

        {jobs.length === 0 ? (
          <Nothing>An dieser Anlage wurde noch kein Auftrag angelegt.</Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <JobLine key={String(job['id'])} job={job} />
            ))}
          </ul>
        )}
      </Section>

      <AttachmentsSection
        field="installationId"
        id={installationId}
        home={{
          customerId: customer ? String(customer['id']) : null,
          siteId: site ? String(site['id']) : null,
          installationId,
        }}
        empty="Noch keine Datei an der Anlage, etwa ein Schaltplan oder das Foto des Typenschilds."
      />
    </Page>
  )
}
