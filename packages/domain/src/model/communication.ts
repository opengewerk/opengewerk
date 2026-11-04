import type { CommunicationId, CustomerId, SiteId } from './identifier.js'

/**
 * The history at a customer and at a site (#313, 3.1 and 3.4): what the
 * office wrote down about the customer, a note or a call, each with who and
 * when, and from then on unchanged, like the notes of a job (#220): a
 * correction is a new entry. Beside them the history shows what OpenGewerk
 * sent the customer itself and the appointments of the customer's jobs.
 */
export const communicationKinds = ['note', 'call'] as const

export type CommunicationKind = (typeof communicationKinds)[number]

export const callDirections = ['incoming', 'outgoing'] as const

export type CallDirection = (typeof callDirections)[number]

export const callDirectionLabel: Readonly<Record<CallDirection, string>> = {
  incoming: 'Eingehend',
  outgoing: 'Ausgehend',
}

export interface Communication {
  readonly id: CommunicationId
  readonly customerId: CustomerId
  /** The site it is about; null for the customer as a whole. */
  readonly siteId: SiteId | null
  readonly kind: CommunicationKind
  /** Who called whom, for a call only. */
  readonly direction: CallDirection | null
  /** Who was on the telephone, when it was not the customer; for a call only. */
  readonly counterpart: string | null
  readonly text: string
  /** When it happened, which may be a little before it was written down. */
  readonly happenedAt: string
  /** Who wrote it, from the request. */
  readonly createdBy: string | null
}

export const communicationLimits = {
  text: 5000,
  counterpart: 200,
} as const

/** How far a moment may lie ahead of the server's clock and still be now, for a device a little fast. */
const aheadToleranceMs = 5 * 60 * 1000

/** The title of an entry, "Notiz" or "Anruf, eingehend". */
export function communicationTitle(entry: Pick<Communication, 'kind' | 'direction'>): string {
  if (entry.kind === 'note') {
    return 'Notiz'
  }

  return entry.direction === 'outgoing' ? 'Anruf, ausgehend' : 'Anruf, eingehend'
}

/**
 * What is wrong with the values of an entry, by field, in the words the form
 * shows. A call has its direction and may name who was on the telephone; a
 * note has neither. It happened, so its moment is not ahead of `now`.
 */
export function communicationProblems(
  values: Readonly<Record<string, unknown>>,
  now: Date,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const kind = values['kind']

  if (!communicationKinds.includes(kind as CommunicationKind)) {
    problems['kind'] = 'Ob Notiz oder Anruf, fehlt.'
  }

  const text = values['text']

  if (typeof text !== 'string' || text.trim() === '') {
    problems['text'] = 'Ein Eintrag braucht einen Inhalt.'
  } else if (text.length > communicationLimits.text) {
    problems['text'] = `Ein Eintrag hat höchstens ${String(communicationLimits.text)} Zeichen.`
  }

  const direction = values['direction']
  const counterpart = values['counterpart']

  if (kind === 'call') {
    if (!callDirections.includes(direction as CallDirection)) {
      problems['direction'] = 'Wer wen angerufen hat, fehlt.'
    }
  } else if (direction !== null && direction !== undefined) {
    problems['direction'] = 'Nur ein Anruf hat eine Richtung.'
  }

  if (counterpart !== null && counterpart !== undefined) {
    if (kind !== 'call') {
      problems['counterpart'] = 'Nur ein Anruf hat einen Gesprächspartner.'
    } else if (typeof counterpart !== 'string') {
      problems['counterpart'] = 'Hier steht Text.'
    } else if (counterpart.length > communicationLimits.counterpart) {
      problems['counterpart'] =
        `Hier stehen höchstens ${String(communicationLimits.counterpart)} Zeichen.`
    }
  }

  const happenedAt = values['happenedAt']
  const moment = typeof happenedAt === 'string' ? Date.parse(happenedAt) : Number.NaN

  if (Number.isNaN(moment)) {
    problems['happenedAt'] = 'Wann es war, ist ein Zeitpunkt.'
  } else if (moment > now.getTime() + aheadToleranceMs) {
    problems['happenedAt'] = 'Ein Eintrag hält fest, was war, nicht was kommt.'
  }

  return problems
}

// --- The history ------------------------------------------------------------------------------

/**
 * The kinds of message the history shows: what went to the customer. A
 * reminder of a task or a deadline goes to somebody of the business, an
 * invitation and a new passkey to an account, and none of them is in it.
 */
export const customerMailKinds = [
  'document',
  'job_instructions',
  'appointment_confirmation',
  'job_received',
  'customer_reminder',
] as const

export type CustomerMailKind = (typeof customerMailKinds)[number]

export const customerMailKindLabel: Readonly<Record<CustomerMailKind, string>> = {
  document: 'Beleg',
  job_instructions: 'Belehrungen zum Serviceauftrag',
  appointment_confirmation: 'Terminbestätigung',
  job_received: 'Auftragseingang',
  customer_reminder: 'Erinnerung',
}

export type HistoryMailStatus = 'pending' | 'sent' | 'failed'

export const historyMailStatusLabel: Readonly<Record<HistoryMailStatus, string>> = {
  pending: 'wartet',
  sent: 'verschickt',
  failed: 'nicht zugestellt',
}

/** One line of the history. */
export type HistoryItem =
  | {
      readonly type: 'entry'
      readonly at: string
      readonly entry: Communication
    }
  | {
      readonly type: 'mail'
      readonly at: string
      readonly id: string
      readonly kind: CustomerMailKind
      readonly subject: string
      readonly recipient: string
      readonly status: HistoryMailStatus
      readonly siteId: string | null
    }
  | {
      readonly type: 'appointment'
      readonly at: string
      readonly id: string
      readonly endsAt: string
      readonly jobId: string
      readonly jobDesignation: string
      readonly siteId: string | null
      readonly userIds: readonly string[]
      /** A series shows once, at its first day, and says it is one. */
      readonly series: boolean
    }

export interface History {
  /** The appointments still to come, the next first. */
  readonly coming: readonly HistoryItem[]
  /** Everything else, the newest first. */
  readonly past: readonly HistoryItem[]
}

/**
 * The history in the order the board "Kundenakte mit Verlauf" draws it: the
 * appointments still to come on top, the next first, and below everything
 * that happened, the newest first. An appointment is to come until it ended.
 */
export function historyOf(items: readonly HistoryItem[], now: Date): History {
  const time = now.getTime()
  const isComing = (item: HistoryItem) =>
    item.type === 'appointment' && Date.parse(item.endsAt) > time
  const byTime = (one: HistoryItem, other: HistoryItem) => Date.parse(one.at) - Date.parse(other.at)

  return {
    coming: items.filter(isComing).sort(byTime),
    past: items.filter((item) => !isComing(item)).sort((one, other) => byTime(other, one)),
  }
}
