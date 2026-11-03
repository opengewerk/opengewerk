import {
  addDays,
  berlinInstant,
  type CustomerKind,
  customerKinds,
  type IsoDate,
  type RecordState,
  urgentRepairNote,
} from '@opengewerk/domain'
import { Button, Field, Panel, SelectField, TextArea } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { NoteBox, PageHead, RecordColumns, Screen } from '@opengewerk/platform-web/office'
import {
  RequestRefused,
  refusalFor,
  text,
  maybeText,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { customerKindLabel } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { urgentRepairTitle } from '../../app/service-calls.js'
import { usePeople } from '../../app/tasks.js'
import { boardFacts, boardKey, createAppointment } from '../../session/appointments.js'

/**
 * A call taken on the phone (#292, Feature-Gliederung 4.1): who calls, where,
 * what is wrong, and when and who, on one screen, and out of it the service
 * call and its appointment in one go. Board "Serviceeinsatz erfassen" of the
 * canvas, version 124.
 *
 * The customer, the site and the job go through the sync like any the office
 * makes, so that every rule they have holds here too; then the appointment
 * goes to its route, which puts whoever goes on the job and tells them by
 * push. With a network only: the appointment is made on the server. If only
 * the appointment fails, the job stays and the screen says why.
 */

/** How long a call takes on site, as the form offers it, in minutes. */
const durations = [30, 60, 90, 120, 180, 240, 480] as const

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  return [hours > 0 ? `${String(hours)} Std.` : null, rest > 0 ? `${String(rest)} Min.` : null]
    .filter((part): part is string => part !== null)
    .join(' ')
}

/** The minute of the day a clock names, "07:30" as 450. */
function minuteOf(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number)

  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** A customer as the search finds it: by name, telephone number or place. */
function matches(customer: RecordState, search: string): boolean {
  const wanted = search.trim().toLowerCase()

  if (wanted.length < 2) {
    return false
  }

  const digits = wanted.replace(/[^0-9]/g, '')

  return (
    text(customer, 'name').toLowerCase().includes(wanted) ||
    (maybeText(customer, 'city') ?? '').toLowerCase().includes(wanted) ||
    (digits.length >= 4 &&
      (maybeText(customer, 'phone') ?? '').replace(/[^0-9]/g, '').includes(digits))
  )
}

function addressOf(record: RecordState): string {
  return [
    [maybeText(record, 'street'), maybeText(record, 'houseNumber')].filter(Boolean).join(' '),
    [maybeText(record, 'postalCode'), maybeText(record, 'city')].filter(Boolean).join(' '),
  ]
    .filter((part) => part !== '')
    .join(', ')
}

function Step({
  number,
  title,
  hint,
  children,
}: {
  readonly number: number
  readonly title: string
  readonly hint?: string
  readonly children: ReactNode
}) {
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-copper-solid text-[13px] font-bold text-on-copper">
            {number}
          </span>
          <h2 className="text-[15px] font-semibold">{title}</h2>
        </div>
        {children}
        {hint ? <p className="text-[13px] leading-[1.45] text-ink-muted">{hint}</p> : null}
      </div>
    </Panel>
  )
}

function Box({
  label,
  hint,
  checked,
  onChange,
}: {
  readonly label: string
  readonly hint?: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2.5 text-[14px] leading-[1.4]">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-copper-solid"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <span>
        {label}
        {hint ? <span className="block text-[13px] text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  )
}

interface NewCustomer {
  name: string
  kind: CustomerKind
  phone: string
  email: string
  street: string
  houseNumber: string
  postalCode: string
  city: string
}

const noCustomer: NewCustomer = {
  name: '',
  kind: 'private',
  phone: '',
  email: '',
  street: '',
  houseNumber: '',
  postalCode: '',
  city: '',
}

export function NewServiceCallScreen() {
  const client = useSync()
  const navigate = useNavigate()
  const { online } = useSyncStatus()
  const writes = useMay('job.write')
  const customers = useRecords('customers')
  const sites = useRecords('sites')
  const installations = useRecords('installations')
  const { people } = usePeople()

  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [fresh, setFresh] = useState<NewCustomer>(noCustomer)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [sameAddress, setSameAddress] = useState(true)
  const [place, setPlace] = useState({ street: '', houseNumber: '', postalCode: '', city: '' })
  const [installationId, setInstallationId] = useState('')
  const [designation, setDesignation] = useState('')
  const [description, setDescription] = useState('')
  const [urgent, setUrgent] = useState(false)
  // An emergency call taken in the office (#293): when the customer called.
  const [emergency, setEmergency] = useState(false)
  const [calledOn, setCalledOn] = useState<IsoDate>(today())
  const [calledAt, setCalledAt] = useState(() =>
    new Date().toLocaleTimeString('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
    }),
  )
  const [day, setDay] = useState<IsoDate>(today())
  const [start, setStart] = useState('08:00')
  const [minutes, setMinutes] = useState(60)
  const [crew, setCrew] = useState<readonly string[]>([])
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const found = useMemo(
    () =>
      customers
        .filter((customer) => !customer['deletedAt'] && matches(customer, search))
        .slice(0, 6),
    [customers, search],
  )
  const customer = customerId ? customers.find((record) => record['id'] === customerId) : undefined
  const theirSites = useMemo(
    () =>
      customerId
        ? sites.filter((site) => !site['deletedAt'] && site['customerId'] === customerId)
        : [],
    [sites, customerId],
  )
  const onSite = useMemo(
    () =>
      siteId
        ? installations.filter(
            (installation) => !installation['deletedAt'] && installation['siteId'] === siteId,
          )
        : [],
    [installations, siteId],
  )
  // Who is away that day, from the server, as the board shows it.
  const board = useQuery({
    queryKey: [...boardKey, day, day],
    queryFn: () => boardFacts(day, day),
    enabled: online && writes,
    retry: false,
  })
  const away = new Set((board.data?.absences ?? []).map((absence) => absence.userId))
  const crewOptions = people.filter((person) => person.active)

  if (!writes) {
    return (
      <Screen>
        <PageHead
          title="Serviceeinsatz erfassen"
          crumbs={[{ to: '/auftraege', label: 'Aufträge' }]}
        />
        <NoteBox>Einen Serviceeinsatz legt an, wer Aufträge bearbeiten darf.</NoteBox>
      </Screen>
    )
  }

  const newPlace = customerId ? siteId === null : !sameAddress

  async function save(event: FormEvent) {
    event.preventDefault()

    const found: Record<string, string> = {}

    if (!customerId && fresh.name.trim() === '') {
      found['name'] = 'Wer anruft, braucht einen Namen.'
    }

    if (designation.trim() === '') {
      found['designation'] = 'Worum es geht, steht als Bezeichnung am Auftrag.'
    }

    const where = newPlace ? place : customerId ? null : fresh

    if (where && newPlace && where.street.trim() === '' && where.city.trim() === '') {
      found['place'] = 'Wo der Einsatz ist: Straße und Ort.'
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      let customerOf = customerId

      if (!customerOf) {
        const made = await client.create('customers', {
          kind: fresh.kind,
          name: fresh.name.trim(),
          isBusiness: fresh.kind !== 'private',
          phone: fresh.phone.trim() || null,
          email: fresh.email.trim() || null,
          street: fresh.street.trim() || null,
          houseNumber: fresh.houseNumber.trim() || null,
          postalCode: fresh.postalCode.trim() || null,
          city: fresh.city.trim() || null,
        })

        if (made.outcome === 'refused') {
          setTrouble(refusalFor(made))

          return
        }

        customerOf = made.id
      }

      let siteOf = customerId ? siteId : null

      if (siteOf === null) {
        const address = newPlace ? place : fresh
        const designated =
          [address.street.trim(), address.houseNumber.trim()].filter(Boolean).join(' ') ||
          address.city.trim()
        const made = await client.create('sites', {
          customerId: customerOf,
          designation: designated,
          street: address.street.trim() || null,
          houseNumber: address.houseNumber.trim() || null,
          postalCode: address.postalCode.trim() || null,
          city: address.city.trim() || null,
        })

        if (made.outcome === 'refused') {
          setTrouble(refusalFor(made))

          return
        }

        siteOf = made.id
      }

      const job = await client.create('jobs', {
        customerId: customerOf,
        siteId: siteOf,
        installationId: installationId || null,
        parentJobId: null,
        kind: 'service',
        status: 'active',
        designation: designation.trim(),
        description: description.trim() || null,
        urgentRepair: urgent,
        emergencyAt: emergency ? berlinInstant(calledOn, minuteOf(calledAt)).toISOString() : null,
      })

      if (job.outcome === 'refused') {
        setTrouble(refusalFor(job))

        return
      }

      if (crew.length > 0) {
        // The job has to be on the server before its appointment: the route
        // puts whoever goes on it there.
        await client.synchronise()

        if (client.status().pending > 0) {
          setTrouble(
            'Der Serviceeinsatz ist angelegt, der Termin nicht: auf diesem Gerät warten noch ' +
              'Änderungen, die der Server nicht hat. Der Termin lässt sich an der Plantafel nachtragen.',
          )
          await navigate({ to: `/auftraege/${job.id}` })

          return
        }

        try {
          await createAppointment({
            jobId: job.id,
            startsAt: berlinInstant(day, minuteOf(start)).toISOString(),
            endsAt: berlinInstant(day, minuteOf(start) + minutes).toISOString(),
            note: null,
            rrule: null,
            exdates: [],
            userIds: crew,
          })
        } catch (error) {
          setTrouble(
            `Der Serviceeinsatz ist angelegt, der Termin nicht: ${
              error instanceof RequestRefused ? error.message : 'der Server hat nicht geantwortet.'
            } Der Termin lässt sich an der Plantafel nachtragen.`,
          )
          await navigate({ to: `/auftraege/${job.id}` })

          return
        }
      }

      await navigate({ to: `/auftraege/${job.id}` })
    } finally {
      setWorking(false)
    }
  }

  const freshField = (key: keyof NewCustomer, label: string, extra: object = {}) => (
    <Field
      label={label}
      value={fresh[key]}
      onChange={(event) => {
        setFresh({ ...fresh, [key]: event.target.value })
      }}
      {...extra}
    />
  )
  const placeField = (key: keyof typeof place, label: string) => (
    <Field
      label={label}
      value={place[key]}
      onChange={(event) => {
        setPlace({ ...place, [key]: event.target.value })
      }}
    />
  )

  const who = (
    <Step number={1} title="Wer anruft">
      <Field
        label="Kunde suchen"
        value={search}
        hint="Name, Telefonnummer oder Ort."
        onChange={(event) => {
          setSearch(event.target.value)
          setCustomerId(null)
          setSiteId(null)
          setInstallationId('')
        }}
      />
      {search.trim().length >= 2 && !customerId ? (
        found.length > 0 ? (
          <ul aria-label="Gefundene Kunden" className="flex flex-col gap-1.5">
            {found.map((candidate) => (
              <li key={String(candidate['id'])}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start rounded-[4px] border border-control bg-surface px-2.5 py-2 text-left text-[14px] hover:border-ink"
                  onClick={() => {
                    setCustomerId(String(candidate['id']))
                    setSiteId(null)
                  }}
                >
                  <span className="font-semibold">{text(candidate, 'name')}</span>
                  <span className="text-[13px] text-ink-muted">
                    {[maybeText(candidate, 'phone'), addressOf(candidate)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <NoteBox>Kein Kunde gefunden. Die Angaben unten legen einen neuen an.</NoteBox>
        )
      ) : null}
      {customer ? (
        <NoteBox
          tone="done"
          action={
            <Button
              onClick={() => {
                setCustomerId(null)
                setSiteId(null)
              }}
            >
              Anderer Kunde
            </Button>
          }
        >
          {`${text(customer, 'name')}${addressOf(customer) ? `, ${addressOf(customer)}` : ''}`}
        </NoteBox>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {freshField('name', 'Name', { starred: true, problem: problems['name'] })}
            <SelectField
              label="Art"
              value={fresh.kind}
              options={customerKinds.map((kind) => ({
                value: kind,
                label: customerKindLabel[kind],
              }))}
              onChange={(value) => {
                setFresh({ ...fresh, kind: value as CustomerKind })
              }}
            />
            {freshField('phone', 'Telefon', { type: 'tel' })}
            {freshField('email', 'E-Mail', {
              type: 'email',
              hint: 'Für die Belehrungen und die Rechnung.',
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3">
            {freshField('street', 'Straße')}
            {freshField('houseNumber', 'Nr.')}
          </div>
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            {freshField('postalCode', 'PLZ')}
            {freshField('city', 'Ort')}
          </div>
        </>
      )}
    </Step>
  )

  const where = (
    <Step
      number={2}
      title="Wo"
      hint={
        customerId
          ? undefined
          : 'Bei einem Kunden, den es schon gibt, stehen hier seine Objekte zur Wahl und darunter ihre Anlagen.'
      }
    >
      {customerId ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Einsatzort</legend>
          {theirSites.map((site) => (
            <label
              key={String(site['id'])}
              className={clsx(
                'flex items-start gap-2.5 rounded-[4px] border bg-surface px-2.5 py-2 text-[14px]',
                siteId === site['id'] ? 'border-ink' : 'border-control',
              )}
            >
              <input
                type="radio"
                name="service-call-site"
                className="mt-0.5 accent-copper-solid"
                checked={siteId === site['id']}
                onChange={() => {
                  setSiteId(String(site['id']))
                  setInstallationId('')
                }}
              />
              <span>
                {text(site, 'designation')}
                <span className="block text-[13px] text-ink-muted">{addressOf(site)}</span>
              </span>
            </label>
          ))}
          <label
            className={clsx(
              'flex items-center gap-2.5 rounded-[4px] border bg-surface px-2.5 py-2 text-[14px]',
              siteId === null ? 'border-ink' : 'border-control',
            )}
          >
            <input
              type="radio"
              name="service-call-site"
              className="accent-copper-solid"
              checked={siteId === null}
              onChange={() => {
                setSiteId(null)
                setInstallationId('')
              }}
            />
            Andere Anschrift, daraus wird ein Objekt des Kunden
          </label>
        </fieldset>
      ) : (
        <Box
          label="Wie die Anschrift des Kunden"
          hint="Daraus wird ein Objekt des Kunden mit dieser Anschrift."
          checked={sameAddress}
          onChange={setSameAddress}
        />
      )}
      {newPlace ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3">
            {placeField('street', 'Straße')}
            {placeField('houseNumber', 'Nr.')}
          </div>
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            {placeField('postalCode', 'PLZ')}
            {placeField('city', 'Ort')}
          </div>
        </>
      ) : null}
      {problems['place'] ? (
        <p role="alert" className="text-[13px] text-conflict">
          {problems['place']}
        </p>
      ) : null}
      {onSite.length > 0 ? (
        <SelectField
          label="Anlage"
          value={installationId}
          options={[
            { value: '', label: 'Keine Anlage' },
            ...onSite.map((installation) => ({
              value: String(installation['id']),
              label: text(installation, 'designation'),
            })),
          ]}
          onChange={setInstallationId}
        />
      ) : null}
    </Step>
  )

  const what = (
    <Step number={3} title="Was los ist">
      <Field
        label="Anliegen"
        starred
        value={designation}
        problem={problems['designation']}
        hint="Steht als Bezeichnung am Auftrag."
        onChange={(event) => {
          setDesignation(event.target.value)
        }}
      />
      <TextArea
        label="Beschreibung"
        rows={3}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      <Box
        label={urgentRepairTitle}
        hint={urgentRepairNote}
        checked={urgent}
        onChange={setUrgent}
      />
      <Box
        label="Notdiensteinsatz"
        hint="Mit dem Zeitpunkt des Anrufs. Nachts, am Wochenende oder am Feiertag bekommt die Rechnung den Notdienstzuschlag aus den Einstellungen."
        checked={emergency}
        onChange={setEmergency}
      />
      {emergency ? (
        <div className="flex flex-wrap gap-2.5 pl-6">
          <div className="w-[150px]">
            <Field
              label="Anruf am"
              type="date"
              value={calledOn}
              onChange={(event) => {
                setCalledOn(event.target.value as IsoDate)
              }}
            />
          </div>
          <div className="w-[110px]">
            <Field
              label="um"
              type="time"
              value={calledAt}
              onChange={(event) => {
                setCalledAt(event.target.value)
              }}
            />
          </div>
        </div>
      ) : null}
    </Step>
  )

  const when = (
    <Step
      number={4}
      title="Wann und wer"
      hint="Wer den Termin bekommt, wird dem Auftrag zugeordnet und bekommt eine Nachricht aufs Telefon. Ohne Person entsteht der Auftrag ohne Termin."
    >
      <div className="flex flex-wrap gap-2.5">
        <div className="w-[150px]">
          <Field
            label="Tag"
            type="date"
            value={day}
            min={addDays(today(), -1)}
            onChange={(event) => {
              setDay(event.target.value as IsoDate)
            }}
          />
        </div>
        <div className="w-[110px]">
          <Field
            label="Beginn"
            type="time"
            value={start}
            onChange={(event) => {
              setStart(event.target.value)
            }}
          />
        </div>
        <div className="w-[180px]">
          <SelectField
            label="Dauer"
            value={String(minutes)}
            options={durations.map((duration) => ({
              value: String(duration),
              label: durationLabel(duration),
            }))}
            onChange={(value) => {
              setMinutes(Number(value))
            }}
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium">Wer hinfährt</legend>
        {crewOptions.map((person) => {
          const on = crew.includes(person.userId)

          return (
            <label
              key={person.userId}
              className={clsx(
                'flex items-center gap-2.5 rounded-[4px] border bg-surface px-2.5 py-2 text-[14px]',
                on ? 'border-ink' : 'border-control',
              )}
            >
              <input
                type="checkbox"
                className="size-4 accent-copper-solid"
                checked={on}
                onChange={(event) => {
                  setCrew(
                    event.target.checked
                      ? [...crew, person.userId]
                      : crew.filter((userId) => userId !== person.userId),
                  )
                }}
              />
              <span className="flex-1">{person.name}</span>
              {away.has(person.userId) ? (
                <span className="text-[13px] text-conflict">abwesend</span>
              ) : null}
            </label>
          )
        })}
      </fieldset>
    </Step>
  )

  const aside = (
    <Panel title="Belehrungen">
      <div className="flex flex-col gap-2 text-[13px] leading-[1.45] text-ink-muted">
        <p>
          Ein Verbraucher bekommt Widerrufsbelehrung, Hinweise und Formular, auch ohne Angebot. Kam
          der Auftrag am Telefon, gehen sie ihm aus dem Auftrag per E-Mail zu; an der Tür zeigt sie
          das Gerät des Monteurs, und der Kunde unterschreibt dort das Verlangen auf vorzeitigen
          Beginn.
        </p>
        <p>
          Bei einer dringenden Reparatur auf seinen ausdrücklichen Wunsch hat er für die Reparatur
          selbst kein Widerrufsrecht.
        </p>
      </div>
    </Panel>
  )

  return (
    <Screen>
      <PageHead
        crumbs={[{ to: '/auftraege', label: 'Aufträge' }]}
        phoneBack={{ to: '/auftraege', label: 'Aufträge' }}
        title="Serviceeinsatz erfassen"
        sub="Aus einem Anruf: Kunde, Einsatzort, Anliegen und Termin auf einem Bildschirm."
      />
      <form
        className="contents"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <RecordColumns
          main={
            <>
              {who}
              {where}
              {what}
              {when}
              {!online ? (
                <NoteBox tone="waiting">
                  Keine Verbindung. Ein Serviceeinsatz mit Termin entsteht mit Verbindung, der
                  Termin auf dem Server.
                </NoteBox>
              ) : null}
              {trouble ? (
                <p role="alert" className="text-[13px] font-semibold text-conflict">
                  {trouble}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    void navigate({ to: '/auftraege' })
                  }}
                >
                  Abbrechen
                </Button>
                <Button type="submit" tone="primary" icon={Check} disabled={working || !online}>
                  Serviceeinsatz anlegen
                </Button>
              </div>
            </>
          }
          side={aside}
        />
      </form>
    </Screen>
  )
}
