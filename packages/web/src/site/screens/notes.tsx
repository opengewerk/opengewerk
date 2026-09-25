import { jobNoteProblem, type RecordState } from '@opengewerk/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check, Pencil } from 'lucide-react'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Panel, TextArea } from '../../components/index.js'
import { JobNoteList, useJobNotes } from '../../app/job-notes.js'
import { useMay } from '../../app/queries.js'
import { refusalText } from '../../sync/client.js'
import { text } from '../../sync/fields.js'
import { useRecord, useSync } from '../../sync/provider.js'
import { SiteActionBar } from '../action-bar.js'
import { SiteHeader } from '../header.js'
import { SiteScreen, SiteText, SiteTrouble } from '../kit.js'

/**
 * Notes from the site about a job (#220), as the boards "Auftrag, ganze
 * Seite" and "Notiz schreiben" draw them: at the job the notes with who wrote
 * them when, and a screen of its own to write one.
 *
 * A note is an entry of its own. Until #220 "Notiz schreiben" wrote into the
 * description of the job, which is what the office put down as the job, and
 * the office then found the note where the order had been.
 */

function notePath(jobId: string): string {
  return `/auftraege/${jobId}/notiz`
}

/** The card "Notizen" at a job: what was written there, newest first, and the way to write one. */
export function JobNotes({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const notes = useJobNotes(jobId)
  const writes = useMay('job.progress')
  const navigate = useNavigate()

  return (
    <Panel title="Notizen">
      <div className="flex flex-col gap-2">
        {notes.length === 0 ? (
          <SiteText muted>Zu diesem Auftrag gibt es noch keine Notiz.</SiteText>
        ) : (
          <JobNoteList notes={notes} />
        )}
        {writes ? (
          <Button
            wide
            height={48}
            icon={Pencil}
            onClick={() => {
              void navigate({ to: notePath(jobId) })
            }}
          >
            Notiz schreiben
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * Writing a note, the board "Notiz schreiben": the text, what becomes of it,
 * and "Abbrechen" and "Notiz sichern" at the foot, as "Zeit nachtragen" has
 * them. The note goes into the outbox with the moment it was written; who
 * wrote it, the server writes.
 */
export function SiteNoteScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const job = useRecord('jobs', jobId)
  const [value, setValue] = useState('')
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

  function back() {
    void navigate({ to: `/auftraege/${String(jobId)}` })
  }

  async function save(event: FormEvent) {
    event.preventDefault()

    const note = value.trim()
    const wrong = jobNoteProblem(note)

    if (wrong !== null) {
      setProblem(wrong)

      return
    }

    setProblem(undefined)
    setTrouble(null)
    setWorking(true)

    try {
      const made = await client.create('job_notes', {
        jobId: String(jobId),
        text: note,
        writtenAt: new Date().toISOString(),
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalText[made.reason])

        return
      }

      back()
    } finally {
      setWorking(false)
    }
  }

  return (
    <SiteScreen gap={14}>
      <SiteHeader title="Notiz schreiben" sub={text(job, 'designation')} />

      <form
        id={formId}
        className="contents"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <TextArea
          label="Was passiert ist"
          rows={3}
          value={value}
          problem={problem}
          onChange={(event) => {
            setValue(event.target.value)
          }}
        />
      </form>

      <SiteText muted size={16}>
        Die Notiz steht mit Ihrem Namen und der Uhrzeit am Auftrag, und so bleibt sie: ändern lässt
        sie sich nicht. Das Büro sieht sie, sobald das Gerät Netz hat. Was zu tun ist, schreibt
        weiter das Büro.
      </SiteText>

      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}

      <SiteActionBar>
        <Button wide className="flex-1 basis-0" disabled={working} onClick={back}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          form={formId}
          tone="primary"
          wide
          icon={Check}
          className="flex-2 basis-0"
          disabled={working}
        >
          Notiz sichern
        </Button>
      </SiteActionBar>
    </SiteScreen>
  )
}
