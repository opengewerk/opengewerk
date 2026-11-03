import { berlinWall, type RecordState, urgentRepairNote } from '@opengewerk/domain'
import { Button, Field, Panel } from '@opengewerk/platform-web'
import { SiteActionBar, SiteScreen, SiteText, SiteTrouble } from '@opengewerk/platform-web/site'
import { maybeText, refusalFor, text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Link, useNavigate } from '@tanstack/react-router'
import { BellRing, Check, Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { berlinMoment, clockOf, dayMonth, longDays, weekdayIndex } from '../../app/appointments.js'
import { useMay } from '../../app/queries.js'
import { urgentRepairTitle } from '../../app/service-calls.js'
import { SiteHeader } from '../header.js'

/**
 * A service call taken on call (#293, Feature-Gliederung 4.1): whoever is on
 * call by the plan takes the call at night and makes the job on the phone,
 * without a network if need be. Boards "Offene Aufträge in der Bereitschaft"
 * and "Einsatz anlegen in der Bereitschaft" of the canvas, version 125.
 *
 * The times of the plan of this person come with the sync; the server lets
 * the job land only for a moment in one of them, and with the narrow right
 * of whoever is on call.
 */

/** "Montag, 09.11., 07:00", the end of a time of the plan in German time. */
function until(at: string): string {
  const { day } = berlinWall(at)

  return `${longDays[weekdayIndex(day)] ?? ''}, ${dayMonth(day)}, ${clockOf(at)}`
}

/** The time of the plan of this person that covers now, from the device. */
function useCurrentShift(): RecordState | undefined {
  const shifts = useRecords('on_call_shifts')
  // The moment the screen opened; a card that stays open past the end of a
  // time is taken back by the server when the call arrives.
  const [now] = useState(() => Date.now())

  return shifts.find(
    (shift) =>
      !shift['deletedAt'] &&
      new Date(text(shift, 'startsAt')).getTime() <= now &&
      now < new Date(text(shift, 'endsAt')).getTime(),
  )
}

/** On top of the open jobs while on call: until when, and the way to a new call. */
export function OnCallCard() {
  const shift = useCurrentShift()
  const may = useMay('job.on_call')

  if (!shift || !may) {
    return null
  }

  return (
    <section
      aria-label="Bereitschaft"
      className="flex flex-col gap-2.5 rounded-[6px] border border-l-4 border-waiting-edge border-l-copper bg-waiting-fill px-3.5 py-3"
    >
      <p className="flex items-center gap-2 text-[17px] font-bold">
        <BellRing size={18} strokeWidth={2.2} aria-hidden="true" />
        Du hast Bereitschaft
      </p>
      <SiteText size={16}>
        {`Bis ${until(text(shift, 'endsAt'))}. Nimmst du einen Anruf an, legst du den Einsatz hier an, auch ohne Netz.`}
      </SiteText>
      <Link
        to="/einsatz/neu"
        className="flex min-h-[52px] items-center justify-center gap-2 rounded-control border border-copper-solid bg-copper-solid px-4 text-[17px] font-semibold text-on-copper no-underline"
      >
        <Plus size={20} strokeWidth={2.2} aria-hidden="true" />
        Einsatz anlegen
      </Link>
    </section>
  )
}

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

export function SiteNewCallScreen() {
  const client = useSync()
  const navigate = useNavigate()
  const shift = useCurrentShift()
  const may = useMay('job.on_call')
  const customers = useRecords('customers')
  const formId = useId()
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [fresh, setFresh] = useState({
    name: '',
    phone: '',
    street: '',
    houseNumber: '',
    postalCode: '',
    city: '',
  })
  const [designation, setDesignation] = useState('')
  const [description, setDescription] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  // The moment the call came in: when this screen opened.
  const [calledAt] = useState(() => new Date().toISOString())

  const found = useMemo(
    () =>
      customers
        .filter((customer) => !customer['deletedAt'] && matches(customer, search))
        .slice(0, 5),
    [customers, search],
  )
  const customer = chosen ? customers.find((record) => record['id'] === chosen) : undefined

  if (!may || !shift) {
    return (
      <SiteScreen>
        <SiteHeader title="Einsatz anlegen" />
        <SiteText>
          Einen Einsatz legt hier an, wer laut Plan gerade Bereitschaft hat. Sonst nimmt das Büro
          den Auftrag an.
        </SiteText>
      </SiteScreen>
    )
  }

  async function save(event: FormEvent) {
    event.preventDefault()

    const found: Record<string, string> = {}

    if (!chosen) {
      if (fresh.name.trim() === '') {
        found['name'] = 'Wer anruft, braucht einen Namen.'
      }
    }

    if (designation.trim() === '') {
      found['designation'] = 'Worum es geht, steht als Bezeichnung am Auftrag.'
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      let customerId = chosen

      if (!customerId) {
        const made = await client.create('customers', {
          kind: 'private',
          name: fresh.name.trim(),
          phone: fresh.phone.trim() || null,
          street: fresh.street.trim() || null,
          houseNumber: fresh.houseNumber.trim() || null,
          postalCode: fresh.postalCode.trim() || null,
          city: fresh.city.trim() || null,
        })

        if (made.outcome === 'refused') {
          setTrouble(refusalFor(made))

          return
        }

        customerId = made.id
      }

      const job = await client.create('jobs', {
        customerId,
        siteId: null,
        installationId: null,
        parentJobId: null,
        kind: 'service',
        status: 'active',
        designation: designation.trim(),
        description: description.trim() || null,
        urgentRepair: urgent,
        emergencyAt: calledAt,
      })

      if (job.outcome === 'refused') {
        setTrouble(refusalFor(job))

        return
      }

      await navigate({ to: `/auftraege/${job.id}` })
    } finally {
      setWorking(false)
    }
  }

  const freshField = (key: keyof typeof fresh, label: string, type = 'text') => (
    <Field
      label={label}
      type={type}
      value={fresh[key]}
      problem={key === 'name' ? problems['name'] : undefined}
      onChange={(event) => {
        setFresh({ ...fresh, [key]: event.target.value })
      }}
    />
  )

  return (
    <SiteScreen>
      <SiteHeader title="Einsatz anlegen" sub="In der Bereitschaft" />
      <form id={formId} className="contents" onSubmit={(event) => void save(event)}>
        <Panel title="Wer anruft">
          <div className="flex flex-col gap-3">
            <Field
              label="Kunde suchen"
              value={search}
              hint="Unter den Kunden auf diesem Gerät, nach Name, Telefon oder Ort."
              onChange={(event) => {
                setSearch(event.target.value)
                setChosen(null)
              }}
            />
            {customer ? (
              <div className="flex items-center gap-2">
                <SiteText size={16}>{text(customer, 'name')}</SiteText>
                <Button
                  height={44}
                  onClick={() => {
                    setChosen(null)
                  }}
                >
                  Anderer Kunde
                </Button>
              </div>
            ) : search.trim().length >= 2 && found.length > 0 ? (
              <ul aria-label="Gefundene Kunden" className="flex flex-col gap-1.5">
                {found.map((candidate) => (
                  <li key={String(candidate['id'])}>
                    <Button
                      wide
                      height={52}
                      onClick={() => {
                        setChosen(String(candidate['id']))
                      }}
                    >
                      {text(candidate, 'name')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : search.trim().length >= 2 ? (
              <SiteText muted size={15}>
                Kein Kunde auf diesem Gerät gefunden. Die Angaben unten legen einen neuen an.
              </SiteText>
            ) : null}
            {customer ? null : (
              <>
                {freshField('name', 'Name')}
                {freshField('phone', 'Telefon', 'tel')}
                <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2.5">
                  {freshField('street', 'Straße')}
                  {freshField('houseNumber', 'Nr.')}
                </div>
                <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2.5">
                  {freshField('postalCode', 'PLZ')}
                  {freshField('city', 'Ort')}
                </div>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Was los ist">
          <div className="flex flex-col gap-3">
            <Field
              label="Anliegen"
              value={designation}
              problem={problems['designation']}
              onChange={(event) => {
                setDesignation(event.target.value)
              }}
            />
            <Field
              label="Beschreibung"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
              }}
            />
            <label className="flex items-start gap-2.5 text-[16px] leading-[1.4]">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-copper-solid"
                checked={urgent}
                onChange={(event) => {
                  setUrgent(event.target.checked)
                }}
              />
              <span>
                <b className="font-semibold">{urgentRepairTitle}</b>
                <span className="block text-[15px] text-ink-muted">{urgentRepairNote}</span>
              </span>
            </label>
          </div>
        </Panel>
      </form>

      <SiteText muted size={15}>
        {`Notdiensteinsatz von ${berlinMoment(calledAt)} Uhr. Ohne Netz gespeichert; das Büro sieht ihn beim nächsten Abgleich, mit Nummer.`}
      </SiteText>

      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      <SiteActionBar stacked>
        <Button type="submit" form={formId} tone="primary" wide icon={Check} disabled={working}>
          Einsatz anlegen
        </Button>
        <Button
          wide
          height={48}
          disabled={working}
          onClick={() => {
            void navigate({ to: '/' })
          }}
        >
          Abbrechen
        </Button>
      </SiteActionBar>
    </SiteScreen>
  )
}
