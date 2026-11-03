import {
  berlinClock,
  customerTitleOf,
  type CustomerId,
  type DeadlineKind,
  filledMailSubject,
  filledMailText,
  type IsoDate,
  lastServiceDay,
  letterheadSignature,
  type MailFacts,
  type MaintenanceContractId,
  reminderSentence,
  reminderWay,
  type SiteId,
  sharesTasksBySite,
  type TenantId,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'

import { parameterAt } from '../database/parameters.js'
import {
  customers,
  mailOutbox,
  maintenanceContracts,
  sites,
  tasks,
} from '../database/schema/index.js'
import { issuerOf } from '../documents/content.js'
import type { DeadlineRow } from '../deadlines/engine.js'
import { mailTextOf } from './confirmation-mail.js'
import { signatureFor } from './notify.js'

/** What the action needs of the pass that runs it. */
export interface CustomerReminder {
  readonly tenantId: TenantId
  readonly kind: DeadlineKind
  readonly deadline: DeadlineRow
  readonly responsible: string | null
  readonly now: Date
}

/** The notes of the task to call, the same for every one, which is how a shared one is found. */
export const callNotes = 'Erinnerung an den Kunden'

function germanDay(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/**
 * The contract a deadline belongs to, by its number, or null: the
 * maintenance of a contract is the contract's own, and the inspection of an
 * installation belongs to a contract of its customer that covers the
 * installation and still runs on the day the inspection is due.
 */
async function contractOf(tx: TenantTransaction, kind: DeadlineKind, deadline: DeadlineRow) {
  if (kind.source === 'maintenance_visit') {
    const [own] = await tx
      .select({ number: maintenanceContracts.number })
      .from(maintenanceContracts)
      .where(eq(maintenanceContracts.id, String(deadline.sourceId) as MaintenanceContractId))

    return own?.number ?? null
  }

  if (deadline.installationId === null || deadline.customerId === null) {
    return null
  }

  const covering = await tx
    .select({
      number: maintenanceContracts.number,
      startsOn: maintenanceContracts.startsOn,
      termMonths: maintenanceContracts.termMonths,
      renewal: maintenanceContracts.renewal,
      renewalMonths: maintenanceContracts.renewalMonths,
      noticeMonths: maintenanceContracts.noticeMonths,
      endsOn: maintenanceContracts.endsOn,
    })
    .from(maintenanceContracts)
    .where(
      and(
        eq(maintenanceContracts.customerId, deadline.customerId as CustomerId),
        sql`${deadline.installationId}::uuid = any(${maintenanceContracts.installationIds})`,
      ),
    )
    .orderBy(maintenanceContracts.number)

  const running = covering.find((contract) => {
    const last = lastServiceDay({
      ...contract,
      startsOn: contract.startsOn as IsoDate,
      endsOn: contract.endsOn as IsoDate | null,
    } as Parameters<typeof lastServiceDay>[0])

    return last === null || last >= deadline.dueOn
  })

  return running?.number ?? null
}

/**
 * The action `customer_reminder` (#316, 1.2 and 3.7): once a deadline comes
 * within its lead, its customer is reminded of what is due, when the business
 * has switched the reminders on and the customer may be reminded.
 *
 * - By mail where the customer has an address: the business's snippet for
 *   the occasion, or the shipped one, with the sentence its ground asks for
 *   below and the signature under it. One mail per kind, cause and day; the
 *   appliances of a site due together share one, as they share their task.
 * - By a call where they have none and a call is allowed: a task for the
 *   person the deadline names, due today, shared the same way. It is not the
 *   deadline's task, so doing it does not do the inspection.
 *
 * Nothing here stops the pass: whatever is missing means no reminder.
 */
export async function remindCustomer(
  tx: TenantTransaction,
  { tenantId, kind, deadline, responsible, now }: CustomerReminder,
): Promise<void> {
  if (deadline.customerId === null) {
    return
  }

  const today = berlinClock(now).day

  if ((await parameterAt(tx, 'customer_reminder.mail', today))?.value !== 1) {
    return
  }

  const [customer] = await tx
    .select({
      name: customers.name,
      email: customers.email,
      ground: customers.reminderGround,
    })
    .from(customers)
    .where(and(eq(customers.id, deadline.customerId as CustomerId), isNull(customers.deletedAt)))

  if (!customer) {
    return
  }

  const contract = await contractOf(tx, kind, deadline)
  const way = reminderWay(customer.ground, contract !== null, customer.email !== null)

  if (way === null) {
    return
  }

  const [site] =
    deadline.siteId === null
      ? []
      : await tx
          .select({ designation: sites.designation })
          .from(sites)
          .where(eq(sites.id, deadline.siteId as SiteId))
  const due = customerTitleOf(kind, deadline.sourceLabel, site?.designation ?? null)
  const shared = sharesTasksBySite(kind) && deadline.siteId !== null

  if (way === 'call') {
    if (responsible === null) {
      return
    }

    const title = `Kunden anrufen: ${due}, fällig am ${germanDay(deadline.dueOn)}`
    const [open] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.title, title),
          eq(tasks.notes, callNotes),
          eq(tasks.assigneeUserId, responsible),
          eq(tasks.customerId, deadline.customerId as CustomerId),
          eq(tasks.dueOn, today),
          ne(tasks.status, 'done'),
          isNull(tasks.createdBy),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1)

    if (!open) {
      await tx.insert(tasks).values({
        tenantId,
        title,
        notes: callNotes,
        dueOn: today,
        assigneeUserId: responsible,
        customerId: deadline.customerId as CustomerId,
        siteId: deadline.siteId as SiteId | null,
      })
    }

    return
  }

  const issuer = await issuerOf(tx, tenantId)
  const text = await mailTextOf(tx, 'due_reminder')
  const facts: MailFacts = {
    kunde: customer.name,
    termin: null,
    auftrag: null,
    benutzer: null,
    briefkopf: letterheadSignature(issuer),
    frist: due,
    datum: germanDay(deadline.dueOn),
  }
  const signature = await signatureFor(tx, tenantId, issuer, null)
  const body = `${filledMailText(text.text, facts)}\n\n${reminderSentence(customer.ground, contract)}`

  await tx
    .insert(mailOutbox)
    .values({
      tenantId,
      kind: 'customer_reminder',
      cause: `customer_reminder:${kind.key}:${deadline.customerId}:${shared ? deadline.siteId : deadline.id}:${deadline.dueOn}`,
      requestedBy: null,
      senderName: issuer.name,
      replyTo: issuer.email,
      recipientAddress: customer.email ?? '',
      recipientName: customer.name,
      subject: filledMailSubject(text.subject, facts),
      body: `${body}\n\n-- \n${signature}`,
    })
    .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
}
