import { AddFiles, type AttachmentHome, AttachmentList } from '../../app/attachments.js'
import { useMay } from '../../app/queries.js'
import { useRelated } from '../../sync/provider.js'
import { Section } from '../layout.js'

/**
 * The files at a customer, a site, an installation or a job, on its screen in
 * the office (#77).
 *
 * `field` and `id` say which files are listed, `home` where a new one hangs:
 * at a job that is the job and everything the job is about, so the plan added
 * there is found at its installation later as well.
 */
export function AttachmentsSection({
  field,
  id,
  home,
  empty,
}: {
  readonly field: 'customerId' | 'siteId' | 'installationId' | 'jobId'
  readonly id: string
  readonly home: AttachmentHome
  readonly empty: string
}) {
  const reads = useMay('attachment.read')
  const writes = useMay('attachment.write')
  const attachments = useRelated('attachments', field, id)

  if (!reads) {
    return null
  }

  return (
    <Section title="Dateien">
      {writes ? (
        <div className="mb-4">
          <AddFiles home={home} />
        </div>
      ) : null}
      <AttachmentList attachments={attachments} writes={writes} empty={empty} />
    </Section>
  )
}
