/**
 * Whose personal data a table of this application holds, and in which
 * columns (#317, section 2): one place for the deletion concept, for the
 * deletion of a customer and of the staff (#845, #846) and for the answer to
 * a request for access (#318). A test holds it against the database: a table
 * missing here, or a column whose name says it may name somebody and that is
 * not placed here, turns it red.
 *
 * - `customer`: a customer and what belongs to it, its sites, installations,
 *   jobs, documents, files and history.
 * - `contact`: a person at a customer, a site, a supplier or a grid operator.
 * - `prospect`: a lead.
 * - `person`: somebody who works in the business or uses the instance: the
 *   file of a person, an account, a membership, who did what.
 *
 * `columns` are the columns that hold the data or tie a row to its subject;
 * the columns every synchronised table carries, `updated_by` and `device_id`
 * among them, name the person who last changed a row everywhere and are not
 * repeated. `notPersonal` are columns whose name sounds personal but that
 * hold what belongs to the business itself, its name and its address, or to
 * a supplier as a business.
 */
export const personalSubjects = ['customer', 'contact', 'prospect', 'person'] as const

export type PersonalSubject = (typeof personalSubjects)[number]

export interface PersonalData {
  readonly about: readonly PersonalSubject[]
  readonly columns: readonly string[]
  readonly notPersonal?: readonly string[]
}

const none: PersonalData = { about: [], columns: [] }

const business = (...notPersonal: string[]): PersonalData => ({
  about: [],
  columns: [],
  notPersonal,
})

const ofPerson = (...columns: string[]): PersonalData => ({ about: ['person'], columns })

export const personalDataCatalogue: Readonly<Record<string, PersonalData>> = {
  // Whom a request for access is about, and who recorded and drew it (#318).
  access_requests: {
    about: ['customer', 'contact', 'prospect', 'person'],
    columns: ['customer_id', 'contact_id', 'prospect_id', 'person_id', 'created_by', 'produced_by'],
  },
  absences: ofPerson('person_id', 'kind', 'first_day', 'last_day', 'note', 'answer', 'decided_by'),
  account_corrections: ofPerson(
    'user_id',
    'name_before',
    'name_after',
    'email_before',
    'email_after',
  ),
  account_mail_server_changes: none,
  appliances: { about: ['customer'], columns: ['site_id', 'location', 'notes'] },
  appointment_people: ofPerson('appointment_id', 'user_id'),
  appointments: { about: ['customer'], columns: ['job_id', 'note'] },
  article_imports: ofPerson('created_by', 'applied_by'),
  article_markups: none,
  article_price_origins: none,
  article_prices: none,
  article_search: none,
  articles: none,
  attachment_versions: {
    about: ['customer', 'person'],
    columns: ['attachment_id', 'file_name', 'created_by'],
  },
  attachments: {
    about: ['customer'],
    columns: ['customer_id', 'site_id', 'installation_id', 'job_id', 'defect_id', 'title'],
  },
  audit_chains: none,
  audit_entries: {
    about: ['customer', 'contact', 'prospect', 'person'],
    columns: ['record_id', 'old_value', 'new_value', 'user_id'],
    notPersonal: ['table_name'],
  },
  audit_redactions: ofPerson('redacted_by'),
  audit_value_nonces: none,
  auth_accounts: ofPerson(
    'user_id',
    'account_id',
    'access_token',
    'refresh_token',
    'id_token',
    'password',
  ),
  auth_address_confirmations: ofPerson('user_id', 'email', 'requested_by'),
  auth_passkeys: ofPerson('user_id', 'name', 'credential_id', 'public_key', 'last_used_at'),
  auth_rate_limits: ofPerson('key'),
  auth_sessions: ofPerson('user_id', 'token', 'ip_address', 'user_agent'),
  auth_two_factors: ofPerson('user_id', 'secret', 'backup_codes'),
  auth_users: ofPerson('name', 'email', 'email_verified', 'image'),
  auth_verifications: ofPerson('identifier', 'value'),
  board_sections: none,
  calendar_feeds: ofPerson('user_id', 'token_hash'),
  circuits: none,
  communications: {
    about: ['customer', 'contact', 'person'],
    columns: ['customer_id', 'site_id', 'counterpart', 'text', 'created_by'],
  },
  contacts: {
    about: ['contact'],
    columns: [
      'customer_id',
      'site_id',
      'supplier_id',
      'given_name',
      'family_name',
      'role',
      'email',
      'phone',
      'mobile',
    ],
  },
  customer_tags: { about: ['customer'], columns: ['customer_id'] },
  customers: {
    about: ['customer'],
    columns: [
      'name',
      'email',
      'phone',
      'street',
      'house_number',
      'postal_code',
      'city',
      'vat_id',
      'tax_exemption_certificate_number',
      'buyer_reference',
      'notes',
    ],
  },
  deadline_runs: none,
  deadline_settings: ofPerson('responsible_user_id'),
  deadlines: {
    about: ['customer', 'person'],
    columns: [
      'source_label',
      'customer_id',
      'site_id',
      'job_id',
      'document_id',
      'installation_id',
      'responsible_user_id',
      'natural_user_id',
      'closed_by',
    ],
  },
  defect_steps: {
    about: ['customer', 'person'],
    columns: ['signer_name', 'signature_path', 'created_by'],
  },
  defects: {
    about: ['customer', 'person'],
    columns: ['job_id', 'installation_id', 'description', 'created_by'],
  },
  distribution_boards: none,
  document_files: { about: ['customer'], columns: ['document_id', 'file_id'] },
  document_instruction_choices: none,
  document_lines: { about: ['customer'], columns: ['document_id', 'description'] },
  document_signatures: {
    about: ['customer'],
    columns: ['document_id', 'signer_name', 'path', 'device_info'],
  },
  document_snapshots: { about: ['customer'], columns: ['document_id', 'content'] },
  document_sources: none,
  documents: {
    about: ['customer', 'person'],
    columns: [
      'customer_id',
      'site_id',
      'job_id',
      'installation_id',
      'subject',
      'intro_text',
      'closing_text',
      'field_values',
      'issued_by',
      'created_by',
    ],
  },
  early_start_requests: {
    about: ['customer', 'person'],
    columns: ['job_id', 'signer_name', 'path', 'device_info', 'created_by'],
  },
  equipment: none,
  // Who switched a kind on, and who deleted: the protocol names nobody else (#317).
  erasure_automations: ofPerson('created_by'),
  erasure_requests: { about: ['customer', 'person'], columns: ['customer_id', 'created_by'] },
  erasures: ofPerson('created_by'),
  file_uploads: ofPerson('user_id'),
  files: none,
  form_definitions: none,
  form_records: {
    about: ['customer'],
    columns: ['installation_id', 'job_id', 'appliance_id', 'values'],
  },
  funding_programs: business('name'),
  grid_operators: {
    about: ['contact', 'person'],
    columns: ['contact_name', 'contact_email', 'contact_phone', 'responsible_electrician'],
    notPersonal: ['name'],
  },
  holiday_settings: none,
  installation_labels: none,
  installations: { about: ['customer'], columns: ['site_id', 'notes', 'grid_operator_reference'] },
  instance_changes: {
    about: ['person'],
    columns: ['record_id', 'old_value', 'new_value', 'user_id'],
    notPersonal: ['table_name'],
  },
  instance_operators: ofPerson('user_id'),
  instance_settings: none,
  instructions: none,
  inverters: none,
  invitations: ofPerson('email', 'name', 'invited_by', 'token_hash'),
  job_assignments: ofPerson('job_id', 'user_id'),
  job_notes: { about: ['customer', 'person'], columns: ['job_id', 'text', 'created_by'] },
  jobs: {
    about: ['customer'],
    columns: ['customer_id', 'site_id', 'installation_id', 'designation', 'description'],
  },
  leave_entitlements: ofPerson('person_id', 'entitled_half_days', 'carried_half_days'),
  letterheads: business(
    'company_name',
    'street',
    'house_number',
    'postal_code',
    'city',
    'phone',
    'email',
    'iban',
    'bank_name',
  ),
  list_prices: none,
  location_consents: ofPerson('user_id', 'given'),
  mail_outbox: {
    about: ['customer', 'contact', 'person'],
    columns: [
      'sender_name',
      'reply_to',
      'recipient_address',
      'recipient_name',
      'subject',
      'body',
      'attachment',
      'requested_by',
      'document_id',
      'job_id',
      'appointment_id',
      'early_start_request_id',
      'invitation_id',
      'deadline_id',
      'task_id',
    ],
  },
  // The signature under the mails of the business.
  mail_settings: business('signature'),
  maintenance_contracts: {
    about: ['customer'],
    columns: ['customer_id', 'site_id', 'quote_id', 'installation_ids', 'designation'],
  },
  member_passkeys: ofPerson('user_id', 'name'),
  memberships: ofPerson('user_id', 'roles', 'blocked_at', 'last_day'),
  number_ranges: none,
  offer_declines: { about: ['customer'], columns: ['document_id', 'reason'] },
  on_call_shifts: ofPerson('user_id', 'starts_at', 'ends_at', 'note'),
  password_resets: ofPerson('user_id'),
  payments: { about: ['customer'], columns: ['document_id', 'amount_cents', 'received_on'] },
  people: ofPerson('name', 'user_id', 'joined_on', 'left_on'),
  // What the record of the processing says (#319): the business, its data
  // protection officer and its own words on the activities, no subject.
  processing_record_activities: none,
  processing_record_settings: none,
  prospects: {
    about: ['prospect'],
    columns: [
      'name',
      'concern',
      'email',
      'phone',
      'street',
      'house_number',
      'postal_code',
      'city',
      'customer_id',
      'site_id',
    ],
  },
  purchase_prices: none,
  push_opt_outs: ofPerson('user_id'),
  push_outbox: ofPerson('subscription_id', 'title', 'body'),
  push_subscriptions: ofPerson('user_id', 'session_id', 'label', 'endpoint', 'p256dh', 'auth'),
  pv_handovers: {
    about: ['customer', 'person'],
    columns: ['installation_id', 'content', 'created_by'],
  },
  pv_modules: none,
  pv_strings: none,
  qualification_kinds: none,
  qualifications: ofPerson(
    'person_id',
    'kind_key',
    'own_kind_id',
    'valid_until',
    'note',
    'certificate_sha256',
  ),
  second_factor_changes: ofPerson('user_id'),
  secrets: { about: ['customer'], columns: ['record_id', 'sealed'] },
  selling_price_runs: ofPerson('requested_by'),
  site_access_deliveries: ofPerson('site_access_id', 'user_id'),
  site_access_reveals: ofPerson('site_access_id', 'user_id'),
  site_accesses: { about: ['customer'], columns: ['site_id', 'designation', 'hint'] },
  site_tags: { about: ['customer'], columns: ['site_id'] },
  sites: {
    about: ['customer'],
    columns: [
      'customer_id',
      'designation',
      'street',
      'house_number',
      'postal_code',
      'city',
      'notes',
    ],
  },
  stock_movements: {
    about: ['customer', 'person'],
    columns: ['job_id', 'reason', 'booked_by'],
    notPersonal: ['counterpart_store_id'],
  },
  store_articles: none,
  stores: business('name'),
  supplier_article_metals: none,
  supplier_articles: none,
  supplier_markups: none,
  supplier_metal_prices: none,
  suppliers: business('name', 'email', 'phone', 'street', 'house_number', 'postal_code', 'city'),
  sync_conflicts: {
    about: ['customer', 'person'],
    columns: ['user_id', 'wanted', 'seen', 'found'],
  },
  sync_operations: none,
  sync_sequences: none,
  tags: business('name'),
  tasks: {
    about: ['customer', 'person'],
    columns: [
      'title',
      'notes',
      'assignee_user_id',
      'customer_id',
      'site_id',
      'job_id',
      'created_by',
    ],
  },
  tenant_parameters: none,
  tenant_roles: none,
  tenant_sessions: ofPerson('user_id', 'session_id', 'started_at', 'ended_at', 'sign_in_method'),
  tenants: business('name'),
  text_snippets: none,
  time_entries: ofPerson(
    'user_id',
    'job_id',
    'started_at',
    'ended_at',
    'note',
    'start_latitude_micro',
    'start_longitude_micro',
    'end_latitude_micro',
    'end_longitude_micro',
  ),
  working_times: ofPerson('person_id'),
}

/**
 * Whether the name of a column says it may name somebody: a name, a way to
 * reach somebody, an address, a signature, where somebody was, or a person
 * who did something. Such a column is either in `columns` or in `notPersonal`
 * of its table, which is the question the test asks of every column.
 */
export function soundsPersonal(column: string): boolean {
  return (
    /(^|_)(name|email|phone|mobile|street|house_number|postal_code|city|signer_name|signature|counterpart|ip_address|user_agent|latitude|longitude|iban)(_|$)/.test(
      column,
    ) ||
    /_by$/.test(column) ||
    /(^|_)user_id$/.test(column)
  )
}
