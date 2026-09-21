import { customerKinds } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Card } from '../../components/index.js'
import { DataTable } from '../../app/data-table.js'
import type { ListColumns } from '../../app/data-table.js'
import { addressLine } from '../../app/format.js'
import { customerKindLabel, customerKindOf } from '../../app/labels.js'
import { RecordForm, asBoolean, asTextOrNull, yesOrNo } from '../../app/record-form.js'
import type { FormField } from '../../app/record-form.js'
import { count, maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync, useSyncStatus } from '../../sync/provider.js'
import { Crumb, Fact, Facts, Nothing, Page, Section } from '../layout.js'
import { JobLine, NewJobForm } from './jobs.js'

const kindOptions = customerKinds.map((kind) => ({
  value: kind,
  label: customerKindLabel[kind],
}))

/**
 * What a customer is made of, for the form.
 *
 * The tax attributes are in the list and are not decoration. They decide how a
 * document has to be written, section 13b above all, and they sit on the
 * customer rather than in a settings screen for exactly that reason. Leaving
 * them out of the form would mean the only way to set them is a database
 * client.
 */
const customerFields: readonly FormField[] = [
  { name: 'name', label: 'Name', required: true },
  { name: 'kind', label: 'Art', options: kindOptions, required: true },
  { name: 'email', label: 'E-Mail', kind: 'email' },
  { name: 'phone', label: 'Telefon', kind: 'tel' },
  { name: 'street', label: 'Straße' },
  { name: 'houseNumber', label: 'Hausnummer' },
  { name: 'postalCode', label: 'PLZ', numeric: true },
  { name: 'city', label: 'Ort' },
  { name: 'vatId', label: 'USt-IdNr.', hint: 'Zum Beispiel DE123456789.' },
  {
    name: 'buyerReference',
    label: 'Käuferreferenz',
    hint: 'Braucht die XRechnung. Eine Behörde nennt hier ihre Leitweg-ID.',
  },
  {
    name: 'isBusiness',
    label: 'Unternehmen im Sinne der Umsatzsteuer',
    options: [...yesOrNo],
    hint: 'Entscheidet über die Pflicht zur E-Rechnung.',
  },
  {
    name: 'isConstructionServiceRecipient',
    label: 'Bauleistungsempfänger nach §13b UStG',
    options: [...yesOrNo],
    hint: 'Dann geht die Steuerschuld auf den Kunden über.',
  },
  { name: 'notes', label: 'Notizen' },
]

/** The values a form collected, in the types the record wants. */
function asCustomer(values: Record<string, string>) {
  return {
    name: values['name']?.trim() ?? '',
    kind: values['kind'] ?? 'private',
    email: asTextOrNull(values['email']),
    phone: asTextOrNull(values['phone']),
    street: asTextOrNull(values['street']),
    houseNumber: asTextOrNull(values['houseNumber']),
    postalCode: asTextOrNull(values['postalCode']),
    city: asTextOrNull(values['city']),
    vatId: asTextOrNull(values['vatId']),
    buyerReference: asTextOrNull(values['buyerReference']),
    isBusiness: asBoolean(values['isBusiness']),
    isConstructionServiceRecipient: asBoolean(values['isConstructionServiceRecipient']),
    notes: asTextOrNull(values['notes']),
  }
}

const columns: ListColumns = [
  { id: 'name', accessorFn: (row) => text(row, 'name'), header: 'Name' },
  {
    id: 'kind',
    accessorFn: (row) => customerKindLabel[customerKindOf(row)],
    header: 'Art',
  },
  { id: 'address', accessorFn: (row) => addressLine(row), header: 'Anschrift' },
  { id: 'phone', accessorFn: (row) => text(row, 'phone'), header: 'Telefon' },
]

export function CustomerList() {
  const customers = useRecords('customers')
  const [adding, setAdding] = useState(false)
  const client = useSync()
  const navigate = useNavigate()

  const sorted = useMemo(
    () =>
      [...customers].sort((left, right) =>
        text(left, 'name').localeCompare(text(right, 'name'), 'de'),
      ),
    [customers],
  )

  return (
    <Page
      title="Kunden"
      meta="Privat, gewerblich, Hausverwaltung, Generalunternehmer."
      actions={
        <Button
          tone="primary"
          onClick={() => {
            setAdding((open) => !open)
          }}
        >
          {adding ? 'Formular schließen' : 'Kunde anlegen'}
        </Button>
      }
    >
      {adding ? (
        <Card
          label="Neuer Kunde"
          heading={<h2 className="text-body font-semibold">Neuer Kunde</h2>}
        >
          <RecordForm
            fields={customerFields}
            submitLabel="Anlegen"
            onCancel={() => {
              setAdding(false)
            }}
            onSubmit={async (values) => {
              const made = await client.create('customers', {
                ...asCustomer(values),
                country: 'DE',
              })

              if (made.outcome === 'queued') {
                setAdding(false)
                await navigate({ to: `/kunden/${made.id}` })
              }

              return made
            }}
          />
        </Card>
      ) : null}

      <DataTable
        caption="Alle Kunden des Betriebs"
        rows={sorted}
        columns={columns}
        searchLabel="Kunden suchen"
        hrefFor={(row) => `/kunden/${String(row['id'])}`}
        empty="Noch kein Kunde angelegt. Der erste entsteht über den Knopf oben."
      />
    </Page>
  )
}

export function CustomerScreen() {
  const { customerId } = useParams({ strict: false }) as { customerId?: string }
  const client = useSync()
  const status = useSyncStatus()
  const customer = useRecord('customers', customerId)
  const sites = useRelated('sites', 'customerId', customerId)
  const jobs = useRelated('jobs', 'customerId', customerId)
  const [editing, setEditing] = useState(false)
  const [addingSite, setAddingSite] = useState(false)
  const [addingJob, setAddingJob] = useState(false)

  if (!customer || !customerId) {
    return (
      <Page title="Nicht gefunden">
        <Nothing>Diesen Kunden gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.</Nothing>
      </Page>
    )
  }

  const pending = client.isPending('customers', customerId)

  return (
    <Page
      crumbs={<Crumb to="/">Kunden</Crumb>}
      title={text(customer, 'name')}
      meta={
        <>
          {customerKindLabel[customerKindOf(customer)]}
          {pending ? ' · noch nicht übertragen' : ''}
        </>
      }
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
        <Card label="Kunde bearbeiten">
          <RecordForm
            fields={customerFields}
            record={customer}
            submitLabel="Speichern"
            disabled={client.needsConnection('customers') && !status.online}
            // Master data is only corrected with a connection, which ADR 0005
            // decides and this says out loud before somebody fills in a form
            // that cannot be sent.
            disabledReason={
              client.needsConnection('customers') && !status.online
                ? 'Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.'
                : undefined
            }
            onCancel={() => {
              setEditing(false)
            }}
            onSubmit={async (values) => {
              const saved = await client.update('customers', customerId, asCustomer(values))

              if (saved.outcome === 'queued') {
                setEditing(false)
              }

              return saved
            }}
          />
        </Card>
      ) : (
        <Card label="Stammdaten">
          <Facts>
            <Fact label="Anschrift">{addressLine(customer)}</Fact>
            <Fact label="E-Mail">{maybeText(customer, 'email')}</Fact>
            <Fact label="Telefon">{maybeText(customer, 'phone')}</Fact>
            <Fact label="USt-IdNr.">{maybeText(customer, 'vatId')}</Fact>
            <Fact label="Käuferreferenz">{maybeText(customer, 'buyerReference')}</Fact>
            <Fact label="Unternehmen">{customer['isBusiness'] === true ? 'Ja' : 'Nein'}</Fact>
            <Fact label="Bauleistungsempfänger">
              {customer['isConstructionServiceRecipient'] === true ? 'Ja' : 'Nein'}
            </Fact>
            <Fact label="Notizen">{maybeText(customer, 'notes')}</Fact>
          </Facts>
        </Card>
      )}

      <Section
        title="Objekte"
        actions={
          <Button
            tone="secondary"
            onClick={() => {
              setAddingSite((open) => !open)
            }}
          >
            {addingSite ? 'Abbrechen' : 'Objekt anlegen'}
          </Button>
        }
      >
        {addingSite ? (
          <div className="mb-4">
            <RecordForm
              fields={[
                { name: 'designation', label: 'Bezeichnung', required: true },
                { name: 'street', label: 'Straße' },
                { name: 'houseNumber', label: 'Hausnummer' },
                { name: 'postalCode', label: 'PLZ', numeric: true },
                { name: 'city', label: 'Ort' },
                { name: 'notes', label: 'Notizen' },
              ]}
              submitLabel="Anlegen"
              onCancel={() => {
                setAddingSite(false)
              }}
              onSubmit={async (values) => {
                const made = await client.create('sites', {
                  customerId,
                  designation: values['designation']?.trim() ?? '',
                  street: asTextOrNull(values['street']),
                  houseNumber: asTextOrNull(values['houseNumber']),
                  postalCode: asTextOrNull(values['postalCode']),
                  city: asTextOrNull(values['city']),
                  country: 'DE',
                  notes: asTextOrNull(values['notes']),
                })

                if (made.outcome === 'queued') {
                  setAddingSite(false)
                }

                return made
              }}
            />
          </div>
        ) : null}

        {sites.length === 0 ? (
          <Nothing>Noch kein Objekt. Ein Objekt ist das Gebäude, zu dem ein Auftrag fährt.</Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {sites.map((site) => (
              <li key={String(site['id'])}>
                <Link
                  to={`/objekte/${String(site['id'])}`}
                  className="text-copper-text font-semibold underline underline-offset-2"
                >
                  {text(site, 'designation')}
                </Link>
                <span className="text-ink-muted"> {addressLine(site)}</span>
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
              setAddingJob((open) => !open)
            }}
          >
            {addingJob ? 'Abbrechen' : 'Auftrag anlegen'}
          </Button>
        }
      >
        {addingJob ? (
          <div className="mb-4">
            <NewJobForm
              customerId={customerId}
              onDone={() => {
                setAddingJob(false)
              }}
            />
          </div>
        ) : null}

        {jobs.length === 0 ? (
          <Nothing>Für diesen Kunden läuft noch kein Auftrag.</Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <JobLine key={String(job['id'])} job={job} />
            ))}
          </ul>
        )}
      </Section>

      <p className="text-table text-ink-faint">
        {`Fassung ${String(count(customer, 'version'))}.`}
      </p>
    </Page>
  )
}
