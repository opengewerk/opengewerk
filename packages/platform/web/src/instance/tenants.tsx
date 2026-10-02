import type { InstanceTenantView } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useApplication, useInstanceSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Field } from '../components/field.js'
import { Panel, TablePanel } from '../components/panel.js'
import type { TableCard } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { date } from '../format.js'
import { SettingsText } from '../office/settings.js'
import { createTenantFor, instanceTenants } from '../session/instance.js'
import { accountQuery } from '../session/queries.js'
import { invitationPath } from '../session/session.js'
import { RequestRefused } from '../sync/transport.js'
import { InstancePage } from './frame.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** A tenant made for somebody else, and the link that makes them lead it, shown once. */
interface Made {
  readonly name: string
  readonly lead: string
  readonly link: string
}

/**
 * The tenants on the instance (#142 in the area of #188), `instanz_betriebe()`
 * of the canvas: each with the day it was made, whoever leads it and how many
 * people work in it, and nothing of what is in it. A new one for somebody
 * else is made here, with an invitation to lead it; one for oneself is made
 * where the application says, where one leads it at once.
 */
export function InstanceTenantsScreen() {
  const sentences = useInstanceSentences().tenants
  const queries = useQueryClient()
  const tenants = useQuery({ queryKey: ['instance-tenants'], queryFn: instanceTenants })
  const account = useQuery(accountQuery)
  const [creating, setCreating] = useState(false)
  const [made, setMade] = useState<Made | null>(null)
  const me = account.data?.email.toLowerCase() ?? null

  // On a phone a box per tenant with everything in it, as the operators have
  // theirs: whoever leads it takes more than a line, so the box is drawn here
  // and not from a title and a line under it. A `form` stands in the place of
  // the whole box, and with the name only in `title` the name was lost (#490).
  const cards: readonly TableCard[] = (tenants.data ?? []).map((tenant) => ({
    key: tenant.id,
    title: '',
    form: (
      <div className="flex flex-col gap-2 text-[15px]">
        <span className="block font-semibold [overflow-wrap:anywhere]">{tenant.name}</span>
        <span className="text-[13px] text-ink-muted">
          {`Angelegt am ${date(tenant.createdAt)} · ${String(tenant.members)} ${tenant.members === 1 ? 'Zugang' : 'Zugänge'}`}
        </span>
        <div>
          <Leads tenant={tenant} me={me} inBox />
        </div>
      </div>
    ),
  }))

  return (
    <InstancePage
      title={sentences.title}
      sub={sentences.what}
      actions={
        <Button
          tone="primary"
          icon={Plus}
          disabled={creating}
          onClick={() => {
            setMade(null)
            setCreating(true)
          }}
        >
          {sentences.create}
        </Button>
      }
    >
      {creating ? (
        <Panel title={sentences.create} roomy>
          <CreateForm
            onMade={(result) => {
              setCreating(false)
              setMade(result)
              void queries.invalidateQueries({ queryKey: ['instance-tenants'] })
            }}
            onCancel={() => {
              setCreating(false)
            }}
          />
        </Panel>
      ) : null}

      {made ? (
        <MadeLink
          made={made}
          onDone={() => {
            setMade(null)
          }}
        />
      ) : null}

      {tenants.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : tenants.isError ? (
        <SettingsText muted>{saidWhy(tenants.error, 'Die Liste kam nicht an.')}</SettingsText>
      ) : (
        <TablePanel caption={sentences.caption} cards={cards} note={sentences.note}>
          <thead>
            <tr>
              <Column>{sentences.tenantColumn}</Column>
              <Column className="w-[110px]">Angelegt</Column>
              <Column className="w-[240px]">{sentences.leadsColumn}</Column>
              <Column numeric className="w-[80px]">
                Zugänge
              </Column>
            </tr>
          </thead>
          <tbody>
            {tenants.data.map((tenant) => (
              <tr key={tenant.id}>
                <Cell className="font-semibold">{tenant.name}</Cell>
                <Cell className="text-[13px]">{date(tenant.createdAt)}</Cell>
                <Cell>
                  <Leads tenant={tenant} me={me} />
                </Cell>
                <Cell numeric>{tenant.members}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </InstancePage>
  )
}

/** Whoever leads a tenant, "du" beside oneself, or the invitation still open. */
function Leads({
  tenant,
  me,
  inBox = false,
}: {
  readonly tenant: InstanceTenantView
  readonly me: string | null
  readonly inBox?: boolean
}) {
  const breaks = inBox ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap'

  if (tenant.leads.length === 0) {
    const invited = tenant.invitedLeads[0]

    return invited ? (
      <>
        <span className="block text-[14px] text-waiting">Einladung offen</span>
        <span className={`block text-[12px] text-ink-faint ${breaks}`}>{invited}</span>
      </>
    ) : (
      <span className="text-[14px] text-ink-faint">Niemand</span>
    )
  }

  return (
    <>
      {tenant.leads.map((lead) => (
        <span key={lead.email} className="block">
          <span className={`block text-[14px] font-medium ${breaks}`}>
            {lead.name}
            {lead.email.toLowerCase() === me ? (
              <span className="ml-1.5 text-[12px] font-bold text-copper-text">du</span>
            ) : null}
          </span>
          <span className={`block text-[12px] text-ink-faint ${breaks}`}>{lead.email}</span>
        </span>
      ))}
    </>
  )
}

function CreateForm({
  onMade,
  onCancel,
}: {
  readonly onMade: (made: Made) => void
  readonly onCancel: () => void
}) {
  const { tenantNameMaxLength, tenantNameProblem } = useApplication()
  const sentences = useInstanceSentences().tenants
  const [name, setName] = useState('')
  const [leadName, setLeadName] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [tried, setTried] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const nameProblem = tenantNameProblem(name) ?? undefined
  const leadProblem = leadName.trim() === '' ? sentences.leadNameMissing : undefined
  const mailProblem = leadEmail.includes('@')
    ? undefined
    : 'Die E-Mail-Adresse sieht nicht wie eine aus.'

  const create = useMutation({
    mutationFn: () => createTenantFor({ name, leadName, leadEmail }),
    onSuccess: (answer) => {
      onMade({
        name: name.trim(),
        lead: leadName.trim(),
        link: `${globalThis.location.origin}${invitationPath}/${answer.token}`,
      })
    },
    onError: (error) => {
      setTrouble(saidWhy(error, sentences.notCreated))
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    setTrouble(null)

    if (nameProblem || leadProblem || mailProblem) {
      return
    }

    create.mutate()
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <Field
          label={sentences.nameLabel}
          value={name}
          maxLength={tenantNameMaxLength}
          {...(tried && nameProblem ? { problem: nameProblem } : {})}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <Field
          label={sentences.leadNameLabel}
          value={leadName}
          autoComplete="off"
          {...(tried && leadProblem ? { problem: leadProblem } : {})}
          onChange={(event) => {
            setLeadName(event.target.value)
          }}
        />
        <Field
          label={sentences.leadEmailLabel}
          type="email"
          value={leadEmail}
          autoComplete="off"
          hint={sentences.leadEmailHint}
          {...(tried && mailProblem ? { problem: mailProblem } : {})}
          onChange={(event) => {
            setLeadEmail(event.target.value)
          }}
        />
      </div>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SettingsText muted>{sentences.forOneself}</SettingsText>
        <div className="grow" />
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button tone="primary" type="submit" icon={Plus} disabled={create.isPending}>
          {sentences.create}
        </Button>
      </div>
    </form>
  )
}

/**
 * The link that makes somebody lead the new tenant, shown once, as an
 * invitation into a tenant is shown (#63). That it is shown only now and
 * holds once for seven days is the foundation's to say, what it makes of the
 * person the application's.
 */
function MadeLink({ made, onDone }: { readonly made: Made; readonly onDone: () => void }) {
  const sentences = useInstanceSentences().tenants

  return (
    <Panel title={sentences.create} roomy>
      <div className="flex flex-col gap-2.5">
        <p role="status" className="flex items-center gap-2 text-[14px] text-done">
          <Check size={16} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
          <strong>{made.name} ist angelegt.</strong>
        </p>
        <div className="flex flex-col gap-2 rounded-[5px] border border-line bg-surface-sunken px-3 py-2.5">
          <SettingsText small>
            {`Diesen Link an ${made.lead} geben. Er ist nur jetzt zu sehen, gilt einmal und sieben Tage lang, und ${sentences.linkMakes}`}
          </SettingsText>
          <div className="flex items-end gap-2">
            <div className="min-w-0 grow">
              <Field
                label="Einladungslink"
                readOnly
                value={made.link}
                onFocus={(event) => {
                  event.target.select()
                }}
              />
            </div>
            <Button
              icon={Copy}
              onClick={() => {
                void navigator.clipboard?.writeText(made.link)
              }}
            >
              Kopieren
            </Button>
          </div>
        </div>
        <div className="flex">
          <div className="grow" />
          <Button onClick={onDone}>Fertig</Button>
        </div>
      </div>
    </Panel>
  )
}
