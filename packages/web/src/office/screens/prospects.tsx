import {
  conversionProblem,
  customerKinds,
  type IsoDate,
  isConverted,
  prospectProblems,
  type ProspectSource,
  prospectSourceLabel,
  prospectSources,
  type ProspectStage,
  prospectStageLabel,
  prospectStages,
  type RecordState,
  siteDesignationOf,
} from '@opengewerk/domain'
import {
  Button,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  Status,
  type StatusTone,
  TextArea,
  useButtonLook,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  Empty,
  FactList,
  ListCard,
  ListScreen,
  NoteBox,
  PageHead,
  RecordColumns,
  Screen,
} from '@opengewerk/platform-web/office'
import type { ListColumn, ListFilter } from '@opengewerk/platform-web/office'
import {
  RequestRefused,
  text,
  useRecord,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { Check, Funnel, Pencil, Phone, Plus, Trash2, Users, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { addressLine, countryOptions } from '../../app/format.js'
import { customerKindLabel } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import {
  convertProspect,
  createProspect,
  prospect,
  prospectKey,
  prospects,
  type ProspectEntry,
  prospectsKey,
  type ProspectValues,
  removeProspect,
  updateProspect,
} from '../../session/prospects.js'

/** Where the leads live, said wherever the network is missing. */
export const prospectsOffline = 'Die Leads liegen auf dem Server, dafür braucht es Verbindung.'

function asRow(entry: ProspectEntry): RecordState {
  return entry as unknown as RecordState
}

function entryOf(row: RecordState): ProspectEntry {
  return row as unknown as ProspectEntry
}

/** How a lead stands, as a pill: its stage, or the customer it became. */
export function prospectStanding(entry: Pick<ProspectEntry, 'customerId' | 'stage'>): {
  readonly text: string
  readonly tone: StatusTone
  readonly icon?: LucideIcon
} {
  if (isConverted(entry)) {
    return { text: 'Kunde geworden', tone: 'done', icon: Users }
  }

  const tones: Readonly<Record<ProspectStage, { tone: StatusTone; icon?: LucideIcon }>> = {
    new: { tone: 'neutral' },
    contacted: { tone: 'waiting', icon: Phone },
    qualified: { tone: 'done' },
    dismissed: { tone: 'neutral', icon: X },
  }

  return { text: prospectStageLabel[entry.stage], ...tones[entry.stage] }
}

export function ProspectStatus({
  entry,
}: {
  readonly entry: Pick<ProspectEntry, 'customerId' | 'stage'>
}) {
  const standing = prospectStanding(entry)

  return (
    <Status tone={standing.tone} {...(standing.icon ? { icon: standing.icon } : {})}>
      {standing.text}
    </Status>
  )
}

export function useProspects() {
  const { online } = useSyncStatus()
  const reads = useMay('prospect.read')

  return useQuery({
    queryKey: prospectsKey,
    queryFn: () => prospects(),
    enabled: online && reads,
  })
}

const filters: readonly ListFilter[] = [
  {
    id: 'open',
    label: 'Offen',
    test: (row) => !isConverted(entryOf(row)) && entryOf(row).stage !== 'dismissed',
  },
  { id: 'customer', label: 'Kunde geworden', test: (row) => isConverted(entryOf(row)) },
  {
    id: 'dismissed',
    label: 'Abgesagt',
    test: (row) => !isConverted(entryOf(row)) && entryOf(row).stage === 'dismissed',
  },
]

/**
 * The leads of the business (#312), the board "Leads": who asked, what for,
 * where they came from, how far it is and the last contact. Reached from the
 * pipeline under "Vertrieb".
 */
export function ProspectList() {
  const { online } = useSyncStatus()
  const writes = useMay('prospect.write')
  const navigate = useNavigate()
  const list = useProspects()
  const columns: readonly ListColumn[] = [
    { id: 'name', header: 'Name', value: (row) => entryOf(row).name, width: 'w-[250px]' },
    { id: 'concern', header: 'Anliegen', value: (row) => entryOf(row).concern ?? '' },
    {
      id: 'source',
      header: 'Quelle',
      value: (row) => prospectSourceLabel[entryOf(row).source],
      width: 'w-[120px]',
    },
    {
      id: 'stage',
      header: 'Stand',
      value: (row) => prospectStanding(entryOf(row)).text,
      cell: (row) => <ProspectStatus entry={entryOf(row)} />,
      width: 'w-[150px]',
    },
    {
      id: 'contact',
      header: 'Letzter Kontakt',
      value: (row) => date(entryOf(row).lastContactOn),
      width: 'w-[130px]',
    },
  ]
  const hint =
    'Ein Lead ist eine Anfrage, bevor ein Kunde entsteht. Wird er Kunde, entstehen Kunde und Objekt aus seinen Angaben, und die Quelle bleibt am Kunden.'

  return (
    <ListScreen
      title="Leads"
      caption="Alle Leads des Betriebs"
      rows={(list.data ?? []).map(asRow)}
      columns={columns}
      hrefFor={(row) => `/leads/${entryOf(row).id}`}
      searchLabel="Leads durchsuchen"
      searchPlaceholder="Name, Anliegen, Ort …"
      alsoSearched={(row) => [entryOf(row).city ?? '', entryOf(row).postalCode ?? ''].join(' ')}
      filters={filters}
      sorts={[
        {
          id: 'contact',
          label: 'Letzter Kontakt',
          compare: (left, right) =>
            entryOf(right).lastContactOn.localeCompare(entryOf(left).lastContactOn),
        },
      ]}
      {...(writes
        ? {
            primary: {
              label: 'Lead erfassen',
              onPress: () => {
                void navigate({ to: '/leads/neu' })
              },
            },
          }
        : {})}
      card={(row) => {
        const entry = entryOf(row)

        return (
          <ListCard
            to={`/leads/${entry.id}`}
            title={entry.name}
            sub={[entry.concern, prospectStanding(entry).text].filter(Boolean).join(', ')}
          />
        )
      }}
      note={
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {online ? hint : prospectsOffline}
        </p>
      }
      empty={{ icon: Funnel, title: 'Noch kein Lead', text: hint }}
    />
  )
}

function Frame({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Screen>
      <PageHead
        title={title}
        crumbs={[
          { to: '/vertrieb', label: 'Vertrieb' },
          { to: '/leads', label: 'Leads' },
        ]}
      />
      <Empty>{children}</Empty>
    </Screen>
  )
}

function useProspect(prospectId: string | undefined) {
  const { online } = useSyncStatus()

  return useQuery({
    queryKey: prospectKey(prospectId ?? ''),
    queryFn: () => prospect(prospectId ?? ''),
    enabled: online && prospectId !== undefined,
    retry: false,
  })
}

/** One lead, the board "Lead": what they want, the facts, and making a customer of it. */
export function ProspectScreen() {
  const { prospectId } = useParams({ strict: false }) as { prospectId?: string }
  const { online } = useSyncStatus()
  const one = useProspect(prospectId)

  if (!online) {
    return <Frame title="Leads">{prospectsOffline}</Frame>
  }

  if (one.isError) {
    return <Frame title="Nicht gefunden">Diesen Lead gibt es nicht mehr.</Frame>
  }

  if (!one.data) {
    return null
  }

  return <ProspectView key={one.data.id} entry={one.data} />
}

function ProspectView({ entry }: { readonly entry: ProspectEntry }) {
  const writes = useMay('prospect.write')
  const createsCustomers = useMay('customer.create')
  const keepsSites = useMay('site.write')
  const makesCustomers = createsCustomers && keepsSites
  const navigate = useNavigate()
  const queries = useQueryClient()
  const look = useButtonLook()
  const customer = useRecord('customers', entry.customerId ?? undefined)
  const site = useRecord('sites', entry.siteId ?? undefined)
  const [asking, setAsking] = useState(false)
  const [converting, setConverting] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const converted = isConverted(entry)

  async function remove() {
    setTrouble(null)

    try {
      await removeProspect(entry.id)
      await queries.invalidateQueries({ queryKey: prospectsKey })
      await navigate({ to: '/leads' })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : 'Das hat nicht geklappt.')
    }
  }

  const facts = [
    { label: 'Art', value: customerKindLabel[entry.kind] },
    { label: 'Anschrift', value: addressLine(asRow(entry)) },
    {
      label: 'E-Mail',
      value: entry.email ? (
        <a href={`mailto:${entry.email}`} className="text-copper-text">
          {entry.email}
        </a>
      ) : (
        ''
      ),
    },
    { label: 'Telefon', value: entry.phone ?? '' },
    { label: 'Quelle', value: prospectSourceLabel[entry.source] },
    { label: 'Stand', value: prospectStageLabel[entry.stage] },
    { label: 'Letzter Kontakt', value: date(entry.lastContactOn) },
    { label: 'Erfasst am', value: date(entry.createdAt.slice(0, 10)) },
  ]

  return (
    <Screen>
      <PageHead
        title={entry.name}
        crumbs={[
          { to: '/vertrieb', label: 'Vertrieb' },
          { to: '/leads', label: 'Leads' },
        ]}
        badges={
          <>
            <ProspectStatus entry={entry} />
            <span className="text-[13px] text-ink-faint">
              {prospectSourceLabel[entry.source]} · erfasst am {date(entry.createdAt.slice(0, 10))}
            </span>
          </>
        }
        actions={
          writes && !converted ? (
            <>
              <Button
                icon={Trash2}
                onClick={() => {
                  setAsking(true)
                }}
              >
                Löschen
              </Button>
              <Link to={`/leads/${entry.id}/bearbeiten`} className={look}>
                <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
                Bearbeiten
              </Link>
              {makesCustomers ? (
                <Button
                  tone="primary"
                  icon={Plus}
                  onClick={() => {
                    setTrouble(conversionProblem(entry))

                    if (conversionProblem(entry) === null) {
                      setConverting(true)
                    }
                  }}
                >
                  Kunde anlegen
                </Button>
              ) : null}
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
            <Panel title="Anliegen">
              {entry.concern ? (
                <p className="whitespace-pre-line text-[14px] leading-[1.5]">{entry.concern}</p>
              ) : (
                <p className="text-[13px] text-ink-muted">Kein Anliegen eingetragen.</p>
              )}
            </Panel>
            {converted ? (
              <NoteBox tone="done" icon={Users}>
                {entry.convertedAt ? `Am ${date(entry.convertedAt.slice(0, 10))} ` : ''}
                ist aus dem Lead ein Kunde geworden
                {customer ? (
                  <>
                    {': '}
                    <Link to={`/kunden/${text(customer, 'id')}`} className="text-copper-text">
                      {text(customer, 'name')}
                    </Link>
                  </>
                ) : null}
                {site ? (
                  <>
                    {', mit dem Objekt '}
                    <Link to={`/objekte/${text(site, 'id')}`} className="text-copper-text">
                      {text(site, 'designation')}
                    </Link>
                  </>
                ) : null}
                . Geändert wird jetzt der Kunde.
              </NoteBox>
            ) : (
              <NoteBox tone="neutral">
                Wird der Lead Kunde, entstehen Kunde und Objekt aus seinen Angaben. Danach steht er
                unter „Kunde geworden“ und ändert sich nicht mehr.
              </NoteBox>
            )}
          </div>
        }
        side={
          <Panel title="Lead">
            <FactList keyWidth={120} facts={facts} />
          </Panel>
        }
      />

      <Confirm
        open={asking}
        title={`${entry.name} löschen?`}
        confirm="Löschen"
        tone="danger"
        onConfirm={() => {
          setAsking(false)
          void remove()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        Der Lead ist danach weg. Das Änderungsprotokoll hält fest, dass er gelöscht wurde.
      </Confirm>

      {converting ? (
        <ConversionDialog
          entry={entry}
          onClose={() => {
            setConverting(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/**
 * Making the customer and the site out of the lead, the board "Kunde aus
 * dem Lead anlegen": what the customer gets, and what the site is called and
 * where it lies.
 */
function ConversionDialog({
  entry,
  onClose,
}: {
  readonly entry: ProspectEntry
  readonly onClose: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const queries = useQueryClient()
  const [designation, setDesignation] = useState(siteDesignationOf(entry))
  const [sameAddress, setSameAddress] = useState(true)
  const [address, setAddress] = useState({
    street: '',
    houseNumber: '',
    postalCode: '',
    city: '',
    country: 'DE',
  })
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const nameless = designation.trim() === ''

  async function convert(event: FormEvent) {
    event.preventDefault()

    if (nameless) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const converted = await convertProspect(
        entry.id,
        designation.trim(),
        sameAddress
          ? null
          : {
              street: address.street.trim() || null,
              houseNumber: address.houseNumber.trim() || null,
              postalCode: address.postalCode.trim() || null,
              city: address.city.trim() || null,
              country: address.country,
            },
      )

      await queries.invalidateQueries({ queryKey: prospectsKey })
      // The customer and the site are records of the device: they arrive with the exchange.
      await client.synchronise().catch(() => undefined)
      await navigate({ to: `/kunden/${String(converted.customerId)}` })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : 'Keine Verbindung. Ein Kunde entsteht mit Verbindung.',
      )
    } finally {
      setWorking(false)
    }
  }

  const facts = [
    { label: 'Name', value: entry.name },
    { label: 'Art', value: customerKindLabel[entry.kind] },
    { label: 'Anschrift', value: addressLine(asRow(entry)) },
    { label: 'E-Mail', value: entry.email ?? '' },
    { label: 'Telefon', value: entry.phone ?? '' },
    { label: 'Quelle', value: prospectSourceLabel[entry.source] },
  ]
  const set = (field: keyof typeof address) => (value: string) => {
    setAddress((current) => ({ ...current, [field]: value }))
  }

  return (
    <Dialog title="Kunde aus dem Lead anlegen" width={600} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void convert(event)
        }}
      >
        <p className="text-[14px] leading-[1.55]">
          Aus dem Lead entstehen ein Kunde und ein Objekt, mit den Angaben, die er hat.
        </p>
        <section className="flex flex-col gap-2" aria-label="Kunde">
          <h3 className="font-condensed text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            Kunde
          </h3>
          <FactList keyWidth={96} facts={facts} />
        </section>
        <section className="flex flex-col gap-2.5" aria-label="Objekt">
          <h3 className="font-condensed text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            Objekt
          </h3>
          <Field
            label="Bezeichnung"
            required
            starred
            value={designation}
            problem={nameless ? 'Ein Objekt braucht eine Bezeichnung.' : undefined}
            onChange={(event) => {
              setDesignation(event.target.value)
            }}
          />
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-copper-solid"
              checked={sameAddress}
              onChange={(event) => {
                setSameAddress(event.target.checked)
              }}
            />
            <span className="text-[14px] leading-[1.4]">
              An der Anschrift des Kunden
              <span className="block text-[13px] text-ink-muted">
                Ohne Haken eine andere Anschrift für das Objekt angeben.
              </span>
            </span>
          </label>
          {sameAddress ? null : (
            <div className="flex flex-col gap-2.5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
                <Field
                  label="Straße"
                  value={address.street}
                  onChange={(event) => {
                    set('street')(event.target.value)
                  }}
                />
                <Field
                  label="Hausnummer"
                  value={address.houseNumber}
                  onChange={(event) => {
                    set('houseNumber')(event.target.value)
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]">
                <Field
                  label="PLZ"
                  value={address.postalCode}
                  onChange={(event) => {
                    set('postalCode')(event.target.value)
                  }}
                />
                <Field
                  label="Ort"
                  value={address.city}
                  onChange={(event) => {
                    set('city')(event.target.value)
                  }}
                />
                <SelectField
                  label="Land"
                  value={address.country}
                  options={countryOptions}
                  onChange={set('country')}
                />
              </div>
            </div>
          )}
        </section>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button onClick={onClose} disabled={working}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working || nameless}>
            {working ? 'Wird angelegt' : 'Kunde und Objekt anlegen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

interface Draft {
  readonly kind: string
  readonly name: string
  readonly concern: string
  readonly email: string
  readonly phone: string
  readonly street: string
  readonly houseNumber: string
  readonly postalCode: string
  readonly city: string
  readonly country: string
  readonly source: string
  readonly stage: string
  readonly lastContactOn: string
}

function draftOf(entry: ProspectEntry | undefined): Draft {
  return {
    kind: entry?.kind ?? 'private',
    name: entry?.name ?? '',
    concern: entry?.concern ?? '',
    email: entry?.email ?? '',
    phone: entry?.phone ?? '',
    street: entry?.street ?? '',
    houseNumber: entry?.houseNumber ?? '',
    postalCode: entry?.postalCode ?? '',
    city: entry?.city ?? '',
    country: entry?.country ?? 'DE',
    source: entry?.source ?? '',
    stage: entry?.stage ?? 'new',
    lastContactOn: entry?.lastContactOn ?? today(),
  }
}

function orNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim()
}

function valuesOf(draft: Draft): ProspectValues {
  return {
    kind: draft.kind as ProspectValues['kind'],
    name: draft.name.trim(),
    concern: draft.concern.trim() === '' ? null : draft.concern,
    email: orNull(draft.email),
    phone: orNull(draft.phone),
    street: orNull(draft.street),
    houseNumber: orNull(draft.houseNumber),
    postalCode: orNull(draft.postalCode),
    city: orNull(draft.city),
    country: draft.country,
    source: draft.source as ProspectSource,
    stage: draft.stage as ProspectStage,
    lastContactOn: draft.lastContactOn as IsoDate,
  }
}

export function NewProspectScreen() {
  const { online } = useSyncStatus()

  if (!online) {
    return <Frame title="Neuer Lead">{prospectsOffline}</Frame>
  }

  return <ProspectForm entry={undefined} />
}

export function EditProspectScreen() {
  const { prospectId } = useParams({ strict: false }) as { prospectId?: string }
  const { online } = useSyncStatus()
  const one = useProspect(prospectId)

  if (!online) {
    return <Frame title="Leads">{prospectsOffline}</Frame>
  }

  if (one.isError) {
    return <Frame title="Nicht gefunden">Diesen Lead gibt es nicht mehr.</Frame>
  }

  if (!one.data) {
    return null
  }

  return <ProspectForm key={one.data.id} entry={one.data} />
}

const kindOptions = customerKinds.map((kind) => ({ value: kind, label: customerKindLabel[kind] }))
const sourceOptions = [
  { value: '', label: 'Bitte wählen' },
  ...prospectSources.map((source) => ({ value: source, label: prospectSourceLabel[source] })),
]
const stageOptions = prospectStages.map((stage) => ({
  value: stage,
  label: prospectStageLabel[stage],
}))

/** The form of a lead, the board "Neuer Lead": who, what for, how to reach them, where, and the sales facts. */
function ProspectForm({ entry }: { readonly entry: ProspectEntry | undefined }) {
  const navigate = useNavigate()
  const queries = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const back = entry ? `/leads/${entry.id}` : '/leads'
  const set = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  if (entry && isConverted(entry)) {
    return (
      <Frame title={entry.name}>
        Aus diesem Lead ist ein Kunde geworden. Geändert wird jetzt der Kunde, der Lead bleibt, wie
        er war.
      </Frame>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const values = valuesOf(draft)
    const found = prospectProblems(values, today() as IsoDate)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const saved = entry ? await updateProspect(entry.id, values) : await createProspect(values)

      await queries.invalidateQueries({ queryKey: prospectsKey })
      await queries.invalidateQueries({ queryKey: prospectKey(saved.id) })
      await navigate({ to: `/leads/${saved.id}` })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused ? error.message : `Keine Verbindung. ${prospectsOffline}`,
      )
    } finally {
      setWorking(false)
    }
  }

  const input = (
    field: keyof Draft,
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      label={label}
      value={draft[field]}
      problem={problems[field]}
      onChange={(event) => {
        set(field)(event.target.value)
      }}
      {...extra}
    />
  )

  return (
    <Screen>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <PageHead
          title={entry ? `${entry.name} bearbeiten` : 'Neuer Lead'}
          crumbs={[
            { to: '/vertrieb', label: 'Vertrieb' },
            { to: '/leads', label: 'Leads' },
          ]}
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
                {working ? 'Wird gespeichert' : entry ? 'Speichern' : 'Lead anlegen'}
              </Button>
            </>
          }
        />

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Panel title="Lead" roomy>
              <div className="flex flex-col gap-[11px]">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  {input('name', 'Name', { required: true, starred: true })}
                  <SelectField
                    label="Art"
                    value={draft.kind}
                    options={kindOptions}
                    problem={problems['kind']}
                    onChange={set('kind')}
                  />
                </div>
                <TextArea
                  label="Anliegen"
                  value={draft.concern}
                  problem={problems['concern']}
                  onChange={(event) => {
                    set('concern')(event.target.value)
                  }}
                />
              </div>
            </Panel>
            <Panel title="Erreichbar" roomy>
              <div className="grid gap-3 sm:grid-cols-2">
                {input('email', 'E-Mail', { type: 'email' })}
                {input('phone', 'Telefon', { type: 'tel' })}
              </div>
            </Panel>
            <Panel title="Anschrift" roomy>
              <p className="-mt-[3px] mb-2.5 text-[13px] text-ink-faint">
                Wird der Lead Kunde, liegt auch das Objekt zuerst an dieser Anschrift.
              </p>
              <div className="flex flex-col gap-2.5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
                  {input('street', 'Straße')}
                  {input('houseNumber', 'Hausnummer')}
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]">
                  {input('postalCode', 'PLZ')}
                  {input('city', 'Ort')}
                  <SelectField
                    label="Land"
                    value={draft.country}
                    options={countryOptions}
                    problem={problems['country']}
                    onChange={set('country')}
                  />
                </div>
              </div>
            </Panel>
          </div>
          <div className="flex flex-col gap-3 lg:w-[420px] lg:shrink-0">
            <Panel title="Vertrieb" roomy>
              <div className="flex flex-col gap-[11px]">
                <SelectField
                  label="Quelle"
                  starred
                  value={draft.source}
                  options={sourceOptions}
                  hint="Wie der Lead zum Betrieb gefunden hat. Wird er Kunde, bleibt die Quelle am Kunden."
                  problem={problems['source']}
                  onChange={set('source')}
                />
                <SelectField
                  label="Stand"
                  value={draft.stage}
                  options={stageOptions}
                  hint="Wie weit der Lead geklärt ist."
                  problem={problems['stage']}
                  onChange={set('stage')}
                />
                {input('lastContactOn', 'Letzter Kontakt', {
                  type: 'date',
                  required: true,
                  starred: true,
                  hint: 'Der Tag, an dem zuletzt mit ihm gesprochen oder geschrieben wurde.',
                })}
              </div>
            </Panel>
          </div>
        </div>
      </form>
    </Screen>
  )
}
