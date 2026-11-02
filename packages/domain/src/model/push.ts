/**
 * Push messages to the devices of the people in a business (#284), the second
 * channel of the notifications beside mail.
 *
 * An occasion is what a module raises anyway; push adds nothing of its own to
 * raise. Every occasion here goes to somebody who works in the business, never
 * to a customer: those get mail, and push for them comes with the customer
 * portal in phase 5. Each person switches off under "Konto" what they do not
 * want as push, and every occasion is on until they do.
 */
export const pushOccasions = [
  'task_due',
  'deadline_due',
  'appointment',
  'leave_request',
  'leave_decision',
] as const

export type PushOccasion = (typeof pushOccasions)[number]

export function isPushOccasion(value: unknown): value is PushOccasion {
  return typeof value === 'string' && (pushOccasions as readonly string[]).includes(value)
}

/** How an occasion is named and explained where a person switches it on or off. */
export const pushOccasionWords: Readonly<
  Record<PushOccasion, { readonly label: string; readonly about: string }>
> = {
  task_due: {
    label: 'Fällige Aufgaben',
    about: 'Am Morgen des Tages, an dem eine Aufgabe für dich fällig ist.',
  },
  deadline_due: {
    label: 'Fristen',
    about: 'Wenn eine Frist, für die du verantwortlich bist, erinnert.',
  },
  appointment: {
    label: 'Termine',
    about: 'Wenn du einen neuen Termin bekommst oder einer sich ändert oder entfällt.',
  },
  // A request goes to whoever keeps absences, its decision to whoever asked (#806).
  leave_request: {
    label: 'Urlaubsanträge',
    about: 'Wenn jemand Urlaub beantragt; nur, wenn du Abwesenheiten pflegst.',
  },
  leave_decision: {
    label: 'Entscheidung über Urlaub',
    about: 'Wenn über deinen Urlaubsantrag entschieden ist.',
  },
}

/** Where a device opens OpenGewerk: the office or the site. */
export const pushEntries = ['office', 'site'] as const

export type PushEntry = (typeof pushEntries)[number]
