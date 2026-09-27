/**
 * What the change log calls a table and a field, in the words of the office
 * (#285): "Kunde, Straße" and not `customers.street`.
 *
 * Every table the audit trigger watches has a name here, and every one of its
 * columns has one, either its own or a common one; a test in the server holds
 * the list against the database, so a new column without a name fails there
 * rather than showing up as a column name in front of the owner.
 */

/** The fields many tables share, named once. */
const commonFields: Readonly<Record<string, string>> = {
  id: 'Kennung',
  tenant_id: 'Betrieb',
  created_at: 'Angelegt am',
  updated_at: 'Geändert am',
  version: 'Fassung',
  updated_by: 'Geändert von',
  device_id: 'Gerät',
  deleted_at: 'Gelöscht am',
  change_sequence: 'Abgleichsnummer',
  position: 'Reihenfolge',
  designation: 'Bezeichnung',
  manufacturer: 'Hersteller',
  model: 'Modell',
  serial_number: 'Seriennummer',
  notes: 'Notizen',
  street: 'Straße',
  house_number: 'Hausnummer',
  postal_code: 'Postleitzahl',
  city: 'Ort',
  country: 'Land',
  email: 'E-Mail',
  phone: 'Telefon',
  name: 'Name',
  kind: 'Art',
  status: 'Status',
  customer_id: 'Kunde',
  site_id: 'Objekt',
  installation_id: 'Anlage',
  job_id: 'Auftrag',
  document_id: 'Beleg',
  user_id: 'Person',
  title: 'Titel',
  text: 'Text',
  body: 'Text',
  created_by: 'Angelegt von',
}

/** A table: what one of its rows is called, and the fields it names its own way. */
interface TableWords {
  readonly label: string
  readonly fields?: Readonly<Record<string, string>>
}

export const auditTables: Readonly<Record<string, TableWords>> = {
  attachment_versions: {
    label: 'Fassung einer Datei',
    fields: {
      attachment_id: 'Datei',
      sha256: 'Prüfsumme',
      file_name: 'Dateiname',
      media_type: 'Dateityp',
      size_bytes: 'Größe',
      preview_sha256: 'Vorschau',
    },
  },
  attachments: { label: 'Datei' },
  board_sections: {
    label: 'Feld eines Verteilers',
    fields: { distribution_board_id: 'Verteiler' },
  },
  circuits: {
    label: 'Stromkreis',
    fields: {
      distribution_board_id: 'Verteiler',
      board_section_id: 'Feld',
      consumer: 'Verbraucher',
      overcurrent_device: 'Schutzeinrichtung',
      trip_characteristic: 'Charakteristik',
      rated_current_milli: 'Nennstrom',
      rcd_type: 'RCD-Typ',
      rated_residual_current_milli: 'Bemessungsdifferenzstrom',
      cable_type: 'Leitungstyp',
      cable_cores: 'Aderzahl',
      cable_cross_section_milli: 'Querschnitt',
      cable_length_milli: 'Leitungslänge',
      cable_installation_method: 'Verlegeart',
    },
  },
  contacts: {
    label: 'Ansprechpartner',
    fields: { given_name: 'Vorname', family_name: 'Nachname', role: 'Funktion' },
  },
  customers: {
    label: 'Kunde',
    fields: {
      vat_id: 'USt-IdNr.',
      is_business: 'Unternehmen',
      is_construction_service_recipient: 'Empfänger von Bauleistungen',
      tax_exemption_certificate_number: 'Freistellungsbescheinigung',
      tax_exemption_valid_until: 'Freistellung gültig bis',
      buyer_reference: 'Käuferreferenz',
    },
  },
  deadline_settings: {
    label: 'Einstellung einer Fristart',
    fields: {
      lead_days: 'Vorlauf',
      interval_days: 'Intervall',
      responsible_user_id: 'Verantwortlich',
    },
  },
  deadlines: {
    label: 'Frist',
    fields: {
      source_id: 'Quelle',
      source_label: 'Name der Quelle',
      anchor_on: 'Anker',
      due_on: 'Fällig am',
      lead_days: 'Vorlauf',
      responsible_user_id: 'Verantwortlich',
      natural_user_id: 'Vorgabe der Art',
      closed_at: 'Geschlossen am',
      closed_by: 'Geschlossen von',
      reminded_for: 'Erinnert für',
      reminded_at: 'Erinnert am',
      task_id: 'Aufgabe',
    },
  },
  distribution_boards: { label: 'Verteiler', fields: { location: 'Standort' } },
  document_files: {
    label: 'Datei eines Belegs',
    fields: { purpose: 'Zweck', file_id: 'Datei' },
  },
  document_instruction_choices: {
    label: 'Belehrungen am Beleg',
    fields: {
      variant: 'Art des Vertrags',
      switched_on: 'Eingeschaltet',
      switched_off: 'Ausgeschaltet',
    },
  },
  document_lines: {
    label: 'Position',
    fields: {
      description: 'Beschreibung',
      quantity_milli: 'Menge',
      unit: 'Einheit',
      unit_price_cents: 'Einzelpreis',
      vat_rate: 'Steuersatz',
      net_cents: 'Nettobetrag',
    },
  },
  document_signatures: {
    label: 'Unterschrift',
    fields: {
      signer_name: 'Unterschrieben von',
      signed_at: 'Unterschrieben am',
      device_info: 'Gerät beim Unterschreiben',
      path: 'Unterschrift',
      content_fingerprint: 'Fingerabdruck der Seite',
    },
  },
  document_snapshots: { label: 'Festgeschriebener Stand', fields: { content: 'Inhalt' } },
  document_sources: {
    label: 'Quelle eines Belegs',
    fields: { source_document_id: 'Quellbeleg', released_at: 'Freigegeben am' },
  },
  documents: {
    label: 'Beleg',
    fields: {
      predecessor_document_id: 'Vorgänger',
      number: 'Nummer',
      document_date: 'Belegdatum',
      issued_at: 'Festgeschrieben am',
      issued_by: 'Festgeschrieben von',
      subject: 'Betreff',
      tax_treatment: 'Steuerfall',
      service_from: 'Leistung ab',
      service_until: 'Leistung bis',
      intro_text: 'Text über den Positionen',
      closing_text: 'Text unter den Positionen',
      payment_term_days: 'Zahlungsziel',
      fields_version: 'Fassung der Felder',
      field_values: 'Felder',
    },
  },
  equipment: { label: 'Betriebsmittel', fields: { circuit_id: 'Stromkreis' } },
  files: {
    label: 'Gespeicherte Datei',
    fields: { sha256: 'Prüfsumme', size_bytes: 'Größe', media_type: 'Dateityp' },
  },
  form_definitions: {
    label: 'Formular',
    fields: { key: 'Schlüssel', definition_version: 'Fassung', definition: 'Definition' },
  },
  form_records: {
    label: 'Protokoll',
    fields: {
      definition_key: 'Formular',
      definition_version: 'Fassung des Formulars',
      performed_on: 'Geprüft am',
      values: 'Werte',
    },
  },
  installations: {
    label: 'Anlage',
    fields: { commissioned_on: 'In Betrieb seit', warranty_ends_on: 'Gewährleistung bis' },
  },
  instructions: {
    label: 'Belehrung',
    fields: {
      template: 'Vorlage',
      title: 'Überschrift',
      body: 'Wortlaut',
      based_on: 'Fassung des Musters',
      kinds: 'Belege',
      consumers_only: 'Nur an Verbraucher',
      with_document: 'Geht mit dem Beleg hinaus',
    },
  },
  inverters: { label: 'Wechselrichter' },
  invitations: {
    label: 'Einladung',
    fields: {
      roles: 'Rollen',
      token_hash: 'Prüfsumme des Links',
      invited_by: 'Eingeladen von',
      expires_at: 'Gültig bis',
      redeemed_at: 'Eingelöst am',
      revoked_at: 'Zurückgezogen am',
    },
  },
  job_assignments: { label: 'Einteilung auf einen Auftrag' },
  job_notes: {
    label: 'Notiz zu einem Auftrag',
    fields: { written_at: 'Geschrieben am', created_by: 'Geschrieben von' },
  },
  jobs: {
    label: 'Auftrag',
    fields: {
      parent_job_id: 'Übergeordneter Auftrag',
      predecessor_job_id: 'Vorgänger',
      number: 'Nummer',
      description: 'Was zu tun ist',
      closed_at: 'Abgeschlossen am',
    },
  },
  letterheads: {
    label: 'Briefkopf',
    fields: {
      company_name: 'Name auf den Belegen',
      website: 'Website',
      tax_number: 'Steuernummer',
      vat_id: 'USt-IdNr.',
      iban: 'IBAN',
      bic: 'BIC',
      bank_name: 'Bank',
      register_court: 'Registergericht',
      register_number: 'Registernummer',
      managing_directors: 'Vertretung',
      logo_file_id: 'Logo',
    },
  },
  location_consents: { label: 'Einwilligung zum Standort', fields: { given: 'Erteilt' } },
  mail_outbox: {
    label: 'E-Mail',
    fields: {
      kind: 'Anlass',
      cause: 'Ursache',
      task_id: 'Aufgabe',
      sender_name: 'Absender',
      reply_to: 'Antwort an',
      recipient_address: 'Empfänger',
      recipient_name: 'Name des Empfängers',
      subject: 'Betreff',
      attempts: 'Versuche',
      next_attempt_at: 'Nächster Versuch',
      last_error: 'Letzter Fehler',
      sent_at: 'Verschickt am',
      attachment: 'Anhang',
      requested_by: 'Verschickt von',
      invitation_id: 'Einladung',
      deadline_id: 'Frist',
    },
  },
  mail_settings: {
    label: 'E-Mail-Einstellungen',
    fields: {
      host: 'Server',
      port: 'Port',
      security: 'Verschlüsselung',
      username: 'Anmeldung',
      from_address: 'Absenderadresse',
      signature: 'Signatur',
      password_set_at: 'Passwort gesetzt am',
    },
  },
  memberships: { label: 'Zugang', fields: { roles: 'Rollen', blocked_at: 'Gesperrt am' } },
  number_ranges: {
    label: 'Nummernkreis',
    fields: { key: 'Kreis', pattern: 'Muster', next_value: 'Nächste Nummer' },
  },
  payments: {
    label: 'Zahlungseingang',
    fields: { amount_cents: 'Betrag', received_on: 'Eingegangen am' },
  },
  push_opt_outs: { label: 'Abgeschalteter Anlass für Push', fields: { occasion: 'Anlass' } },
  push_outbox: {
    label: 'Push-Nachricht',
    fields: {
      kind: 'Anlass',
      cause: 'Ursache',
      subscription_id: 'Gerät',
      url: 'Ziel',
      attempts: 'Versuche',
      next_attempt_at: 'Nächster Versuch',
      expires_at: 'Gültig bis',
      last_error: 'Letzter Fehler',
      sent_at: 'Verschickt am',
    },
  },
  push_subscriptions: {
    label: 'Gerät mit Push',
    fields: {
      session_id: 'Sitzung',
      entry: 'Einstieg',
      label: 'Gerät',
      endpoint: 'Adresse des Push-Dienstes',
      p256dh: 'Schlüssel des Browsers',
      auth: 'Geheimnis des Browsers',
    },
  },
  pv_modules: { label: 'PV-Modul', fields: { pv_string_id: 'String' } },
  pv_strings: { label: 'String', fields: { inverter_id: 'Wechselrichter' } },
  sites: { label: 'Objekt' },
  tasks: {
    label: 'Aufgabe',
    fields: {
      title: 'Text',
      notes: 'Notiz',
      due_on: 'Fällig am',
      assignee_user_id: 'Verantwortlich',
    },
  },
  tenant_parameters: {
    label: 'Einstellung des Betriebs',
    fields: {
      key: 'Schlüssel',
      valid_from: 'Gültig ab',
      valid_until: 'Gültig bis',
      unit: 'Einheit',
      value: 'Wert',
      note: 'Anmerkung',
    },
  },
  tenant_sessions: {
    label: 'Anmeldung',
    fields: { session_id: 'Sitzung', started_at: 'Begonnen am', ended_at: 'Beendet am' },
  },
  tenants: { label: 'Betrieb' },
  text_snippets: { label: 'Textbaustein', fields: { purpose: 'Zweck' } },
  time_entries: {
    label: 'Arbeitszeit',
    fields: {
      started_at: 'Beginn',
      ended_at: 'Ende',
      note: 'Notiz',
      corrects_entry_id: 'Korrigiert',
      withdrawn: 'Gestrichen',
      start_latitude_micro: 'Standort beim Start, Breite',
      start_longitude_micro: 'Standort beim Start, Länge',
      end_latitude_micro: 'Standort beim Stopp, Breite',
      end_longitude_micro: 'Standort beim Stopp, Länge',
    },
  },
}

/**
 * The tables of the log of the instance (#188), apart from those of a
 * business: they carry the instance's own trigger and not the audit trigger,
 * and the test that holds `auditTables` against the database asks for that one.
 */
export const instanceTables: Readonly<Record<string, TableWords>> = {
  instance_settings: {
    label: 'Einstellungen der Instanz',
    fields: {
      mail_internal_hosts: 'Freigegebene Mailserver',
      backup_time: 'Uhrzeit der Sicherung',
      imported_from_environment_at: 'Übernommen aus der .env am',
    },
  },
  instance_operators: { label: 'Betreiber' },
}

/** What a row of this table is called, "Kunde", or the table's own name where it has none. */
export function auditTableLabel(table: string): string {
  return auditTables[table]?.label ?? instanceTables[table]?.label ?? table
}

/** What a field is called on its own, "Straße", or null where nothing names it. */
export function auditFieldName(table: string, field: string): string | null {
  return (
    auditTables[table]?.fields?.[field] ??
    instanceTables[table]?.fields?.[field] ??
    commonFields[field] ??
    null
  )
}

/** A field with its table, "Kunde, Straße", as the change log shows it. */
export function auditFieldLabel(table: string, field: string): string {
  return `${auditTableLabel(table)}, ${auditFieldName(table, field) ?? field}`
}

/**
 * The fields an entry carries that say nothing about the change: the key of
 * the row, its business and when it was made, all set once when the row is
 * written. The log keeps them, as it keeps everything; the list leaves them
 * out, so that a new customer shows its name and address and not its key.
 */
export const quietAuditFields: ReadonlySet<string> = new Set(['id', 'tenant_id', 'created_at'])
