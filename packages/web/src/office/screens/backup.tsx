import type { BackupStatus } from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Server, TriangleAlert } from 'lucide-react'

import { moment } from '../../app/format.js'
import { Panel, Strip, stripAction } from '../../components/index.js'
import { useMay } from '../../app/queries.js'
import { backupStatus } from '../../session/backup.js'
import { FactList, NoteBox } from '../kit.js'
import { SettingsPage, SettingsText } from '../settings-frame.js'

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
    <SettingsPage
      active="sicherung"
      title="Sicherung"
      sub="Wann diese Instanz zuletzt gesichert wurde."
    >
      <Panel title="Letzte Sicherung" roomy>
        {status.isPending ? (
          <SettingsText muted>Wird geladen.</SettingsText>
        ) : status.isError ? (
          <SettingsText muted>Der Stand kam nicht an.</SettingsText>
        ) : (
          <LastBackup status={status.data} />
        )}
      </Panel>

      <Panel title="Wie gesichert wird" roomy>
        <div className="flex flex-col gap-2.5">
          <SettingsText>
            Jede Nacht um 02:30 Uhr sichert die Instanz die Datenbank und den Dateispeicher in ein
            Archiv, und vierzehn Generationen bleiben. War der Rechner zu dieser Zeit aus, holt sie
            die Sicherung nach, sobald er wieder läuft.
          </SettingsText>
          <SettingsText muted>
            Eine Sicherung auf derselben Platte wie die Daten übersteht einen Fehler, aber keinen
            Ausfall der Platte. Wer die Instanz betreibt, legt die Archive deshalb auf eine andere
            Maschine, über <code>BACKUP_TARGET</code>; die README beschreibt, wie.
          </SettingsText>
        </div>
      </Panel>
    </SettingsPage>
  )
}

/** A backup that is behind, in red: something to act on. */
function Behind({ children }: { readonly children: ReactNode }) {
  return (
    <div role="alert">
      <NoteBox tone="conflict" icon={TriangleAlert}>
        {children}
      </NoteBox>
    </div>
  )
}

function LastBackup({ status }: { readonly status: BackupStatus }) {
  if (status.state === 'unknown') {
    return (
      <SettingsText>
        Diese Instanz weiß nichts über Sicherungen. So ist es auf einem Entwicklungsrechner und in
        der Vorschau; eine Installation über Docker Compose sichert jede Nacht und meldet es hier.
      </SettingsText>
    )
  }

  if (status.state === 'none') {
    return status.overdue ? (
      <Behind>
        Diese Instanz wurde noch nie gesichert. Läuft der Dienst <code>backup-schedule</code>? Was
        er meldet, steht in <code>docker compose logs backup-schedule</code>.
      </Behind>
    ) : (
      <SettingsText>
        Noch keine Sicherung. Die erste läuft in der kommenden Nacht um 02:30 Uhr.
      </SettingsText>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <FactList
        keyWidth={110}
        facts={[
          { label: 'Fertig', value: moment(status.finishedAt) },
          { label: 'Archiv', value: `${status.archive}, ${size(status.bytes)}` },
          { label: 'Verschlüsselt', value: status.encrypted ? 'Ja' : 'Nein' },
        ]}
      />
      {status.overdue ? (
        <Behind>
          Die letzte Sicherung ist älter als zwei Tage. Läuft der Dienst{' '}
          <code>backup-schedule</code>? Was er meldet, steht in{' '}
          <code>docker compose logs backup-schedule</code>.
        </Behind>
      ) : null}
      {status.encrypted ? null : (
        <NoteBox tone="waiting" icon={TriangleAlert}>
          Das Archiv liegt unverschlüsselt, und es enthält Kundendaten und Belege. Mit einem
          öffentlichen Schlüssel in <code>BACKUP_AGE_RECIPIENT</code> wird es verschlüsselt; die
          README beschreibt, wie.
        </NoteBox>
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
