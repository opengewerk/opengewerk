import { longestDeviceInfo, type RecordState, signerNameProblem } from '@opengewerk/domain'
import { Button, Field, Panel } from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import {
  SignaturePad,
  SiteActionBar,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  text,
  useRecord,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, ChevronDown, Signature } from 'lucide-react'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { useMay } from '../../app/queries.js'
import {
  InstructionText,
  UrgentRepairNote,
  useConsumerCall,
  useEarlyStarts,
} from '../../app/service-calls.js'
import { callInstructions, callInstructionsKey } from '../../session/service-calls.js'
import { SiteHeader } from '../header.js'

/**
 * The instructions of a service call at the door (#292, Feature-Gliederung
 * 4.1): the device shows the instruction on withdrawal, the notes and the
 * form, and the customer signs the request for an early start, like a report.
 * It travels through the sync, and the server sends everything to the
 * customer by mail. Boards "Auftragszettel eines Serviceeinsatzes" and
 * "Belehrung an der Tür" of the canvas, version 124.
 *
 * The words come from the server, which holds the instructions of the
 * business: with a network once, the screen shows them; the signature then
 * waits on the device like any other.
 */

function instructionsAddress(jobId: string): string {
  return `/auftraege/${jobId}/belehrung`
}

/** The card "Belehrungen" of a service call for a consumer on the job sheet. */
export function JobInstructionsCard({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const client = useSync()
  const { applies, customer } = useConsumerCall(job)
  const requests = useEarlyStarts(jobId)
  const signs = useMay('job.progress')

  if (applies !== true) {
    return null
  }

  const name = customer ? text(customer, 'name') : 'Der Kunde'

  return (
    <Panel title="Belehrungen">
      <div className="flex flex-col gap-2.5">
        <SiteText size={16}>
          {`${name} ist Verbraucher. Zeigen Sie ihm Widerrufsbelehrung und Formular, wenn er den Auftrag hier erteilt oder erweitert; soll die Arbeit gleich beginnen, unterschreibt er das Verlangen auf vorzeitigen Beginn.`}
        </SiteText>
        {requests.length === 0 ? (
          <SiteText muted size={16}>
            Noch nicht an der Tür unterschrieben.
          </SiteText>
        ) : (
          requests.map((request) => (
            <SiteText key={String(request['id'])} size={16}>
              {`Vorzeitigen Beginn verlangt: ${text(request, 'signerName')}, ${moment(maybeText(request, 'signedAt'))} Uhr. `}
              {client.isPending('early_start_requests', String(request['id']))
                ? 'Noch nicht übertragen; mit dem nächsten Abgleich gehen Belehrungen und Verlangen per E-Mail an ihn.'
                : 'Belehrungen und Verlangen gehen per E-Mail an ihn.'}
            </SiteText>
          ))
        )}
        {signs ? (
          <Link
            to={instructionsAddress(jobId)}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-control border border-control bg-surface px-4 text-[17px] font-semibold text-ink no-underline"
          >
            <Signature size={20} strokeWidth={2.2} aria-hidden="true" />
            Belehrung zeigen
          </Link>
        ) : null}
      </div>
    </Panel>
  )
}

function Sheet({
  title,
  words,
  open = false,
}: {
  readonly title: string
  readonly words: string
  readonly open?: boolean
}) {
  return (
    <details open={open} className="group rounded-[6px] border border-line bg-surface">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-2.5 px-3.5 text-[17px] font-semibold">
        <span className="flex-1">{title}</span>
        <ChevronDown
          size={20}
          strokeWidth={2.2}
          aria-hidden="true"
          className="text-ink-faint transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-3.5 pb-3.5">
        <InstructionText text={words} className="text-[15px] leading-[1.5]" />
      </div>
    </details>
  )
}

export function SiteInstructionsScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const job = useRecord('jobs', jobId)
  const client = useSync()
  const navigate = useNavigate()
  const { online } = useSyncStatus()
  const facts = useQuery({
    queryKey: callInstructionsKey(jobId ?? ''),
    queryFn: () => callInstructions(jobId ?? ''),
    enabled: jobId !== undefined && online,
    retry: false,
    staleTime: 5 * 60_000,
  })
  const [signerName, setSignerName] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const formId = useId()

  if (!job || !jobId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen Auftrag hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  const header = <SiteHeader title="Belehrung" sub={text(job, 'designation')} />
  const data = facts.data

  if (!data) {
    return (
      <SiteScreen>
        {header}
        <SiteText>
          {online
            ? facts.isError
              ? 'Die Belehrung ließ sich nicht laden.'
              : 'Die Belehrung wird geladen.'
            : 'Die Belehrung lädt das Gerät mit Netz: die Fassung des Betriebs liegt auf dem Server.'}
        </SiteText>
      </SiteScreen>
    )
  }

  if (data.refusal !== null || data.request === null || data.gaps.length > 0) {
    return (
      <SiteScreen>
        {header}
        <SiteTrouble>
          {data.refusal ??
            (data.gaps.length > 0
              ? `Die Belehrung lässt sich noch nicht zeigen. ${data.gaps.join(' ')}`
              : 'Der Betrieb hat keinen Vordruck für den vorzeitigen Beginn.')}
        </SiteTrouble>
      </SiteScreen>
    )
  }

  const request = data.request
  const sheets = data.sheets.filter((sheet) => sheet.template !== 'early_start')

  async function sign(event: FormEvent) {
    event.preventDefault()

    const nameProblem = signerNameProblem(signerName)

    if (nameProblem !== null) {
      setProblem(nameProblem)

      return
    }

    if (!path || !jobId) {
      setTrouble('Bitte im Feld unterschreiben.')

      return
    }

    setProblem(undefined)
    setTrouble(null)
    setWorking(true)

    try {
      const made = await client.create('early_start_requests', {
        jobId,
        signerName: signerName.trim(),
        signedAt: new Date().toISOString(),
        deviceInfo: globalThis.navigator.userAgent.slice(0, longestDeviceInfo),
        path,
        contentFingerprint: data?.fingerprint ?? '',
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      await navigate({ to: `/auftraege/${jobId}` })
    } finally {
      setWorking(false)
    }
  }

  return (
    <SiteScreen>
      {header}
      <p className="text-[18px] leading-[1.45] font-semibold">
        Bitte lesen Sie die Belehrung. Soll die Arbeit vor Ablauf der Widerrufsfrist beginnen,
        unterschreiben Sie unten.
      </p>

      {job['urgentRepair'] === true ? <UrgentRepairNote site /> : null}

      {sheets.map((sheet, index) => (
        <Sheet key={sheet.template} title={sheet.title} words={sheet.text} open={index === 0} />
      ))}

      <form
        id={formId}
        className="contents"
        onSubmit={(event) => {
          void sign(event)
        }}
      >
        <Panel
          title={
            data.sheets.find((sheet) => sheet.template === 'early_start')?.title ??
            'Verlangen auf vorzeitigen Leistungsbeginn'
          }
        >
          <div className="flex flex-col gap-3">
            <InstructionText text={request} className="text-[16px] leading-[1.5]" />
            <Field
              label="Name"
              autoComplete="off"
              value={signerName}
              problem={problem}
              onChange={(event) => {
                setSignerName(event.target.value)
              }}
            />
            <SignaturePad label="Unterschriftsfeld" onChange={setPath} />
          </div>
        </Panel>
      </form>

      <SiteText muted size={15}>
        {data.email
          ? `Belehrung, Formular und das unterschriebene Verlangen gehen per E-Mail an ${data.email}.`
          : 'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt. Das Büro schickt oder druckt die Belehrung.'}
      </SiteText>

      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      <SiteActionBar stacked>
        <Button type="submit" form={formId} tone="primary" wide icon={Check} disabled={working}>
          Unterschreiben
        </Button>
        <Button
          wide
          height={48}
          disabled={working}
          onClick={() => {
            void navigate({ to: `/auftraege/${jobId}` })
          }}
        >
          Zurück zum Auftrag
        </Button>
      </SiteActionBar>
    </SiteScreen>
  )
}
