import {
  applianceMobilityLabel,
  type ApplianceMobility,
  type RecordState,
} from '@opengewerk/domain'
import { Button, Field, Panel, SelectField } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { SiteActionBar, SiteScreen, SiteText, SiteTrouble } from '@opengewerk/platform-web/site'
import { refusalFor, text, useRecord, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import clsx from 'clsx'
import { Check, ChevronRight, Clock, Pencil, Plus, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'

import {
  applianceFields,
  applianceFormProblem,
  type ApplianceState,
  applianceState,
  asAppliance,
  useAppliances,
  useApplianceTests,
} from '../../app/appliances.js'
import { definitionOf, isSigned, protocolRegistry, startProtocol } from '../../app/protocols.js'
import { useMay } from '../../app/queries.js'
import type { SyncClient } from '../../sync/client.js'
import { SiteHeader } from '../header.js'

/**
 * The appliances of the site of a job on site (#303), as the boards "Geräte
 * am Objekt" and "Gerät anlegen" draw them: one after another, tapped to open
 * the draft of today or to start a test from the last one, without a network.
 */

function protocolPath(jobId: string, recordId: string): string {
  return `/auftraege/${jobId}/pruefprotokolle/${recordId}`
}

/**
 * Opens the test of an appliance: its draft of today, or a new test in the
 * form of the register, with its last signed test as the template, through
 * the outbox. The answer is the path to go to, or the sentence why not.
 */
export async function openTest(
  client: SyncClient,
  appliance: RecordState,
  tests: readonly RecordState[] | undefined,
  jobId: string,
): Promise<{ readonly path: string } | { readonly trouble: string }> {
  const state = applianceState(tests)

  if (state.kind === 'draft') {
    return { path: protocolPath(jobId, state.id) }
  }

  const definition = protocolRegistry
    .current()
    .find((candidate) => candidate.attachesTo === 'appliance')

  if (!definition) {
    return { trouble: 'Diese Fassung von OpenGewerk kennt keine Prüfung eines Geräts.' }
  }

  const template =
    (tests ?? []).find((test) => isSigned(test) && definitionOf(test) !== null) ?? null
  const made = await startProtocol(client, {
    definition,
    subject: { applianceId: String(appliance['id']) },
    jobId,
    circuits: [],
    template,
  })

  return made.outcome === 'refused'
    ? { trouble: refusalFor(made) }
    : { path: protocolPath(jobId, made.id) }
}

/** The card on a job: how many appliances the site has, how many are tested today, and the way to them. */
export function JobAppliances({
  jobId,
  siteId,
}: {
  readonly jobId: string
  readonly siteId: string
}) {
  const navigate = useNavigate()
  const appliances = useAppliances(siteId)
  const tests = useApplianceTests()
  const testedToday = appliances.filter(
    (appliance) => applianceState(tests.get(String(appliance['id']))).kind === 'today',
  ).length

  return (
    <Panel title="Geräte nach DGUV Vorschrift 3">
      <div className="flex flex-col gap-2">
        <SiteText muted size={16}>
          {appliances.length === 0
            ? 'An diesem Objekt gibt es noch kein Gerät.'
            : `${String(appliances.length)} ${appliances.length === 1 ? 'Gerät' : 'Geräte'} am Objekt, ${
                testedToday === 0
                  ? 'heute noch keines geprüft.'
                  : `${String(testedToday)} heute geprüft.`
              }`}
        </SiteText>
        <Button
          wide
          height={52}
          icon={Check}
          onClick={() => {
            void navigate({ to: `/auftraege/${jobId}/geraete` })
          }}
        >
          Geräte prüfen
        </Button>
      </div>
    </Panel>
  )
}

/** How an appliance stands, as the row says it after its facts, and the mark at its right. */
function stateWords(state: ApplianceState): {
  readonly words: string
  readonly icon: LucideIcon | null
  readonly colour: string
} {
  switch (state.kind) {
    case 'today':
      return state.defects
        ? { words: 'Heute geprüft, Mängel', icon: TriangleAlert, colour: 'text-conflict' }
        : { words: 'Heute geprüft, keine Mängel', icon: Check, colour: 'text-done' }
    case 'draft':
      return { words: 'Entwurf von heute', icon: Pencil, colour: 'text-ink-muted' }
    case 'due':
      return { words: `Fällig am ${date(state.on)}`, icon: Clock, colour: 'text-waiting' }
    case 'tested':
      return { words: `Geprüft am ${date(state.on)}`, icon: null, colour: '' }
    case 'untested':
      return { words: 'Noch nicht geprüft', icon: null, colour: '' }
  }
}

/** The appliances of the site of a job, `/auftraege/$jobId/geraete`. */
export function SiteAppliancesScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const job = useRecord('jobs', jobId)
  const site = useRecord('sites', job?.['siteId'] ? String(job['siteId']) : undefined)
  const appliances = useAppliances(site ? String(site['id']) : undefined)
  const tests = useApplianceTests()
  const writes = useMay('installation.write')
  const [search, setSearch] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  if (!job || !jobId || !site) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>Diesen Auftrag hat dieses Gerät nicht, oder er hat kein Objekt.</SiteText>
      </SiteScreen>
    )
  }

  const on = today()
  const testedToday = appliances.filter(
    (appliance) => applianceState(tests.get(String(appliance['id'])), on).kind === 'today',
  ).length
  const words = search.trim().toLocaleLowerCase('de')
  const shown = appliances.filter(
    (appliance) =>
      words === '' ||
      [text(appliance, 'inventoryNumber'), text(appliance, 'designation')].some((part) =>
        part.toLocaleLowerCase('de').includes(words),
      ),
  )

  async function open(appliance: RecordState) {
    setWorking(true)
    setTrouble(null)

    try {
      const opened = await openTest(
        client,
        appliance,
        tests.get(String(appliance['id'])),
        jobId ?? '',
      )

      if ('path' in opened) {
        void navigate({ to: opened.path })
      } else {
        setTrouble(opened.trouble)
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <SiteScreen>
      <SiteHeader
        title="Geräte"
        sub={`${text(site, 'designation')}, ${String(testedToday)} von ${String(appliances.length)} heute geprüft`}
      />
      <Field
        label="Gerät suchen"
        placeholder="Inventarnummer oder Bezeichnung"
        autoComplete="off"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
        }}
      />
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      <Panel
        title="Am Objekt"
        action={
          <span className="text-[14px] text-ink-faint">
            {appliances.length === 1 ? '1 Gerät' : `${String(appliances.length)} Geräte`}
          </span>
        }
      >
        {appliances.length === 0 ? (
          <SiteText muted>An diesem Objekt gibt es noch kein Gerät.</SiteText>
        ) : (
          <ul aria-label="Geräte am Objekt" className="flex flex-col">
            {shown.map((appliance) => {
              const id = String(appliance['id'])
              const state = stateWords(applianceState(tests.get(id), on))
              const Mark = state.icon
              const facts = [
                `Schutzklasse ${text(appliance, 'protectionClass')}`,
                (appliance['mobility'] as ApplianceMobility) === 'fixed'
                  ? applianceMobilityLabel.fixed
                  : '',
                text(appliance, 'location'),
              ]
                .filter((part) => part !== '')
                .join(', ')

              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      void open(appliance)
                    }}
                    className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 border-b border-row bg-transparent py-2 text-left text-ink"
                  >
                    <span className="font-condensed min-w-11 shrink-0 rounded-[4px] bg-surface-sunken px-1.5 py-[3px] text-center text-[17px] font-semibold">
                      {text(appliance, 'inventoryNumber')}
                    </span>
                    <span className="min-w-0 grow">
                      <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                        {text(appliance, 'designation')}
                      </span>
                      <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">
                        {`${facts}. ${state.words}`}
                      </span>
                    </span>
                    {Mark ? (
                      <Mark
                        size={20}
                        strokeWidth={2.3}
                        aria-hidden="true"
                        className={clsx('shrink-0', state.colour)}
                      />
                    ) : null}
                    <ChevronRight
                      size={20}
                      strokeWidth={2.2}
                      aria-hidden="true"
                      className="shrink-0 text-ink-faint"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      <SiteText muted size={15}>
        Ein Gerät öffnet seinen Entwurf von heute oder beginnt eine neue Prüfung, mit dem letzten
        Protokoll des Geräts als Vorlage.
      </SiteText>
      {writes ? (
        <SiteActionBar>
          <Button
            wide
            height={60}
            icon={Plus}
            onClick={() => {
              void navigate({ to: `/auftraege/${jobId}/geraete/neu` })
            }}
          >
            Gerät anlegen
          </Button>
        </SiteActionBar>
      ) : null}
    </SiteScreen>
  )
}

/** A new appliance at the site of a job, `/auftraege/$jobId/geraete/neu`, tested right after. */
export function SiteNewApplianceScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const job = useRecord('jobs', jobId)
  const site = useRecord('sites', job?.['siteId'] ? String(job['siteId']) : undefined)
  const [values, setValues] = useState<Record<string, string>>({
    protectionClass: 'I',
    mobility: 'portable',
  })
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  if (!job || !jobId || !site) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>Diesen Auftrag hat dieses Gerät nicht, oder er hat kein Objekt.</SiteText>
      </SiteScreen>
    )
  }

  const siteId = String(site['id'])
  const byName = new Map(applianceFields.map((field) => [field.name, field]))
  // The order of the board: what the label says first, then where it is and what makes it.
  const order = [
    'designation',
    'inventoryNumber',
    'protectionClass',
    'mobility',
    'cordLength',
    'location',
    'manufacturer',
    'model',
    'serialNumber',
  ]

  async function make() {
    const problem = applianceFormProblem(values)

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const made = await client.create('appliances', { ...asAppliance(values), siteId })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      const appliance = { ...asAppliance(values), siteId, id: made.id } as unknown as RecordState
      const opened = await openTest(client, appliance, [], jobId ?? '')

      if ('path' in opened) {
        void navigate({ to: opened.path })
      } else {
        setTrouble(opened.trouble)
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <SiteScreen>
      <SiteHeader title="Gerät anlegen" sub={text(site, 'designation')} />
      {order.map((name) => {
        const field = byName.get(name)

        if (!field) {
          return null
        }

        const label = name === 'cordLength' ? 'Länge der Anschlussleitung in m' : field.label

        return field.options ? (
          <SelectField
            key={name}
            label={label}
            hint={field.hint}
            value={values[name] ?? ''}
            options={field.options}
            onChange={(chosen) => {
              setValues((current) => ({ ...current, [name]: chosen }))
            }}
          />
        ) : (
          <Field
            key={name}
            label={label}
            hint={field.hint}
            autoComplete="off"
            inputMode={name === 'cordLength' ? 'decimal' : undefined}
            numeric={field.numeric}
            value={values[name] ?? ''}
            onChange={(event) => {
              const typed = event.target.value

              setValues((current) => ({ ...current, [name]: typed }))
            }}
          />
        )
      })}
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      <SiteActionBar note="Das Büro sieht das Gerät mit dem nächsten Abgleich.">
        <Button
          tone="primary"
          wide
          height={60}
          icon={Check}
          disabled={working}
          onClick={() => {
            void make()
          }}
        >
          Anlegen und prüfen
        </Button>
      </SiteActionBar>
    </SiteScreen>
  )
}
