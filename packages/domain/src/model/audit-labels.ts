import { type AuditTableWords, structureAuditTables } from '@opengewerk/platform-domain'

/**
 * What the change log calls a table and a field, in the words of the office
 * (#285): "Kunde, Straße" and not `customers.street`.
 *
 * Every table of the business the audit trigger watches has a name here, and
 * every one of its columns has one, either its own or a common one. The
 * tables of the foundation, memberships, sign ins, roles and the like, are
 * named there (ADR 0010); a test in the server holds both against the
 * database, so a new column without a name fails there rather than showing up
 * as a column name in front of the owner.
 */

/** The fields many tables share, named once; those of the foundation it names itself. */
export const auditCommonFields: Readonly<Record<string, string>> = {
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
  phone: 'Telefon',
  kind: 'Art',
  status: 'Status',
  customer_id: 'Kunde',
  site_id: 'Objekt',
  installation_id: 'Anlage',
  job_id: 'Auftrag',
  document_id: 'Beleg',
  title: 'Titel',
  text: 'Text',
  body: 'Text',
  created_by: 'Angelegt von',
}

/** The tables of the business, by name. */
export const auditTables: Readonly<Record<string, AuditTableWords>> = {
  // The electrical and the PV structure, in the foundation's words (ADR 0014).
  ...structureAuditTables,
  appointment_people: {
    label: 'Person an einem Termin',
    fields: {
      appointment_id: 'Termin',
      confirmed_revision: 'Bestätigte Fassung',
      confirmed_at: 'Bestätigt am',
    },
  },
  appointments: {
    label: 'Termin',
    fields: {
      starts_at: 'Beginn',
      ends_at: 'Ende',
      note: 'Notiz',
      rrule: 'Wiederholung',
      exdates: 'Ausgenommene Tage',
      revision: 'Fassung',
    },
  },
  article_imports: {
    label: 'Import aus DATANORM',
    fields: {
      supplier_id: 'Lieferant',
      status: 'Stand',
      files: 'Dateien',
      charset: 'Zeichensatz',
      valid_from: 'Preise gültig ab',
      list_as_selling: 'Listenpreis als Verkaufspreis',
      summary: 'Ergebnis',
      problem: 'Problem',
      created_by: 'Eingelesen von',
      applied_by: 'Übernommen von',
      applied_at: 'Übernommen am',
    },
  },
  article_markups: {
    label: 'Preisbildung eines Artikels',
    fields: {
      article_id: 'Artikel',
      fixed: 'Fester Verkaufspreis',
      basis_points: 'Eigener Aufschlag',
      markup_on_metal: 'Aufschlag auf den Metallzuschlag',
    },
  },
  article_price_origins: {
    label: 'Herkunft eines Verkaufspreises',
    fields: {
      article_price_id: 'Verkaufspreis',
      purchase_cents: 'Einkaufspreis',
      basis_points: 'Aufschlag',
    },
  },
  article_prices: {
    label: 'Verkaufspreis',
    fields: {
      article_id: 'Artikel',
      valid_from: 'Gültig ab',
      unit_price_cents: 'Preis',
      price_base: 'Preiseinheit',
      import_id: 'Import',
    },
  },
  articles: {
    label: 'Artikel',
    fields: {
      number: 'Nummer',
      description: 'Beschreibung',
      ean: 'EAN',
      unit: 'Einheit',
      group_of_goods: 'Warengruppe',
      frequent: 'Häufig',
      import_id: 'Import',
      durability_half_years: 'Haltbarkeitsgarantie in halben Jahren',
      durability_producer: 'Hersteller der Haltbarkeitsgarantie',
      durability_model: 'Modell der Haltbarkeitsgarantie',
    },
  },
  calendar_feeds: {
    label: 'Kalender-Abo',
    fields: {
      token_hash: 'Prüfsumme der Adresse',
      ended_at: 'Beendet am',
    },
  },
  customer_tags: { label: 'Tag an einem Kunden', fields: { tag_id: 'Tag' } },
  customers: {
    label: 'Kunde',
    fields: {
      vat_id: 'USt-IdNr.',
      is_business: 'Unternehmen',
      is_construction_service_recipient: 'Empfänger von Bauleistungen',
      tax_exemption_certificate_number: 'Freistellungsbescheinigung',
      tax_exemption_valid_until: 'Freistellung gültig bis',
      buyer_reference: 'Käuferreferenz',
      reminder_ground: 'Grundlage für Erinnerungen',
      reminder_ground_on: 'Grundlage für Erinnerungen seit',
      source: 'Quelle',
    },
  },
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
      price_base: 'Preiseinheit',
      vat_rate: 'Steuersatz',
      net_cents: 'Nettobetrag',
      article_id: 'Artikel',
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
      created_by: 'Angelegt von',
      store_id: 'Material aus',
      subject: 'Betreff',
      tax_treatment: 'Steuerfall',
      service_from: 'Leistung ab',
      service_until: 'Leistung bis',
      maintenance_contract_id: 'Wartungsvertrag',
      intro_text: 'Text über den Positionen',
      closing_text: 'Text unter den Positionen',
      payment_term_days: 'Zahlungsziel',
      fields_version: 'Fassung der Felder',
      field_values: 'Felder',
    },
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
      appliance_id: 'Gerät',
      performed_on: 'Geprüft am',
      values: 'Werte',
    },
  },
  // The register of appliances of a site (#303).
  appliances: {
    label: 'Gerät',
    fields: {
      inventory_number: 'Inventarnummer',
      protection_class: 'Schutzklasse',
      mobility: 'Art',
      location: 'Standort',
      cord_length_milli: 'Länge der Anschlussleitung',
    },
  },
  installations: {
    label: 'Anlage',
    fields: {
      commissioned_on: 'In Betrieb seit',
      warranty_ends_on: 'Gewährleistung bis',
      manufacturer_warranty_ends_on: 'Herstellergarantie bis',
      pv_system_id: 'Gehört zu PV-Anlage',
      inverter_id: 'Am Wechselrichter',
      yield_forecast_kwh: 'Ertragsprognose',
      yield_forecast_source: 'Quelle der Ertragsprognose',
      grid_operator_id: 'Netzbetreiber',
      grid_operator_reference: 'Kennung beim Netzbetreiber',
      usable_capacity_wh: 'Nutzbare Speicherkapazität',
      rated_power_w: 'Bemessungsleistung',
    },
  },
  // The notes and calls at a customer and a site (#313).
  communications: {
    label: 'Eintrag im Verlauf',
    fields: {
      customer_id: 'Kunde',
      site_id: 'Objekt',
      direction: 'Richtung',
      counterpart: 'Gesprächspartner',
      text: 'Inhalt',
      happened_at: 'Wann',
      created_by: 'Geschrieben von',
    },
  },
  // An offer the customer turned down (#841).
  offer_declines: {
    label: 'Ablehnung eines Angebots',
    fields: { document_id: 'Angebot', declined_on: 'Abgelehnt am', reason: 'Grund' },
  },
  // The protocol of the deletion concept (#317).
  erasures: {
    label: 'Löschung nach dem Löschkonzept',
    fields: {
      kind: 'Art',
      record_id: 'Gelöschter Datensatz',
      label: 'Was',
      due_on: 'Fällig seit',
      automatic: 'Von selbst',
      redactions: 'Geschwärzte Werte',
      created_by: 'Gelöscht von',
    },
  },
  // A kind of the deletion concept that goes by itself (#317).
  erasure_automations: {
    label: 'Automatisch löschen',
    fields: { kind: 'Art', created_by: 'Eingeschaltet von' },
  },
  // A request for deletion of a customer, from the request to its end (#845).
  erasure_requests: {
    label: 'Löschanfrage',
    fields: {
      customer_id: 'Kunde',
      received_on: 'Eingegangen am',
      channel: 'Weg',
      status: 'Stand',
      answer_due_on: 'Antwort fällig am',
      restricted_at: 'Gesperrt am',
      erased_at: 'Gelöscht am',
      created_by: 'Erfasst von',
    },
  },
  // A request for access, from the request to its answer (#318).
  access_requests: {
    label: 'Auskunftsanfrage',
    fields: {
      subject: 'Person ist',
      customer_id: 'Kunde',
      contact_id: 'Ansprechpartner',
      prospect_id: 'Lead',
      person_id: 'Mitarbeiter',
      received_on: 'Eingegangen am',
      channel: 'Weg',
      status: 'Stand',
      answer_due_on: 'Antwort fällig am',
      produced_at: 'Auskunft erstellt am',
      produced_by: 'Auskunft erstellt von',
      answered_at: 'Beantwortet am',
      created_by: 'Erfasst von',
    },
  },
  // The leads of the office (#312).
  prospects: {
    label: 'Lead',
    fields: {
      name: 'Name',
      concern: 'Anliegen',
      email: 'E-Mail',
      source: 'Quelle',
      stage: 'Stand',
      last_contact_on: 'Letzter Kontakt',
      customer_id: 'Kunde',
      site_id: 'Objekt',
      converted_at: 'Kunde geworden am',
    },
  },
  // The maintenance contracts of the office (#294).
  maintenance_contracts: {
    label: 'Wartungsvertrag',
    fields: {
      number: 'Nummer',
      designation: 'Bezeichnung',
      customer_id: 'Kunde',
      site_id: 'Objekt',
      quote_id: 'Angebot',
      installation_ids: 'Anlagen',
      services: 'Enthaltene Leistungen',
      starts_on: 'Beginn',
      first_visit_on: 'Erste Wartung',
      interval_months: 'Intervall in Monaten',
      term_months: 'Laufzeit in Monaten',
      renewal: 'Danach',
      renewal_months: 'Verlängert sich um Monate',
      notice_months: 'Kündigungsfrist in Monaten',
      price_kind: 'Preis',
      flat_cents: 'Pauschale',
      payment_rhythm: 'Abrechnung',
      issue_by_itself: 'Rechnungen ohne Zutun',
      cancelled_on: 'Kündigung eingegangen am',
      ends_on: 'Endet am',
    },
  },
  // The funding programmes as templates of the office (#307).
  funding_programs: {
    label: 'Förderprogramm',
    fields: {
      sponsor: 'Fördergeber',
      url: 'Seite im Internet',
      kinds: 'Gilt für',
      evidence: 'Nachweise',
      declaration: 'Text der Fachunternehmererklärung',
    },
  },
  // The grid operators and the entry of the business in their directories (#306).
  grid_operators: {
    label: 'Netzbetreiber',
    fields: {
      portal_url: 'Portal',
      requirements: 'Was er verlangt',
      contact_name: 'Ansprechpartner',
      contact_email: 'E-Mail des Ansprechpartners',
      contact_phone: 'Telefon des Ansprechpartners',
      registration_number: 'Nummer im Installateurverzeichnis',
      registered_until: 'Eingetragen bis',
      responsible_electrician: 'Verantwortliche Elektrofachkraft',
    },
  },
  pv_handovers: {
    label: 'Übergabe der PV-Unterlagen',
    fields: {
      handed_over_on: 'Übergeben am',
      content: 'Inhalt der Mappe',
      created_by: 'Übergeben von',
    },
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
  installation_labels: {
    label: 'QR-Etikett',
    fields: { code: 'Code', blocked_at: 'Gesperrt am' },
  },
  job_assignments: { label: 'Einteilung auf einen Auftrag' },
  defects: {
    label: 'Mangel',
    fields: {
      description: 'Beschreibung',
      reported_at: 'Gemeldet am',
      created_by: 'Gemeldet von',
      remedy_due_on: 'Frist des Kunden zur Beseitigung',
      acceptance_record_id: 'Abnahmeprotokoll',
      acceptance_line: 'Zeile der Vorbehalte',
    },
  },
  defect_steps: {
    label: 'Schritt eines Mangels',
    fields: {
      defect_id: 'Mangel',
      step: 'Schritt',
      taken_at: 'Eingetragen am',
      created_by: 'Eingetragen von',
      signer_name: 'Unterschrieben von',
      signature_path: 'Unterschrift',
    },
  },
  on_call_shifts: {
    label: 'Bereitschaft',
    fields: {
      user_id: 'Person',
      starts_at: 'Beginn',
      ends_at: 'Ende',
      note: 'Notiz',
    },
  },
  early_start_requests: {
    label: 'Verlangen auf vorzeitigen Beginn',
    fields: {
      job_id: 'Auftrag',
      signer_name: 'Unterschrieben von',
      signed_at: 'Unterschrieben am',
      device_info: 'Gerät',
      path: 'Unterschrift',
      content_fingerprint: 'Fingerabdruck der Belehrungen',
      created_by: 'Auf dem Gerät von',
    },
  },
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
      vob_agreed: 'VOB/B vereinbart',
      building_work: 'Bauwerk',
      urgent_repair: 'Dringende Reparatur',
      emergency_at: 'Notdiensteinsatz am',
      maintenance_contract_id: 'Wartungsvertrag',
      maintenance_due_on: 'Wartung fällig am',
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
  list_prices: {
    label: 'Listenpreis',
    fields: {
      supplier_article_id: 'Artikel eines Lieferanten',
      valid_from: 'Gültig ab',
      unit_price_cents: 'Preis',
      price_base: 'Preiseinheit',
      import_id: 'Import',
    },
  },
  location_consents: { label: 'Einwilligung zum Standort', fields: { given: 'Erteilt' } },
  payments: {
    label: 'Zahlungseingang',
    fields: { amount_cents: 'Betrag', received_on: 'Eingegangen am' },
  },
  purchase_prices: {
    label: 'Einkaufspreis',
    fields: {
      supplier_article_id: 'Artikel eines Lieferanten',
      valid_from: 'Gültig ab',
      unit_price_cents: 'Preis',
      price_base: 'Preiseinheit',
      import_id: 'Import',
    },
  },
  site_access_deliveries: {
    label: 'Zugang auf einem Gerät',
    fields: { site_access_id: 'Zugang', value_set_at: 'Wert gesetzt am' },
  },
  site_access_reveals: {
    label: 'Anzeige eines Zugangs',
    fields: {
      site_access_id: 'Zugang',
      revealed_at: 'Angezeigt am',
      value_set_at: 'Wert gesetzt am',
    },
  },
  site_accesses: {
    label: 'Zugang zum Objekt',
    fields: { hint: 'Hinweis', value_set_at: 'Wert gesetzt am' },
  },
  site_tags: { label: 'Tag an einem Objekt', fields: { tag_id: 'Tag' } },
  sites: { label: 'Objekt' },
  supplier_articles: {
    label: 'Artikel eines Lieferanten',
    fields: {
      article_id: 'Artikel',
      supplier_id: 'Lieferant',
      supplier_number: 'Artikelnummer des Lieferanten',
      discount_group: 'Rabattgruppe',
      import_id: 'Import',
      main: 'Hauptlieferant',
    },
  },
  selling_price_runs: {
    label: 'Neuberechnung der Verkaufspreise',
    fields: { supplier_id: 'Lieferant', from_day: 'Ab', requested_by: 'Veranlasst von' },
  },
  supplier_markups: {
    label: 'Aufschlag eines Lieferanten',
    fields: {
      supplier_id: 'Lieferant',
      basis_points: 'Aufschlag',
      markup_on_metal: 'Aufschlag auf den Metallzuschlag',
    },
  },
  supplier_article_metals: {
    label: 'Metall eines Artikels',
    fields: {
      supplier_article_id: 'Artikel eines Lieferanten',
      metal: 'Metall',
      base_euros: 'Metallbasis in Euro je 100 kg',
      grams_per_thousand: 'Metallgewicht in Gramm je 1000 Einheiten',
    },
  },
  people: {
    label: 'Akte',
    fields: {
      name: 'Name',
      user_id: 'Zugang',
      joined_on: 'Eintritt',
      left_on: 'Austritt',
    },
  },
  absences: {
    label: 'Abwesenheit',
    fields: {
      person_id: 'Person',
      kind: 'Art',
      state: 'Stand',
      first_day: 'Erster Tag',
      last_day: 'Letzter Tag',
      starts_at_noon: 'Ab Mittag',
      ends_at_noon: 'Bis Mittag',
      note: 'Notiz',
      answer: 'Antwort',
      decided_by: 'Entschieden von',
      decided_at: 'Entschieden am',
    },
  },
  leave_entitlements: {
    label: 'Urlaub eines Jahres',
    fields: {
      person_id: 'Person',
      year: 'Jahr',
      entitled_half_days: 'Anspruch in halben Tagen',
      carried_half_days: 'Übertrag in halben Tagen',
    },
  },
  holiday_settings: {
    label: 'Feiertage',
    fields: {
      state: 'Bundesland',
      local_holidays: 'Örtliche Feiertage',
    },
  },
  qualification_kinds: {
    label: 'Eigene Art einer Qualifikation',
    fields: {
      label: 'Bezeichnung',
      level: 'Stufe',
    },
  },
  qualifications: {
    label: 'Qualifikation',
    fields: {
      person_id: 'Person',
      kind_key: 'Art',
      own_kind_id: 'Eigene Art',
      valid_until: 'Gültig bis',
      note: 'Notiz',
      certificate_sha256: 'Nachweis',
    },
  },
  stores: {
    label: 'Lagerort',
    fields: {
      name: 'Bezeichnung',
      location: 'Ort',
      vehicle: 'Fahrzeug',
      plate: 'Kennzeichen',
    },
  },
  store_articles: {
    label: 'Artikel eines Lagerorts',
    fields: {
      store_id: 'Lagerort',
      article_id: 'Artikel',
      bin: 'Lagerplatz',
      minimum_milli: 'Mindestbestand',
    },
  },
  stock_movements: {
    label: 'Buchung im Lager',
    fields: {
      store_id: 'Lagerort',
      article_id: 'Artikel',
      kind: 'Art',
      quantity_milli: 'Menge',
      supplier_id: 'Lieferant',
      counterpart_store_id: 'Anderer Lagerort',
      reason: 'Grund',
      booked_by: 'Gebucht von',
      booked_at: 'Gebucht am',
      job_id: 'Auftrag',
      document_line_id: 'Position',
    },
  },
  supplier_metal_prices: {
    label: 'Metallpreis',
    fields: {
      supplier_id: 'Lieferant',
      metal: 'Metall',
      valid_from: 'Gültig ab',
      price_cents: 'Preis je 100 kg',
    },
  },
  suppliers: {
    label: 'Lieferant',
    fields: { customer_number: 'Kundennummer', short_code: 'Kürzel' },
  },
  tags: { label: 'Tag' },
  tasks: {
    label: 'Aufgabe',
    fields: {
      title: 'Text',
      notes: 'Notiz',
      due_on: 'Fällig am',
      assignee_user_id: 'Verantwortlich',
    },
  },
  text_snippets: {
    label: 'Textbaustein',
    fields: { purpose: 'Zweck', mail_occasion: 'Anlass der E-Mail' },
  },
  working_times: {
    label: 'Vereinbarte Arbeitszeit',
    fields: {
      person_id: 'Person',
      valid_from: 'Gültig ab',
      monday_minutes: 'Montag',
      tuesday_minutes: 'Dienstag',
      wednesday_minutes: 'Mittwoch',
      thursday_minutes: 'Donnerstag',
      friday_minutes: 'Freitag',
      saturday_minutes: 'Samstag',
      sunday_minutes: 'Sonntag',
    },
  },
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
