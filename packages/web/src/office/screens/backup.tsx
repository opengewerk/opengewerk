import type { BackupStatus } from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Server } from 'lucide-react'

import { moment } from '../../app/format.js'
import { Strip, stripAction } from '../../components/index.js'
import { useMay } from '../../app/queries.js'
import { backupStatus } from '../../session/backup.js'
import { Nothing, Page, Section } from '../layout.js'

const sizes = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** A size the way a person reads it: 850 kB, 12,4 MB, 1,3 GB. */
function size(bytes: number): string {
  if (bytes < 1_000_000) {
    return `${sizes.format(bytes / 1000)} kB`
  }

  return bytes < 1_000_000_000
    ? `${sizes.format(bytes / 1_000_000)} MB`
    : `${sizes.format(bytes / 1_000_000_000)} GB`
}

/** The query the screen and the warning at the top of the office share. */
export const backupQuery = {
  queryKey: ['backup'],
  queryFn: backupStatus,
  // Once a day is what changes here; an hour keeps the warning honest without
  // asking on every screen.
  staleTime: 60 * 60 * 1000,
  retry: false,
} as const

/**
 * Whether the office should be told that the backups are behind: the last one
 * older than two days, or none at all for a business of more than two days.
 * Nothing for an instance that knows nothing about backups, which is a
 * development machine or the preview, and nothing for an answer that is not
 * one of the three.
 */
export function backupIsBehind(status: BackupStatus | undefined): boolean {
  return (status?.state === 'none' || status?.state === 'recorded') && status.overdue
}

/**
 * The backups of the instance (#130): when the last one finished, and what an
 * owner can do when it did not.
 *
 * Read-only. The backup runs every night at 02:30 without anybody setting
 * anything; the hour is fixed because one instance can carry several
 * businesses, and none of them sets it for the others.
 */
export function BackupScreen() {
  const status = useQuery(backupQuery)

  return (
    <Page title="Sicherung" meta="Wann diese Instanz zuletzt gesichert wurde.">
      <Section title="Letzte Sicherung">
        {status.isPending ? (
          <Nothing>Wird geladen.</Nothing>
        ) : status.isError ? (
          <Nothing>Der Stand kam nicht an.</Nothing>
        ) : (
          <LastBackup status={status.data} />
        )}
      </Section>

      <Section title="Wie gesichert wird">
        <div className="flex max-w-3xl flex-col gap-3 text-body">
          <p>
            Jede Nacht um 02:30 Uhr sichert die Instanz die Datenbank und den Dateispeicher in ein
            Archiv, und vierzehn Generationen bleiben. War der Rechner zu dieser Zeit aus, holt sie
            die Sicherung nach, sobald er wieder läuft.
          </p>
          <p>
            Eine Sicherung auf derselben Platte wie die Daten übersteht einen Fehler, aber keinen
            Ausfall der Platte. Wer die Instanz betreibt, legt die Archive deshalb auf eine andere
            Maschine, über <code>BACKUP_TARGET</code>; die README beschreibt, wie.
          </p>
        </div>
      </Section>
    </Page>
  )
}

function LastBackup({ status }: { readonly status: BackupStatus }) {
  if (status.state === 'unknown') {
    return (
      <p className="max-w-3xl text-body">
        Diese Instanz weiß nichts über Sicherungen. So ist es auf einem Entwicklungsrechner und in
        der Vorschau; eine Installation über Docker Compose sichert jede Nacht und meldet es hier.
      </p>
    )
  }

  if (status.state === 'none') {
    return status.overdue ? (
      <p role="alert" className="max-w-3xl text-body font-semibold text-conflict">
        Diese Instanz wurde noch nie gesichert. Läuft der Dienst <code>backup-schedule</code>? Was
        er meldet, steht in <code>docker compose logs backup-schedule</code>.
      </p>
    ) : (
      <p className="max-w-3xl text-body">
        Noch keine Sicherung. Die erste läuft in der kommenden Nacht um 02:30 Uhr.
      </p>
    )
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-body">
        <dt className="text-ink-muted">Fertig</dt>
        <dd>{moment(status.finishedAt)}</dd>
        <dt className="text-ink-muted">Archiv</dt>
        <dd>
          {status.archive}, {size(status.bytes)}
        </dd>
        <dt className="text-ink-muted">Verschlüsselt</dt>
        <dd>{status.encrypted ? 'Ja' : 'Nein'}</dd>
      </dl>
      {status.overdue ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          Die letzte Sicherung ist älter als zwei Tage. Läuft der Dienst{' '}
          <code>backup-schedule</code>? Was er meldet, steht in{' '}
          <code>docker compose logs backup-schedule</code>.
        </p>
      ) : null}
      {status.encrypted ? null : (
        <p className="text-body">
          Das Archiv liegt unverschlüsselt, und es enthält Kundendaten und Belege. Mit einem
          öffentlichen Schlüssel in <code>BACKUP_AGE_RECIPIENT</code> wird es verschlüsselt; die
          README beschreibt, wie.
        </p>
      )}
    </div>
  )
}

/**
 * The line at the top of the office when the backups are behind (#130), for
 * whoever reads the settings: the owner and the office. A backup nobody
 * watches is the one that turns out to be missing on the day it is needed;
 * this line is the watching.
 */
export function BackupBar() {
  const readsSettings = useMay('settings.read')
  const status = useQuery({ ...backupQuery, enabled: readsSettings })

  if (!readsSettings || !backupIsBehind(status.data)) {
    return null
  }

  const said =
    status.data?.state === 'recorded'
      ? `Die letzte Sicherung ist vom ${moment(status.data.finishedAt)} und damit älter als zwei Tage.`
      : 'Diese Instanz wurde noch nie gesichert.'

  // Red, as on the board "Leisten im Büro": a backup that is behind is
  // something to act on, not an offer.
  return (
    <Strip
      tone="conflict"
      icon={Server}
      urgent
      actions={
        <Link to="/einstellungen/sicherung" className={stripAction('plain', 'conflict', 'office')}>
          Ansehen
        </Link>
      }
    >
      {said}
    </Strip>
  )
}
