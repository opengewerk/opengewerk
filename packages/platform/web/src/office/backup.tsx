import { type BackupStatus, defaultBackupTime } from '@opengewerk/platform-domain'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Server, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { Panel } from '../components/panel.js'
import { Strip, stripAction } from '../components/strip.js'
import { moment } from '../format.js'
import { useRight } from '../session/queries.js'
import { request } from '../sync/transport.js'
import { FactList, NoteBox } from './kit.js'
import { Saved, SettingsPage, SettingsText } from './settings.js'

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

/**
 * When the last backup of the instance finished, and whether that is too long
 * ago (`backupStatusParts`). Read straight at the route, like the other
 * settings: a device without a network has no backup to report on.
 */
export function backupStatus(): Promise<BackupStatus> {
  return request<BackupStatus>('/settings/backup')
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
 * older than two days, or none at all for a tenant of more than two days.
 * Nothing for an instance that knows nothing about backups, which is a
 * development machine or the preview, and nothing for an answer that is not
 * one of the three.
 */
export function backupIsBehind(status: BackupStatus | undefined): boolean {
  return (status?.state === 'none' || status?.state === 'recorded') && status.overdue
}

/** When the backup runs, as the answer names it, or the default before there is one. */
function timeOf(status: BackupStatus | undefined): string {
  return status && status.state !== 'unknown' ? status.time : defaultBackupTime
}

/** A day in milliseconds, the age under which a backup counts as last night's. */
const day = 24 * 60 * 60 * 1000

/** What the screen of the backups says, in the words of the application. */
export interface BackupWords {
  /** How the instance backs up, at the hour it does so ("02:30"), and who sets that hour. */
  readonly how: (time: string) => ReactNode
  /** Why the archives belong on another machine, and where that is described. */
  readonly elsewhere: ReactNode
  /** The warning under an archive that lies unencrypted, and what it holds. */
  readonly unencrypted: ReactNode
  /** The sentence under a backup that finished within the last day, if the application says one. */
  readonly fresh?: string
}

/**
 * The backups of the instance (#130, opengewerk-haustechnik#127): when the last one finished, and what to do
 * when it did not.
 *
 * Read-only. The backup runs every day at the hour the operators of the
 * instance set in their area (#188), 02:30 unless they chose another; no
 * tenant sets it, because one instance can carry several and none of them
 * decides for the others.
 */
export function BackupScreen({ words }: { readonly words: BackupWords }) {
  const status = useQuery(backupQuery)
  const time = timeOf(status.data)

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
          <LastBackup status={status.data} askedAt={status.dataUpdatedAt} words={words} />
        )}
      </Panel>

      <Panel title="Wie gesichert wird" roomy>
        <div className="flex flex-col gap-2.5">
          <SettingsText>{words.how(time)}</SettingsText>
          <SettingsText muted>{words.elsewhere}</SettingsText>
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

function LastBackup({
  status,
  askedAt,
  words,
}: {
  readonly status: BackupStatus
  /** When the answer came, the moment the age of the last backup is counted to. */
  readonly askedAt: number
  readonly words: BackupWords
}) {
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
      <SettingsText>Noch keine Sicherung. Die erste läuft um {status.time} Uhr.</SettingsText>
    )
  }

  const fresh =
    words.fresh !== undefined &&
    !status.overdue &&
    askedAt - new Date(status.finishedAt).getTime() < day

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
      {fresh ? <Saved>{words.fresh}</Saved> : null}
      {status.overdue ? (
        <Behind>
          Die letzte Sicherung ist älter als zwei Tage. Läuft der Dienst{' '}
          <code>backup-schedule</code>? Was er meldet, steht in{' '}
          <code>docker compose logs backup-schedule</code>.
        </Behind>
      ) : null}
      {status.encrypted ? null : (
        <NoteBox tone="waiting" icon={TriangleAlert}>
          {words.unencrypted}
        </NoteBox>
      )}
    </div>
  )
}

/**
 * The line at the top of the office when the backups are behind, for whoever
 * holds the right the application names, the one the route of the last
 * backup is read with. A backup nobody watches is the one that turns out to
 * be missing on the day it is needed; this line is the watching.
 */
export function BackupBar({ right }: { readonly right: string }) {
  const sees = useRight(right)
  const status = useQuery({ ...backupQuery, enabled: sees })

  if (!sees || !backupIsBehind(status.data)) {
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
