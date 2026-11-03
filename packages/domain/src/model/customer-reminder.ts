import type { IsoDate } from '@opengewerk/platform-domain'

/**
 * Reminders of a due inspection or maintenance to the customer (#316,
 * Feature-Gliederung 3.7, decided on 27.09.2026).
 *
 * With a maintenance contract the reminder belongs to the contract. Without
 * one it is advertising, which by mail needs a consent given beforehand
 * (§ 7 Abs. 2 Nr. 2 UWG) or the ground of § 7 Abs. 3 UWG: the business got
 * the address when it sold a good or service, reminds of its own similar
 * services, told the customer at the time that they may object, and says so
 * again in every mail. That ground covers mail and nothing else; a call to a
 * consumer needs a consent of its own (§ 7 Abs. 2 Nr. 1 UWG), so a customer
 * of that ground without an address is not called.
 *
 * Which ground a customer has is what the office stored at the customer;
 * none means only the reminders of a contract. A customer who stopped them
 * gets none at all, a contract's included.
 */
export const reminderGrounds = ['consent', 'existing_customer', 'objected'] as const

export type ReminderGround = (typeof reminderGrounds)[number]

/** The choice of the form, with none first: only what a contract brings. */
export const reminderGroundLabel: Readonly<Record<ReminderGround | 'none', string>> = {
  none: 'Nur zu einem Wartungsvertrag',
  consent: 'Einwilligung',
  existing_customer: 'Bestandskunde nach § 7 Abs. 3 UWG',
  objected: 'Abbestellt',
}

/** What each choice means, as the form explains it; the board of the canvas, version 135, uses the same words. */
export const reminderGroundExplanation: Readonly<Record<ReminderGround | 'none', string>> = {
  none: 'Erinnert wird nur an Wartungen und Prüfungen, die zu einem laufenden Wartungsvertrag gehören.',
  consent:
    'Der Kunde hat ausdrücklich eingewilligt, an fällige Prüfungen und Wartungen erinnert zu werden, per E-Mail oder Telefon. Die Einwilligung bewahrt der Betrieb auf.',
  existing_customer:
    'Nur per E-Mail, und nur, wenn der Betrieb die Adresse beim Verkauf einer Ware oder Dienstleistung bekommen und den Kunden dabei auf sein Widerspruchsrecht hingewiesen hat. Jede Erinnerung nennt es. Angerufen wird nur mit einer Einwilligung.',
  objected: 'Der Kunde bekommt keine Erinnerungen mehr, auch nicht zu einem Wartungsvertrag.',
}

function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** The ground of a customer as a fact of the record: "Einwilligung vom 12.03.2024". */
export function reminderGroundText(ground: ReminderGround | null, since: IsoDate | null): string {
  if (ground === null) {
    return reminderGroundLabel.none
  }

  const label = reminderGroundLabel[ground]

  if (since === null) {
    return label
  }

  switch (ground) {
    case 'consent':
      return `${label} vom ${germanDay(since)}`
    case 'existing_customer':
      return `${label}, seit ${germanDay(since)}`
    case 'objected':
      return `${label} am ${germanDay(since)}`
  }
}

/**
 * How a customer is reminded of something due, or null when not at all: by
 * mail where there is an address, by a call where a call is allowed.
 */
export type ReminderWay = 'mail' | 'call'

export function reminderWay(
  ground: ReminderGround | null,
  underContract: boolean,
  hasAddress: boolean,
): ReminderWay | null {
  if (ground === 'objected') {
    return null
  }

  if (underContract || ground === 'consent') {
    return hasAddress ? 'mail' : 'call'
  }

  if (ground === 'existing_customer') {
    return hasAddress ? 'mail' : null
  }

  return null
}

/**
 * The sentence below the business's text, by what the reminder rests on:
 * the contract it belongs to, the consent that may be withdrawn, or the
 * objection § 7 Abs. 3 Nr. 4 UWG wants named in every mail. The text is the
 * business's, this sentence the law's, like the one about the instructions
 * under a confirmation (#315).
 */
export function reminderSentence(ground: ReminderGround | null, contract: string | null): string {
  if (contract !== null) {
    return `Diese Erinnerung gehört zu Ihrem Wartungsvertrag ${contract}. Möchten Sie keine Erinnerungen mehr, genügt eine kurze Antwort auf diese E-Mail.`
  }

  return ground === 'consent'
    ? 'Sie bekommen diese Erinnerung, weil Sie darin eingewilligt haben. Sie können die Einwilligung jederzeit widerrufen; eine kurze Antwort auf diese E-Mail genügt.'
    : 'Sie bekommen diese Erinnerung als unser Kunde. Sie können der Verwendung Ihrer E-Mail-Adresse für solche Erinnerungen jederzeit widersprechen, ohne dass Ihnen dafür andere als die Übermittlungskosten nach den Basistarifen entstehen; eine kurze Antwort auf diese E-Mail genügt.'
}

/**
 * What is wrong with a ground and its day as a customer is to have them, or
 * null: a ground is one of the list or none, and a ground has the day it was
 * given, which none has not.
 */
export function reminderGroundProblem(ground: unknown, since: unknown): string | null {
  if (ground === null || ground === undefined) {
    return since === null || since === undefined
      ? null
      : 'Ohne Grundlage für Erinnerungen gibt es keinen Tag dazu.'
  }

  if (typeof ground !== 'string' || !(reminderGrounds as readonly string[]).includes(ground)) {
    return 'Diese Grundlage für Erinnerungen gibt es nicht.'
  }

  if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return 'Zur Grundlage für Erinnerungen gehört der Tag, seit dem sie gilt.'
  }

  return null
}
