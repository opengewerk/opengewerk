import { useParams } from '@tanstack/react-router'

/**
 * Where the structure of an installation hangs on site: under the job that
 * brought the technician there, `/auftraege/<job>`, or under the installation
 * a QR label opened, `/anlagen/<installation>` (#308). The screens of boards,
 * circuits, inverters and strings are the same under both; only the way to
 * them and the way back differ. Null outside either.
 */
export function useStructureBase(): string | null {
  const { jobId, installationId } = useParams({ strict: false }) as {
    jobId?: string
    installationId?: string
  }

  if (jobId) {
    return `/auftraege/${jobId}`
  }

  return installationId ? `/anlagen/${installationId}` : null
}
