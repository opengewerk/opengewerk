import {
  contractStanding,
  type ContractTerms,
  type IsoDate,
  shippedRules,
  type SiteErasureAnchor,
  siteErasureAnchor,
  siteErasureDueOn,
  siteErasureLabel,
  type SiteHold,
} from '@opengewerk/domain'
import { idArray, type TenantTransaction } from '@opengewerk/platform-server'
import { inArray, or, sql } from 'drizzle-orm'

import { maintenanceContracts } from '../database/schema/index.js'

/** What decides whether and when the site of a deleted customer may go (#848). */
export interface SiteStanding {
  readonly siteId: string
  /** What the site is called, with its address, for the list before confirming. */
  readonly name: string
  readonly address: string
  readonly customerErasedOn: IsoDate
  readonly anchor: SiteErasureAnchor | null
  readonly dueOn: IsoDate
  /** What it is without its address, for the deadline and the protocol. */
  readonly label: string
  readonly holds: readonly SiteHold[]
}

interface StandingRow extends Record<string, unknown> {
  readonly id: string
  readonly designation: string
  readonly street: string | null
  readonly house_number: string | null
  readonly postal_code: string | null
  readonly city: string | null
  readonly customer_erased_on: string
  readonly last_protocol_on: string | null
  readonly last_job_closed_on: string | null
}

function addressOf(row: StandingRow): string {
  const street = [row.street, row.house_number].filter((part) => part !== null).join(' ')
  const place = [row.postal_code, row.city].filter((part) => part !== null).join(' ')

  return [street, place].filter((part) => part.trim() !== '').join(', ')
}

/**
 * The sites whose customer the deletion concept deleted (#845) and that are
 * not deleted themselves, or the ones named, with what decides when they go:
 * the youngest signed protocol at them, of an installation, an appliance of
 * the register or the acceptance of a job there, else the last job closed
 * there, and what holds them today. Only the ones due today, unless `all`.
 */
export async function siteStandings(
  tx: TenantTransaction,
  today: IsoDate,
  only?: readonly string[],
): Promise<SiteStanding[]> {
  if (only !== undefined && only.length === 0) {
    return []
  }

  const ofThese = only === undefined ? sql`` : sql`and s.id = any(${idArray(only)})`
  const { rows } = await tx.execute<StandingRow>(sql`
    select s.id, s.designation, s.street, s.house_number, s.postal_code, s.city,
      (select (min(e.created_at) at time zone 'Europe/Berlin')::date from erasures e
        where e.kind::text = 'customer' and e.record_id = s.customer_id)::text as customer_erased_on,
      (select max(f.performed_on) from form_records f
        where f.status = 'signed' and f.deleted_at is null
          and (f.installation_id in (select i.id from installations i where i.site_id = s.id)
            or f.appliance_id in (select a.id from appliances a where a.site_id = s.id)
            or f.job_id in (select j.id from jobs j where j.site_id = s.id)))::text as last_protocol_on,
      (select max((j.closed_at at time zone 'Europe/Berlin')::date) from jobs j
        where j.site_id = s.id and j.closed_at is not null)::text as last_job_closed_on
      from sites s
     where s.deleted_at is null
       and exists (select 1 from erasures e where e.kind::text = 'customer' and e.record_id = s.customer_id)
       ${ofThese}
     order by s.id`)

  if (rows.length === 0) {
    return []
  }

  const siteIds = rows.map((row) => row.id)
  const { rows: installed } = await tx.execute<{ id: string; site_id: string }>(sql`
    select id, site_id from installations where site_id = any(${idArray(siteIds)})`)
  const siteOfInstallation = new Map(installed.map((row) => [row.id, row.site_id]))
  const contracts = await tx
    .select()
    .from(maintenanceContracts)
    .where(
      or(
        inArray(maintenanceContracts.siteId, siteIds as never[]),
        installed.length === 0
          ? undefined
          : sql`${maintenanceContracts.installationIds} && ${idArray(installed.map((row) => row.id))}`,
      ),
    )
  const running = new Set<string>()

  for (const contract of contracts) {
    const standing = contractStanding(
      {
        startsOn: contract.startsOn as IsoDate,
        termMonths: contract.termMonths,
        renewal: contract.renewal as ContractTerms['renewal'],
        renewalMonths: contract.renewalMonths,
        noticeMonths: contract.noticeMonths,
        endsOn: contract.endsOn as IsoDate | null,
      },
      today,
    )

    if (standing.tone !== 'over') {
      for (const siteId of [
        contract.siteId,
        ...contract.installationIds.map((id) => siteOfInstallation.get(id)),
      ]) {
        if (siteId !== null && siteId !== undefined) {
          running.add(siteId)
        }
      }
    }
  }

  return rows.map((row) => {
    const anchor = siteErasureAnchor({
      lastProtocolOn: row.last_protocol_on as IsoDate | null,
      lastJobClosedOn: row.last_job_closed_on as IsoDate | null,
    })
    const customerErasedOn = row.customer_erased_on as IsoDate

    return {
      siteId: row.id,
      name: row.designation,
      address: addressOf(row),
      customerErasedOn,
      anchor,
      dueOn: siteErasureDueOn(anchor, customerErasedOn, today, shippedRules),
      label: siteErasureLabel(anchor),
      holds: running.has(row.id) ? ['running_contract'] : [],
    }
  })
}

/** The sites of deleted customers due today, held or not, or of those named. */
export async function dueSites(
  tx: TenantTransaction,
  today: IsoDate,
  only?: readonly string[],
): Promise<SiteStanding[]> {
  return (await siteStandings(tx, today, only)).filter((standing) => standing.dueOn <= today)
}

/** The keys of a table a deletion touched, for the change log to black out. */
export interface SiteTouched {
  readonly table: string
  readonly ids: readonly string[]
}

async function ids(tx: TenantTransaction, query: ReturnType<typeof sql>): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(query)

  return rows.map((row) => row.id)
}

/**
 * Empties a site of a deleted customer and everything that hangs on it (#848),
 * in the transaction that wrote its line of the protocol, which is what opens
 * the locks (`site_erasing`, migration 0132). What travels to the devices is
 * emptied and marked as deleted, never removed, so that every device learns of
 * it (ADR 0005); what stays on the server goes. Emptied means all of it, the
 * values of the trade as well (decided on 04.11.2026): a row keeps its key,
 * what it hangs on and the mark. The jobs, documents and contracts there stay
 * as the deletion of the customer left them, since the times of the staff and
 * the books still point at them.
 *
 * Returns the keys of every row it touched, by table.
 */
export async function emptySite(tx: TenantTransaction, siteId: string): Promise<SiteTouched[]> {
  const k = sql`${siteId}::uuid`
  const installationsOf = sql`(select id from installations where site_id = ${k})`
  const appliancesOf = sql`(select id from appliances where site_id = ${k})`
  const jobsOf = sql`(select id from jobs where site_id = ${k})`
  const defectsOf = sql`(select id from defects
    where installation_id in ${installationsOf} or job_id in ${jobsOf})`
  const boardsOf = sql`(select id from distribution_boards where installation_id in ${installationsOf})`
  const circuitsOf = sql`(select id from circuits where distribution_board_id in ${boardsOf})`
  const invertersOf = sql`(select id from inverters where installation_id in ${installationsOf})`
  const stringsOf = sql`(select id from pv_strings where inverter_id in ${invertersOf})`
  const accessesOf = sql`(select id from site_accesses where site_id = ${k})`
  const contractsOf = sql`(select id from maintenance_contracts
    where site_id = ${k} or installation_ids && coalesce((select array_agg(id) from installations
      where site_id = ${k}), '{}'::uuid[]))`
  const touched: SiteTouched[] = []
  const take = async (table: string, query: ReturnType<typeof sql>) => {
    touched.push({ table, ids: await ids(tx, query) })
  }

  // What stays on the server goes: who saw an access, to which device it went,
  // the handovers of a PV documentation, and the sealed values.
  await take(
    'site_access_reveals',
    sql`delete from site_access_reveals where site_access_id in ${accessesOf} returning id`,
  )
  await take(
    'site_access_deliveries',
    sql`delete from site_access_deliveries where site_access_id in ${accessesOf} returning id`,
  )
  await take(
    'pv_handovers',
    sql`delete from pv_handovers where installation_id in ${installationsOf} returning id`,
  )
  await tx.execute(sql`delete from secrets where record_id in ${accessesOf}`)

  // The files at the site, its installations and their defects go for good.
  const fileIds = await ids(
    tx,
    sql`select id from attachments
     where site_id = ${k} or installation_id in ${installationsOf} or defect_id in ${defectsOf}`,
  )

  if (fileIds.length > 0) {
    await take(
      'attachment_versions',
      sql`select id from attachment_versions where attachment_id = any(${idArray(fileIds)})`,
    )

    for (const id of fileIds) {
      await tx.execute(sql`select purge_attachment(${id}::uuid, 'Gelöscht')`)
    }

    touched.push({ table: 'attachments', ids: fileIds })
  }

  // What travels is emptied and marked, from the leaves up. An acceptance
  // keeps a signer and a path (`defect_steps_signed_acceptance`); a single
  // point draws nothing, as for a signature of a customer (#845).
  await take(
    'defect_steps',
    sql`update defect_steps
       set signer_name = case when step = 'accepted' then 'Gelöscht' end,
           signature_path = case when step = 'accepted' then 'M0,0' end,
           deleted_at = coalesce(deleted_at, now())
     where defect_id in ${defectsOf} returning id`,
  )
  await take(
    'defects',
    sql`update defects set description = 'Gelöscht', remedy_due_on = null,
           deleted_at = coalesce(deleted_at, now())
     where id in ${defectsOf} returning id`,
  )
  await take(
    'form_records',
    sql`update form_records set "values" = '{}', deleted_at = coalesce(deleted_at, now())
     where installation_id in ${installationsOf} or appliance_id in ${appliancesOf}
        or job_id in ${jobsOf} returning id`,
  )
  await take(
    'equipment',
    sql`update equipment set designation = 'Gelöscht', kind = null, manufacturer = null, model = null,
           serial_number = null, deleted_at = coalesce(deleted_at, now())
     where circuit_id in ${circuitsOf} returning id`,
  )
  await take(
    'circuits',
    sql`update circuits set designation = 'Gelöscht', consumer = null, overcurrent_device = null,
           trip_characteristic = null, rated_current_milli = null, rcd_type = null,
           rated_residual_current_milli = null, cable_type = null, cable_cores = null,
           cable_cross_section_milli = null, cable_length_milli = null, cable_installation_method = null,
           deleted_at = coalesce(deleted_at, now())
     where id in ${circuitsOf} returning id`,
  )
  await take(
    'board_sections',
    sql`update board_sections set designation = 'Gelöscht', deleted_at = coalesce(deleted_at, now())
     where distribution_board_id in ${boardsOf} returning id`,
  )
  await take(
    'distribution_boards',
    sql`update distribution_boards set designation = 'Gelöscht', location = null,
           deleted_at = coalesce(deleted_at, now())
     where id in ${boardsOf} returning id`,
  )
  await take(
    'pv_modules',
    sql`update pv_modules set manufacturer = null, model = null, serial_number = null, rated_power_w = null,
           deleted_at = coalesce(deleted_at, now())
     where pv_string_id in ${stringsOf} returning id`,
  )
  await take(
    'pv_strings',
    sql`update pv_strings set designation = 'Gelöscht', mpp_input = null, azimuth_deg = null, tilt_deg = null,
           deleted_at = coalesce(deleted_at, now())
     where id in ${stringsOf} returning id`,
  )
  await take(
    'inverters',
    sql`update inverters set designation = 'Gelöscht', manufacturer = null, model = null, serial_number = null,
           rated_power_w = null, mpp_inputs = null, deleted_at = coalesce(deleted_at, now())
     where id in ${invertersOf} returning id`,
  )
  await take(
    'installation_labels',
    sql`update installation_labels set deleted_at = coalesce(deleted_at, now())
     where installation_id in ${installationsOf} returning id`,
  )
  await take(
    'installations',
    sql`update installations set designation = 'Gelöscht', manufacturer = null, model = null,
           serial_number = null, commissioned_on = null, warranty_ends_on = null, notes = null,
           pv_system_id = null, inverter_id = null, yield_forecast_kwh = null, yield_forecast_source = null,
           grid_operator_id = null, grid_operator_reference = null, usable_capacity_wh = null,
           rated_power_w = null, manufacturer_warranty_ends_on = null,
           deleted_at = coalesce(deleted_at, now())
     where site_id = ${k} returning id`,
  )
  await take(
    'appliances',
    sql`update appliances set designation = 'Gelöscht', inventory_number = null, manufacturer = null,
           model = null, serial_number = null, location = null, cord_length_milli = null, notes = null,
           deleted_at = coalesce(deleted_at, now())
     where site_id = ${k} returning id`,
  )
  await take(
    'tasks',
    sql`update tasks set title = 'Gelöscht', notes = null, deleted_at = coalesce(deleted_at, now())
     where site_id = ${k} or job_id in ${jobsOf} returning id`,
  )
  await take(
    'deadlines',
    sql`update deadlines set source_label = 'Gelöscht'
     where site_id = ${k} or installation_id in ${installationsOf} or job_id in ${jobsOf}
        or source_id in ${appliancesOf} or source_id in ${defectsOf} or source_id in ${contractsOf}
    returning id`,
  )
  await take(
    'site_tags',
    sql`update site_tags set deleted_at = coalesce(deleted_at, now()) where site_id = ${k} returning id`,
  )
  await take(
    'site_accesses',
    sql`update site_accesses set designation = 'Gelöscht', hint = null, deleted_at = coalesce(deleted_at, now())
     where site_id = ${k} returning id`,
  )
  await take(
    'contacts',
    sql`update contacts set given_name = null, family_name = 'Gelöscht', role = null, email = null,
           phone = null, mobile = null, deleted_at = coalesce(deleted_at, now())
     where site_id = ${k} returning id`,
  )
  await take(
    'sites',
    sql`update sites set designation = 'Gelöschtes Objekt', street = null, house_number = null,
           postal_code = null, city = null, notes = null, deleted_at = coalesce(deleted_at, now())
     where id = ${k} returning id`,
  )

  return touched.filter((entry) => entry.ids.length > 0)
}
