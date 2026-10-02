import {
  businessNameMaxLength,
  businessNameProblem,
  type InstanceTenantView,
} from '@opengewerk/domain'
import { Button, Cell, Column, Field, Panel, TablePanel } from '@opengewerk/platform-web'
import type { TableCard } from '@opengewerk/platform-web'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { date } from '../../app/format.js'
import { accountQuery } from '../../app/queries.js'
import { createTenantFor, instanceTenants } from '../../session/instance.js'
import { invitationPath } from '../../session/session.js'
import { SettingsText } from '../settings-frame.js'
import { InstancePage } from './shell.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** A business made for somebody else, and the link that makes them its owner, shown once. */
interface Made {
  readonly name: string
  readonly owner: string
  readonly link: string
}

/**
 * The businesses on the instance (#142 in the area of #188), `instanz_betriebe()`
 * of the canvas: each with the day it was made, its owners and how many
 * people work in it, and nothing of what is in it. A new one for somebody
 * else is made here, with an invitation to be its owner; one for oneself is
 * made under "Konto", where one is its owner at once.
 */
export function InstanceTenantsScreen() {
  const queries = useQueryClient()
  const tenants = useQuery({ queryKey: ['instance-tenants'], queryFn: instanceTenants })
  const account = useQuery(accountQuery)
  const [creating, setCreating] = useState(false)
  const [made, setMade] = useState<Made | null>(null)
  const me = account.data?.email.toLowerCase() ?? null

  const cards: readonly TableCard[] = (tenants.data ?? []).map((tenant) => ({
    key: tenant.id,
    title: tenant.name,
    sub: `Angelegt am ${date(tenant.createdAt)} · ${String(tenant.members)} ${tenant.members === 1 ? 'Zugang' : 'Zugänge'}`,
    form: <Owners tenant={tenant} me={me} inBox />,
  }))

  return (
    <InstancePage
      title="Betriebe"
      sub="Die Betriebe auf dieser Instanz. Jeder ist vom anderen getrennt wie zwei fremde."
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
          Betrieb anlegen
        </Button>
      }
    >
      {creating ? (
        <Panel title="Betrieb anlegen" roomy>
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
        <TablePanel
          caption="Die Betriebe auf dieser Instanz"
          cards={cards}
          note="Was in einem Betrieb steht, sieht hier niemand, auch wer die Instanz betreibt nicht: nur sein Name, der Tag der Anlage und wer darin Inhaber ist."
        >
          <thead>
            <tr>
              <Column>Betrieb</Column>
              <Column className="w-[110px]">Angelegt</Column>
              <Column className="w-[240px]">Inhaber</Column>
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
                  <Owners tenant={tenant} me={me} />
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

/** The owners of a business, "du" beside oneself, or the invitation still open. */
function Owners({
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
      {tenant.leads.map((owner) => (
        <span key={owner.email} className="block">
          <span className={`block text-[14px] font-medium ${breaks}`}>
            {owner.name}
            {owner.email.toLowerCase() === me ? (
              <span className="ml-1.5 text-[12px] font-bold text-copper-text">du</span>
            ) : null}
          </span>
          <span className={`block text-[12px] text-ink-faint ${breaks}`}>{owner.email}</span>
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
  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [tried, setTried] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const nameProblem = businessNameProblem(name) ?? undefined
  const ownerProblem = ownerName.trim() === '' ? 'Der Name des Inhabers fehlt.' : undefined
  const mailProblem = ownerEmail.includes('@')
    ? undefined
    : 'Die E-Mail-Adresse sieht nicht wie eine aus.'

  const create = useMutation({
    mutationFn: () => createTenantFor({ name, ownerName, ownerEmail }),
    onSuccess: (answer) => {
      onMade({
        name: name.trim(),
        owner: ownerName.trim(),
        link: `${globalThis.location.origin}${invitationPath}/${answer.token}`,
      })
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Der Betrieb ließ sich nicht anlegen.'))
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    setTrouble(null)

    if (nameProblem || ownerProblem || mailProblem) {
      return
    }

    create.mutate()
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <Field
          label="Name des Betriebs"
          value={name}
          maxLength={businessNameMaxLength}
          {...(tried && nameProblem ? { problem: nameProblem } : {})}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <Field
          label="Name des Inhabers"
          value={ownerName}
          autoComplete="off"
          {...(tried && ownerProblem ? { problem: ownerProblem } : {})}
          onChange={(event) => {
            setOwnerName(event.target.value)
          }}
        />
        <Field
          label="E-Mail des Inhabers"
          type="email"
          value={ownerEmail}
          autoComplete="off"
          hint="Der Link macht die Person zum Inhaber. Hat sie schon ein Konto auf dieser Instanz, meldet sie sich damit an."
          {...(tried && mailProblem ? { problem: mailProblem } : {})}
          onChange={(event) => {
            setOwnerEmail(event.target.value)
          }}
        />
      </div>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SettingsText muted>
          Einen Betrieb für dich selbst legst du unter „Konto“ an, dort bist du gleich Inhaber.
        </SettingsText>
        <div className="grow" />
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button tone="primary" type="submit" icon={Plus} disabled={create.isPending}>
          Betrieb anlegen
        </Button>
      </div>
    </form>
  )
}

/** The link that makes somebody the owner, shown once, as the office shows an invitation (#63). */
function MadeLink({ made, onDone }: { readonly made: Made; readonly onDone: () => void }) {
  return (
    <Panel title="Betrieb anlegen" roomy>
      <div className="flex flex-col gap-2.5">
        <p role="status" className="flex items-center gap-2 text-[14px] text-done">
          <Check size={16} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
          <strong>{made.name} ist angelegt.</strong>
        </p>
        <div className="flex flex-col gap-2 rounded-[5px] border border-line bg-surface-sunken px-3 py-2.5">
          <SettingsText small>
            {`Diesen Link an ${made.owner} geben. Er ist nur jetzt zu sehen, gilt einmal und sieben Tage lang, und wer ihn öffnet, wird Inhaber des neuen Betriebs.`}
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
