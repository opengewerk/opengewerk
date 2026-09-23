import { installationKinds } from '@opengewerk/domain'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Card } from '../../components/index.js'
import { addressLine } from '../../app/format.js'
import { installationKindLabel, installationKindOf } from '../../app/labels.js'
import { RecordForm, asTextOrNull } from '../../app/record-form.js'
import type { FormField } from '../../app/record-form.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated, useSync, useSyncStatus } from '../../sync/provider.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'
import { AttachmentsSection } from './attachments.js'
import { ContactsSection } from './contacts.js'
import { JobLine, NewJobForm } from './jobs.js'
import { TasksSection } from './tasks.js'

const siteFields: readonly FormField[] = [
  {
    name: 'designation',
    label: 'Bezeichnung',
    required: true,
    hint: 'Wie die Leute vor Ort es nennen: Haus 3, Lager Nord.',
  },
  { name: 'street', label: 'Straße' },
  { name: 'houseNumber', label: 'Hausnummer' },
  { name: 'postalCode', label: 'PLZ', numeric: true },
  { name: 'city', label: 'Ort' },
  { name: 'notes', label: 'Notizen' },
]

export const installationFields: readonly FormField[] = [
  { name: 'designation', label: 'Bezeichnung', required: true },
  {
    name: 'kind',
    label: 'Art',
    required: true,
    options: installationKinds.map((kind) => ({ value: kind, label: installationKindLabel[kind] })),
  },
  { name: 'manufacturer', label: 'Hersteller' },
  { name: 'model', label: 'Typ' },
  { name: 'serialNumber', label: 'Seriennummer' },
  { name: 'commissionedOn', label: 'In Betrieb seit', kind: 'date' },
  {
    name: 'warrantyEndsOn',
    label: 'Gewährleistung bis',
    kind: 'date',
    hint: 'Die Fristen-Engine wacht später darüber.',
  },
  { name: 'notes', label: 'Notizen' },
]

export function asInstallation(values: Record<string, string>) {
  return {
    designation: values['designation']?.trim() ?? '',
    kind: values['kind'] ?? 'other',
    manufacturer: asTextOrNull(values['manufacturer']),
    model: asTextOrNull(values['model']),
    serialNumber: asTextOrNull(values['serialNumber']),
    commissionedOn: asTextOrNull(values['commissionedOn']),
    warrantyEndsOn: asTextOrNull(values['warrantyEndsOn']),
    notes: asTextOrNull(values['notes']),
  }
}

export function SiteScreen() {
  const { siteId } = useParams({ strict: false }) as { siteId?: string }
  const client = useSync()
  const status = useSyncStatus()
  const site = useRecord('sites', siteId)
  const customer = useRecord('customers', site ? String(site['customerId']) : undefined)
  const installations = useRelated('installations', 'siteId', siteId)
  const jobs = useRelated('jobs', 'siteId', siteId)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState<'installation' | 'job' | null>(null)

  if (!site || !siteId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>Dieses Objekt gibt es nicht mehr, oder dieses Gerät kennt es noch nicht.</Nothing>
      </Page>
    )
  }

  const customerId = String(site['customerId'])

  return (
    <Page
      crumbs={
        <>
          <Crumb to="/">Kunden</Crumb>
          {customer ? <Crumb to={`/kunden/${customerId}`}>{text(customer, 'name')}</Crumb> : null}
        </>
      }
      title={text(site, 'designation')}
      meta={addressLine(site)}
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
        <Card label="Objekt bearbeiten">
          <RecordForm
            fields={siteFields}
            record={site}
            submitLabel="Speichern"
            disabled={client.needsConnection('sites') && !status.online}
            disabledReason={
              client.needsConnection('sites') && !status.online
                ? 'Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.'
                : undefined
            }
            onCancel={() => {
              setEditing(false)
            }}
            onSubmit={async (values) => {
              const saved = await client.update('sites', siteId, {
                designation: values['designation']?.trim() ?? '',
                street: asTextOrNull(values['street']),
                houseNumber: asTextOrNull(values['houseNumber']),
                postalCode: asTextOrNull(values['postalCode']),
                city: asTextOrNull(values['city']),
                notes: asTextOrNull(values['notes']),
              })

              if (saved.outcome === 'queued') {
                setEditing(false)
              }

              return saved
            }}
          />
        </Card>
      ) : (
        <Card label="Objekt">
          <Facts>
            <Fact label="Kunde">
              {customer ? (
                <Link
                  to={`/kunden/${customerId}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(customer, 'name')}
                </Link>
              ) : null}
            </Fact>
            <Fact label="Anschrift">{addressLine(site)}</Fact>
            <Fact label="Notizen">{maybeText(site, 'notes')}</Fact>
          </Facts>
        </Card>
      )}

      <ContactsSection
        parent={{ siteId }}
        empty="Noch kein Ansprechpartner am Objekt. Etwa ein Mieter oder der Hausmeister."
      />

      <Section
        title="Anlagen"
        actions={
          <Button
            tone="secondary"
            onClick={() => {
              setAdding((open) => (open === 'installation' ? null : 'installation'))
            }}
          >
            {adding === 'installation' ? 'Abbrechen' : 'Anlage anlegen'}
          </Button>
        }
      >
        {adding === 'installation' ? (
          <div className="mb-4">
            <RecordForm
              fields={installationFields}
              submitLabel="Anlegen"
              onCancel={() => {
                setAdding(null)
              }}
              onSubmit={async (values) => {
                const made = await client.create('installations', {
                  ...asInstallation(values),
                  siteId,
                })

                if (made.outcome === 'queued') {
                  setAdding(null)
                }

                return made
              }}
            />
          </div>
        ) : null}

        {installations.length === 0 ? (
          <Nothing>
            Noch keine Anlage. Eine Anlage ist, was im Gebäude steht und betreut wird: PV, Speicher,
            Zähler, Zählerschrank, Wallbox, Heizung.
          </Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {installations.map((installation) => (
              <li key={String(installation['id'])} className="flex flex-wrap items-baseline gap-2">
                <Link
                  to={`/anlagen/${String(installation['id'])}`}
                  className="text-copper-text font-semibold underline underline-offset-2"
                >
                  {text(installation, 'designation')}
                </Link>
                <span className="text-ink-muted">
                  {installationKindLabel[installationKindOf(installation)]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Aufträge"
        actions={
          <Button
            tone="secondary"
            onClick={() => {
              setAdding((open) => (open === 'job' ? null : 'job'))
            }}
          >
            {adding === 'job' ? 'Abbrechen' : 'Auftrag anlegen'}
          </Button>
        }
      >
        {adding === 'job' ? (
          <div className="mb-4">
            <NewJobForm
              customerId={customerId}
              siteId={siteId}
              onDone={() => {
                setAdding(null)
              }}
            />
          </div>
        ) : null}

        {jobs.length === 0 ? (
          <Nothing>Für dieses Objekt läuft noch kein Auftrag.</Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <JobLine key={String(job['id'])} job={job} />
            ))}
          </ul>
        )}
      </Section>

      <AttachmentsSection
        field="siteId"
        id={siteId}
        home={{ customerId, siteId }}
        empty="Noch keine Datei am Objekt."
      />

      <TasksSection
        field="siteId"
        id={siteId}
        links={{ customerId, siteId }}
        empty="Für dieses Objekt ist keine Aufgabe offen."
      />
    </Page>
  )
}
