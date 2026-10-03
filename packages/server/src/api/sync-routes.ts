import {
  type Identity,
  isAllowed,
  isJobProgress,
  type Operation,
  type OperationKind,
  type Permission,
  type SiteAccessId,
  type TenantId,
} from '@opengewerk/domain'
import {
  type ChangedRows,
  type SecretKey,
  type SyncRoutes,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { eq, sql } from 'drizzle-orm'

import {
  accessesOfOpenJobs,
  articlesNarrowedTo,
  articlesOnDevices,
  deviceScope,
  narrowedTo,
  scopedEntities,
  sitesWithOpenJobs,
} from '../database/device-scope.js'
import { siteAccessDeliveries, siteAccessReveals, timeEntries } from '../database/schema/index.js'
import { sync } from '../database/sync.js'
import { readAccessValues } from '../secrets/site-access.js'
import { answerFor } from './database-errors.js'

// The routes a device syncs through are the foundation's (ADR 0010): reading
// an outbox, refusing one over an operation and naming it, the pull and the
// conflicts. What this application hands them is in here: the right each
// operation asks for, its words for a refusal of the database, and what the
// device of somebody holds, with the values only it puts into an answer.

/** Whether an operation sets a field to a value, as a create sets every field it has. */
function setsField(patches: Operation['patches'], field: string): boolean {
  return patches.some((patch) => patch.field === field && patch.to !== null && patch.to !== '')
}

/**
 * What an operation needs beyond the right to sync at all.
 *
 * Sending a queue is a different way in, not a different thing to do. A
 * technician who may not change a customer online may not change one through
 * an outbox either, and the check belongs here rather than in the merge, which
 * knows nothing about who is asking. That runs both ways: creating a customer
 * asks for the same right here as the route does, which is why this looks at
 * what the operation does and not only at what it touches.
 *
 * The customer is the only subject where the two differ. A contact counts as
 * part of it: writing down who opened the door is the same act as writing down
 * whose door it was.
 *
 * The job is the one subject where the fields decide (#128). Finishing a job
 * is what a technician does on site, and asks for `job.progress`; a change
 * that also says who the job is for, where it is, what it is called or what is
 * to be done asks for `job.write`, however small the rest of it is. Writing
 * down what happened is a note of its own (#220) and asks for `job.progress`
 * as well.
 * The operation is asked for the narrowest right that covers it, and whoever
 * holds `job.write` holds `job.progress` as well.
 */
export function permissionFor(
  entity: string,
  kind: OperationKind,
  patches: Operation['patches'] = [],
): Permission | null {
  // A contact of a supplier is the supplier's (#296), which a technician, who
  // may add a customer's contact on site, may not keep. Creating one names the
  // supplier; a change to a contact asks `customer.write`, which a technician
  // lacks, and the route asks for the supplier's right on top.
  if (entity === 'contacts' && kind === 'create' && setsField(patches, 'supplierId')) {
    return 'supplier.write'
  }

  if ((entity === 'customers' || entity === 'contacts') && kind === 'create') {
    return 'customer.create'
  }

  if (entity === 'jobs' && kind === 'update' && isJobProgress(patches)) {
    return 'job.progress'
  }

  // What happened on site (#220), which is the progress of the job and not
  // what the job is: the technician on it writes it.
  if (entity === 'job_notes' && kind === 'create') {
    return 'job.progress'
  }

  const subject: Record<string, Permission> = {
    customers: 'customer.write',
    contacts: 'customer.write',
    suppliers: 'supplier.write',
    // Kept at the routes of the office (#296); the policy refuses every write
    // from a device, and this names the right that keeps them.
    articles: 'article.write',
    article_prices: 'article.write',
    sites: 'site.write',
    installations: 'installation.write',
    distribution_boards: 'installation.write',
    board_sections: 'installation.write',
    circuits: 'installation.write',
    equipment: 'installation.write',
    inverters: 'installation.write',
    pv_strings: 'installation.write',
    pv_modules: 'installation.write',
    // The labels of an installation (#308) are made and blocked at its
    // routes; the policy refuses every write from a device.
    installation_labels: 'installation.write',
    jobs: 'job.write',
    documents: 'document.write',
    // A position is not a subject of its own. Whoever may write the document
    // may write its lines, and whoever may not, may not: a technician filling
    // in a report on site is doing one thing, not two.
    document_lines: 'document.write',
    // The same for a signature. The technician who wrote the report is the
    // one who hands the device to the customer.
    document_signatures: 'document.write',
    // No device writes the sources of a collective invoice (#135); the policy
    // answers any attempt with `online_only`. Named here so that the answer
    // is that conflict about the one operation and not a refused transmission.
    document_sources: 'document.write',
    // The same for who is on a job (#140), which the office sets at a route.
    job_assignments: 'job.write',
    // The ways into a site (#286), kept at the routes of the site, which ask
    // for `site.access`; the policy refuses every write from a device, and
    // this names the right to change the site they belong to. A showing is
    // written by the device that showed a value, and every device that holds
    // one writes through the sync: no right beyond that, and the person comes
    // from the request.
    site_accesses: 'site.write',
    site_access_reveals: 'sync.write',
    // And for the tags (#314): made and put on at the routes of the office.
    tags: 'customer.write',
    customer_tags: 'customer.write',
    site_tags: 'site.write',
    // A note is never changed (#220); a change sent anyway asks for the
    // right on the job itself, and the policy answers it `online_only`.
    job_notes: 'job.write',
    // A test protocol is measured at an installation and belongs to it (#79):
    // whoever may record its structure may record its test.
    form_records: 'installation.write',
    // The fields of the reports are written in the settings (#78), and a
    // device only reads them. The owner, who may write them, gets
    // `online_only` for one sent anyway; anybody else the missing right.
    form_definitions: 'settings.write',
    tasks: 'task.write',
    // A file and its versions are one thing to whoever adds them: taking a
    // photo on site is adding it, and a new version is the same act again.
    attachments: 'attachment.write',
    attachment_versions: 'attachment.write',
    // Everybody's own working time, and nobody else's: the owner of an entry
    // is written by the database from the request.
    time_entries: 'time.write',
  }

  return subject[entity] ?? null
}

/**
 * The rows of the ways into a site with what the device may know of their
 * value (#286): whether there is one and whether it opens, `valueState`, and
 * the value itself for the sites in `valued`, the ones of the open jobs the
 * person whose device asked is assigned to, whatever their role (#447).
 * Nothing else in any answer carries it, and every value handed out is
 * recorded the first time it reaches that device, in `site_access_deliveries`,
 * with the person, the device and when the value was set: what a showing from
 * that device is measured against.
 */
async function withAccessStates(
  tx: TenantTransaction,
  key: SecretKey,
  tenantId: TenantId,
  changes: readonly ChangedRows[],
  valued: ReadonlySet<string> | null,
  recipient: { readonly userId: string; readonly deviceId: string } | null,
): Promise<readonly ChangedRows[]> {
  const rows = changes.find((change) => change.entity === 'site_accesses')?.rows ?? []
  const live = rows.filter((row) => row['deletedAt'] === null)

  if (live.length === 0) {
    return changes
  }

  const values = await readAccessValues(
    tx,
    key,
    tenantId,
    live.map((row) => row['id'] as SiteAccessId),
  )

  const delivered: { readonly siteAccessId: SiteAccessId; readonly valueSetAt: Date }[] = []
  const answered = changes.map((change) =>
    change.entity !== 'site_accesses'
      ? change
      : {
          entity: change.entity,
          rows: change.rows.map((row) => {
            if (row['deletedAt'] !== null) {
              return row
            }

            const stored = values.get(row['id'] as SiteAccessId) ?? { state: 'none' as const }

            if (
              recipient &&
              valued?.has(String(row['siteId'])) &&
              stored.state === 'readable' &&
              row['valueSetAt'] !== null
            ) {
              delivered.push({
                siteAccessId: row['id'] as SiteAccessId,
                valueSetAt: new Date(row['valueSetAt'] as string | Date),
              })

              return { ...row, valueState: stored.state, value: stored.value }
            }

            return { ...row, valueState: stored.state }
          }),
        },
  )

  if (recipient && delivered.length > 0) {
    await tx
      .insert(siteAccessDeliveries)
      .values(
        delivered.map(({ siteAccessId, valueSetAt }) => ({
          tenantId,
          siteAccessId,
          userId: recipient.userId,
          deviceId: recipient.deviceId,
          valueSetAt,
        })),
      )
      .onConflictDoNothing({
        target: [
          siteAccessDeliveries.tenantId,
          siteAccessDeliveries.siteAccessId,
          siteAccessDeliveries.userId,
          siteAccessDeliveries.deviceId,
          siteAccessDeliveries.valueSetAt,
        ],
      })
  }

  return answered
}

/**
 * The routes of the sync of this application, around the key the ways into a
 * site are sealed with (#286). Without one, a row of them goes out without
 * saying whether it has a value.
 */
export function syncRoutes(key: SecretKey | null): SyncRoutes<Identity, Permission> {
  return {
    sync,
    permissionFor,
    answerFor,
    async scope({ tx, identity, query }) {
      // The working time of the others only for whoever may read it (#76), and
      // only their part of the business for whoever may not hold all of it
      // (#140): the jobs they are on, with what hangs on them.
      const ownTimeOnly = !isAllowed(identity, 'time.read')
      const wholeBusiness = isAllowed(identity, 'job.read.all')
      // The ways into a site (#286): all of them for whoever keeps them, the
      // ones of the sites of their open jobs for a technician. A value comes
      // with a row only when the device asks for it, which the site does and
      // the office does not, so that it opens the door in a cellar without a
      // network, and only for a site of an open job the person is assigned to,
      // whatever their role (#447): the owner who drives out holds the code of
      // their own job, and nobody holds one more than a technician on that job
      // would. Any other value the owner and the office ask the route for, which
      // leaves a trace there. The parameter is the client's to choose, the
      // assignment is not (Greptile on #445).
      // A value goes only to a device the session names, since what it was
      // handed is recorded for that device and a showing is taken only from it.
      const keepsAccess = isAllowed(identity, 'site.access')
      const withValues = query['access'] === 'values' && identity.deviceId !== undefined
      const scope = wholeBusiness ? null : await deviceScope(tx, identity.userId)
      const held = await articlesOnDevices(tx)
      // The jobs of the person are asked for this alone where they hold the
      // whole business, and only when the device wants values.
      const own = scope ?? (withValues ? await deviceScope(tx, identity.userId) : null)
      const sites =
        own !== null && (withValues || !keepsAccess) ? await sitesWithOpenJobs(tx, own) : null

      return {
        narrow(entity) {
          if (entity === 'time_entries' && ownTimeOnly) {
            return eq(timeEntries.userId, identity.userId)
          }

          // Who saw which value is for the audit log; a device gets its own.
          if (entity === 'site_access_reveals') {
            return eq(siteAccessReveals.userId, identity.userId)
          }

          // The catalogue does not fit on a device (#296): every device, the
          // office's too, holds the frequent articles and their prices.
          if (entity === 'articles' || entity === 'article_prices') {
            return articlesNarrowedTo(held, entity)
          }

          if (entity === 'site_accesses') {
            return keepsAccess ? undefined : scope ? accessesOfOpenJobs(scope) : sql`false`
          }

          return scope ? narrowedTo(scope, entity) : undefined
        },
        // What the answer was narrowed to, per entity whose rows depend on who
        // asks. The store on a device belongs to the business, not to a person,
        // and a device handed from the office to a technician would otherwise go
        // on holding everybody's time, or one handed the other way would miss
        // what lies behind its cursor. A device that finds a different value than
        // last time drops what it holds of that entity and asks from the start;
        // for the part of the business that is every change of the jobs in it.
        narrowed: {
          time_entries: ownTimeOnly ? `user:${identity.userId}` : 'all',
          ...Object.fromEntries(
            scopedEntities.map((entity) => [entity, scope ? scope.value : 'all']),
          ),
          // Changes with the sites of the open jobs, so that a closed job takes
          // the ways into its site off the device, and with whether values were
          // asked for. For whoever keeps them all, only while some carry a value
          // (#447): a device that holds none has nothing to let go of.
          site_accesses: keepsAccess
            ? withValues && sites && sites.siteIds.size > 0
              ? `all:${sites.value}:values`
              : 'all'
            : scope && sites
              ? `${sites.value}:${withValues ? 'values' : 'bare'}`
              : 'none',
          site_access_reveals: `user:${identity.userId}`,
          // The articles every device holds, which change with the articles and
          // not with who asks (#296).
          articles: held.value,
          article_prices: held.value,
        },
        answer: (changes) =>
          key
            ? withAccessStates(
                tx,
                key,
                identity.tenantId,
                changes,
                withValues ? (sites?.siteIds ?? null) : null,
                identity.deviceId === undefined
                  ? null
                  : { userId: identity.userId, deviceId: identity.deviceId },
              )
            : changes,
      }
    },
  }
}
