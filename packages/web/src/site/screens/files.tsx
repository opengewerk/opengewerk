import type { RecordState } from '@opengewerk/domain'

import { Card } from '../../components/index.js'
import { AddFiles, AttachmentList } from '../../app/attachments.js'
import { useMay } from '../../app/queries.js'
import { maybeText } from '../../sync/fields.js'
import { useRelated } from '../../sync/provider.js'

/**
 * Photos and files at a job on site (#77): the type plate, the cabinet before
 * and after, the plan taped inside its door. Taking a photo is the first
 * button, because it is what somebody on a ladder wants from this card, and
 * it works without a network like everything else here: the photo waits on
 * the device and goes up with the next exchange.
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
    <Card label="Fotos und Dateien">
      <div className="flex flex-col gap-4">
        {writes ? (
          <AddFiles
            camera
            home={{
              customerId: String(job['customerId']),
              siteId: maybeText(job, 'siteId'),
              installationId: maybeText(job, 'installationId'),
              jobId,
            }}
          />
        ) : null}
        <AttachmentList
          attachments={attachments}
          writes={writes}
          empty="Zu diesem Auftrag gibt es noch kein Foto und keine Datei."
        />
      </div>
    </Card>
  )
}
