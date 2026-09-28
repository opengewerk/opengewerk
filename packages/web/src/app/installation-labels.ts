import type { LabelFormat, RecordState } from '@opengewerk/domain'

import { useHoldsAll, useRelated, useRecords, useSyncStatus } from '../sync/provider.js'
import { request } from '../sync/transport.js'

/**
 * The QR labels of an installation (#308), as both entries need them: the
 * office makes, prints and blocks them, and a scan on site or in the browser
 * finds the installation a code belongs to. The rows come through the sync;
 * making and blocking go to the routes of the installation.
 */

function blockedAtOf(label: RecordState): string | null {
  return typeof label['blockedAt'] === 'string' ? label['blockedAt'] : null
}

/** Whether a label still opens its installation. */
export function isValidLabel(label: RecordState): boolean {
  return blockedAtOf(label) === null
}

/**
 * The labels of one installation: the valid one, if there is one, and the one
 * blocked last, which the card names as long as there is no valid one.
 */
export function useInstallationLabels(installationId: string): {
  readonly valid: RecordState | null
  readonly lastBlocked: RecordState | null
} {
  const labels = useRelated('installation_labels', 'installationId', installationId)
  const valid = labels.find(isValidLabel) ?? null
  const blocked = labels
    .filter((label) => !isValidLabel(label))
    .sort((a, b) => String(blockedAtOf(b)).localeCompare(String(blockedAtOf(a))))

  return { valid, lastBlocked: blocked[0] ?? null }
}

/**
 * The label with this code on this device, valid or blocked, or null when the
 * device holds none: then the installation is not in its share of the
 * business, or the label belongs to another business or was never made.
 */
export function useLabelByCode(code: string): RecordState | null {
  const labels = useRecords('installation_labels')

  return labels.find((label) => label['code'] === code) ?? null
}

/**
 * What a code opens on this device, the answer the scanner on site and the
 * address in the browser give alike.
 *
 * `waiting` while the device has not finished its first exchange and could
 * still learn of the label; `unknown` when it holds none with this code, and
 * whether it holds every label of the business, which tells "not in this
 * business" from "not on this device".
 */
export type LabelLookup =
  | { readonly state: 'waiting' }
  | { readonly state: 'open'; readonly installationId: string }
  | { readonly state: 'blocked' }
  | { readonly state: 'unknown'; readonly wholeBusiness: boolean }

export function useLabelLookup(code: string): LabelLookup {
  const label = useLabelByCode(code)
  const { lastSyncedAt, online } = useSyncStatus()
  const wholeBusiness = useHoldsAll('installation_labels')

  if (label) {
    return isValidLabel(label)
      ? { state: 'open', installationId: String(label['installationId']) }
      : { state: 'blocked' }
  }

  if (lastSyncedAt === null && online) {
    return { state: 'waiting' }
  }

  return { state: 'unknown', wholeBusiness }
}

/** The words for a code that opens nothing, the same on site and in the office. */
export const labelMessages = {
  blocked: {
    title: 'Dieses Etikett ist gesperrt',
    lines: [
      'Es öffnet keine Anlage mehr. Klebt es noch an einer Anlage, gehört es ab; ein neues gibt es im Büro an der Anlage.',
    ],
  },
  notHere: {
    title: 'Diese Anlage liegt nicht auf diesem Gerät',
    lines: [
      'Auf dem Gerät liegen die Anlagen der Aufträge, denen du zugeordnet bist, und die übrigen Anlagen an deren Objekten.',
      'Gehört die Anlage zu einem neuen Auftrag für dich, holt der Abgleich sie, sobald das Gerät Verbindung hat.',
    ],
  },
  notOurs: {
    title: 'Dieses Etikett kennt der Betrieb nicht',
    lines: [
      'Es gehört zu keiner Anlage dieses Betriebs. Vielleicht stammt es von einem anderen Betrieb.',
    ],
  },
  foreign: {
    title: 'Das ist kein Etikett einer Anlage',
    lines: [
      'Der Code gehört zu keinem Etikett aus OpenGewerk. Etiketten einer Anlage legt das Büro an der Anlage an.',
    ],
  },
} as const

const base = (installationId: string) =>
  `/installations/${encodeURIComponent(installationId)}/labels`

/** A new label for the installation; the server draws the code. */
export function createLabel(installationId: string): Promise<{ readonly id: string }> {
  return request(base(installationId), { method: 'POST' })
}

/** Blocks a label for good. */
export function blockLabel(installationId: string, labelId: string): Promise<unknown> {
  return request(`${base(installationId)}/${encodeURIComponent(labelId)}/block`, {
    method: 'POST',
  })
}

/** The address of the PDF, for a link that opens it. */
export function labelPdfAddress(
  installationId: string,
  labelId: string,
  format: LabelFormat,
  count: number,
  start: number,
): string {
  const query = new URLSearchParams({ format, count: String(count) })

  if (format === 'sheet') {
    query.set('start', String(start))
  }

  return `${base(installationId)}/${encodeURIComponent(labelId)}/pdf?${query.toString()}`
}
