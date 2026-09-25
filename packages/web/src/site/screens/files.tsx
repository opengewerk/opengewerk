import type { RecordState } from '@opengewerk/domain'
import { useParams } from '@tanstack/react-router'

import { Panel } from '../../components/index.js'
import { AddFiles, AttachmentList } from '../../app/attachments.js'
import { useMay } from '../../app/queries.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated } from '../../sync/provider.js'
import { SiteHeader } from '../header.js'
import { SiteScreen, SiteText } from '../kit.js'

/** Where the photos and files of a job are, on a screen of their own. */
export function filesPath(jobId: string): string {
  return `/auftraege/${jobId}/dateien`
}

function homeOf(job: RecordState) {
  return {
    customerId: String(job['customerId']),
    siteId: maybeText(job, 'siteId'),
    installationId: maybeText(job, 'installationId'),
    jobId: String(job['id']),
  }
}

/**
 * Photos and files at a job on site (#77): the type plate, the cabinet before
 * and after, the plan taped inside its door. As the card of the board
 * "Auftrag, ganze Seite": taking a photo and adding a file side by side, then
 * a row per file that opens the screen of the files. It works without a
 * network like everything else here: the photo waits on the device and goes
 * up with the next exchange.
 *
 * A photo hangs on the job and on everything the job is about, so the office
 * finds it at the installation and the customer as well.
 */
export function JobFiles({ job }: { readonly job: RecordState }) {
  const reads = useMay('attachment.read')
  const writes = useMay('attachment.write')
  const jobId = String(job['id'])
  const attachments = useRelated('attachments', 'jobId', jobId)

  if (!reads) {
    return null
  }

  return (
    <Panel title="Fotos und Dateien">
      <div className="flex flex-col gap-2">
        {writes ? (
          <AddFiles camera cameraTone="secondary" keepChoice={false} home={homeOf(job)} />
        ) : null}
        <AttachmentList
          attachments={attachments}
          writes={writes}
          rowsTo={filesPath(jobId)}
          empty="Zu diesem Auftrag gibt es noch kein Foto und keine Datei."
        />
      </div>
    </Panel>
  )
}

/**
 * The photos and files of a job, the board "Fotos und Dateien": adding them,
 * whether photos keep their full size, and each file with what can be done
 * with it, opened, replaced by a new version or taken off.
 */
export function SiteFilesScreen() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string }
  const job = useRecord('jobs', jobId)
  const reads = useMay('attachment.read')
  const writes = useMay('attachment.write')
  const attachments = useRelated('attachments', 'jobId', jobId)

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

  return (
    <SiteScreen>
      <SiteHeader title="Fotos und Dateien" sub={text(job, 'designation')} />
      {writes ? <AddFiles camera height={56} home={homeOf(job)} /> : null}
      {reads ? (
        <Panel>
          <AttachmentList
            attachments={attachments}
            writes={writes}
            empty="Zu diesem Auftrag gibt es noch kein Foto und keine Datei."
          />
        </Panel>
      ) : (
        <SiteText muted>Mit deiner Rolle siehst du hier keine Dateien.</SiteText>
      )}
    </SiteScreen>
  )
}
