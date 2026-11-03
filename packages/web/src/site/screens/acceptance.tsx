import { type RecordState } from '@opengewerk/domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { SiteRow, SiteRows, SiteText, SiteTrouble } from '@opengewerk/platform-web/site'
import { refusalFor, text, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import { ClipboardCheck } from 'lucide-react'
import { useState } from 'react'

import { startAcceptance, useAcceptances, useJobStructure } from '../../app/acceptance.js'

/**
 * The acceptance of the job on site (#310), as the board "Abnahme auf dem
 * Tablet" starts it: its protocols, and a new one started from the customer
 * and the job, filled in and signed on the device by customer and contractor.
 */
export function JobAcceptance({ job }: { readonly job: RecordState }) {
  const jobId = String(job['id'])
  const client = useSync()
  const navigate = useNavigate()
  const acceptances = useAcceptances(jobId)
  const structure = useJobStructure(jobId)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function start() {
    setTrouble(null)

    const made = await startAcceptance(client, { jobId, structure })

    if (made.outcome === 'refused') {
      setTrouble(refusalFor(made))

      return
    }

    await navigate({ to: `/auftraege/${jobId}/pruefprotokolle/${made.id}` })
  }

  return (
    <Panel title="Abnahme">
      <div className="flex flex-col gap-2">
        {acceptances.length === 0 ? (
          <SiteText muted>Noch keine. Mit dem Tag der Abnahme beginnt die Gewährleistung.</SiteText>
        ) : (
          <SiteRows label="Abnahmen">
            {acceptances.map((record) => (
              <SiteRow
                key={String(record['id'])}
                to={`/auftraege/${jobId}/pruefprotokolle/${String(record['id'])}`}
                title={`Abnahme vom ${date(record['performedOn'])}`}
                right={text(record, 'status') === 'signed' ? 'Unterschrieben' : 'Entwurf'}
              />
            ))}
          </SiteRows>
        )}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
        <Button wide height={52} icon={ClipboardCheck} onClick={() => void start()}>
          Abnahme beginnen
        </Button>
      </div>
    </Panel>
  )
}
