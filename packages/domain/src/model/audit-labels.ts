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
      performed_on: 'Geprüft am',
      values: 'Werte',
    },
  },
  installations: {
    label: 'Anlage',
    fields: {
      commissioned_on: 'In Betrieb seit',
      warranty_ends_on: 'Gewährleistung bis',
      pv_system_id: 'Gehört zu PV-Anlage',
      inverter_id: 'Am Wechselrichter',
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
